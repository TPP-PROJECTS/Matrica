import { useState } from 'react'
import { useApp } from '../store/AppContext'
import { AIBadge } from '../components/shared/AIBadge'
import { QuestionButton } from '../components/shared/QuestionButton'
import { QualityBar, WordCountBar } from '../components/shared/QualityBar'
import { CustomizePromptModal } from '../components/shared/CustomizePromptModal'
import type { MatrixCell } from '../types'
import { API } from '../lib/api'


// ── Constants ─────────────────────────────────────────────────────────────────
const META_COLS = new Set(['#', 'Title', 'Authors', 'Year'])

const EXAMPLE_PATTERNS = [
  'Despite extensive research on X, little attention has been given to Y…',
  'While previous studies have examined X, none have addressed Z in the context of…',
  'The absence of longitudinal data means that the long-term effects of X remain unknown.',
]

const QUALITY_INDICATORS = [
  { label: 'Specificity',   score: 72 },
  { label: 'Evidence link', score: 55 },
  { label: 'Clarity',       score: 88 },
]

// ── Gap dimension model ───────────────────────────────────────────────────────
interface GapDim {
  type: string
  label: string
  color: string    // tailwind classes for badge
  severity: 'high' | 'medium' | 'low'
  description: string
  insertText: string
  triggered: boolean  // whether the data crosses the threshold
}

function computeGapDims(col: string, matrixRows: { cells: Record<string, MatrixCell> }[]): GapDim[] {
  const cells      = matrixRows.map(r => r.cells[col]).filter(c => c?.value)
  const total      = matrixRows.length
  const emptyCount = total - cells.length
  const emptyRate  = emptyCount / Math.max(total, 1)
  const avgConf    = cells.length
    ? cells.reduce((s, c) => s + (c.confidenceScore ?? 0), 0) / cells.length
    : 0
  const inferredCount = cells.filter(c => c.extractionMethod === 'inferred').length
  const lowConfCount  = cells.filter(c => c.confidenceLevel === 'low').length

  return [
    {
      type: 'evidence',
      label: 'Evidence Gap',
      color: 'bg-red-100 text-red-700 border-red-300',
      severity: emptyRate > 0.6 ? 'high' : emptyRate > 0.3 ? 'medium' : 'low',
      description: `${emptyCount} of ${total} papers do not address "${col}" — this area lacks coverage in the literature.`,
      insertText: `There is an evidence gap regarding ${col.toLowerCase()}: ${emptyCount} of ${total} reviewed papers do not address this aspect, indicating an underexplored area for future research.`,
      triggered: emptyRate > 0.2,
    },
    {
      type: 'quality',
      label: 'Insufficient Evidence',
      color: 'bg-amber-100 text-amber-700 border-amber-300',
      severity: avgConf < 0.55 ? 'high' : avgConf < 0.75 ? 'medium' : 'low',
      description: `Average extraction confidence is ${Math.round(avgConf * 100)}% across papers that do address "${col}" — the evidence quality is insufficient to support strong conclusions.`,
      insertText: `Even where "${col}" is reported, evidence quality is low (avg. ${Math.round(avgConf * 100)}% confidence), limiting the strength of conclusions that can be drawn.`,
      triggered: avgConf < 0.80 && cells.length > 0,
    },
    {
      type: 'reliability',
      label: 'Reliability Gap',
      color: 'bg-orange-100 text-orange-700 border-orange-300',
      severity: inferredCount > cells.length * 0.5 ? 'high' : inferredCount > 0 ? 'medium' : 'low',
      description: `${inferredCount} of ${cells.length} extracted values are AI-inferred rather than explicitly stated in the papers — conclusions about "${col}" rest on uncertain ground.`,
      insertText: `Reliability concerns exist for "${col}": ${inferredCount} of ${cells.length} data points are inferred rather than explicitly stated, meaning this evidence should be treated with caution.`,
      triggered: inferredCount > 0,
    },
    {
      type: 'contested',
      label: 'Contested Conclusions',
      color: 'bg-purple-100 text-purple-700 border-purple-300',
      severity: lowConfCount > cells.length * 0.4 ? 'high' : lowConfCount > 0 ? 'medium' : 'low',
      description: `${lowConfCount} papers show low-confidence findings on "${col}" — the evidence is inconsistent or contested across the literature, and no consensus has emerged.`,
      insertText: `The evidence on "${col}" is contested: findings across ${lowConfCount} papers show low confidence, suggesting the literature has not reached consensus on this dimension.`,
      triggered: lowConfCount > 0,
    },
    {
      type: 'design',
      label: 'Design Weakness',
      color: 'bg-blue-100 text-blue-700 border-blue-300',
      severity: 'medium',
      description: `Studies addressing "${col}" rely predominantly on observational designs, reviews, or self-report — the evidence base lacks the experimental rigour needed for causal claims.`,
      insertText: `A design gap affects "${col}": the available studies use observational or review methods that cannot establish causation, and experimental evidence is largely absent.`,
      triggered: /method|finding|design/i.test(col),
    },
  ]
}

// ── Severity indicator ────────────────────────────────────────────────────────
function SeverityDot({ severity }: { severity: GapDim['severity'] }) {
  const cls = severity === 'high' ? 'bg-red-500' : severity === 'medium' ? 'bg-amber-400' : 'bg-zinc-300'
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${cls} shrink-0`} />
}

// ── Heatmap cell helpers ──────────────────────────────────────────────────────
function cellBg(cell: MatrixCell | undefined) {
  if (!cell || !cell.value) return 'bg-red-50 border-red-200 text-red-300'
  if (cell.confidenceLevel === 'high')   return 'bg-green-100 border-green-200 text-green-700'
  if (cell.confidenceLevel === 'medium') return 'bg-amber-100 border-amber-200 text-amber-700'
  return 'bg-orange-100 border-orange-200 text-orange-700'
}

function cellText(cell: MatrixCell | undefined) {
  if (!cell || !cell.value) return '—'
  const prefix = cell.extractionMethod === 'inferred' ? '~' : ''
  const snippet = cell.value.slice(0, 13) + (cell.value.length > 13 ? '…' : '')
  return prefix + snippet
}

// ── Matrix heatmap ────────────────────────────────────────────────────────────
function MatrixHeatmap({
  selectedCols,
  onToggle,
}: {
  selectedCols: string[]
  onToggle: (col: string) => void
}) {
  const { state } = useApp()
  const dataCols = state.matrixColumns.filter(c => !META_COLS.has(c))

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse w-full">
        <thead>
          <tr>
            <th className="px-2 py-1.5 text-left text-[8px] font-semibold text-zinc-400 min-w-[68px] sticky left-0 bg-white">
              Paper
            </th>
            {dataCols.map(col => {
              const sel = selectedCols.includes(col)
              return (
                <th
                  key={col}
                  onClick={() => onToggle(col)}
                  title={`Click to analyse gaps in "${col}"`}
                  className={`px-1.5 py-2 text-center text-[8px] font-semibold cursor-pointer transition-all border-b-2 select-none ${
                    sel
                      ? 'text-zinc-900 border-zinc-900 bg-zinc-50'
                      : 'text-zinc-400 border-transparent hover:text-zinc-700 hover:border-zinc-300'
                  }`}
                  style={{ minWidth: 76 }}
                >
                  {col}
                  {sel && <span className="block text-[7px] text-zinc-500 font-normal mt-0.5">analysing ●</span>}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {state.matrixRows.map(row => (
            <tr key={row.paperId}>
              <td className="px-2 py-1.5 sticky left-0 bg-white text-[8px] text-zinc-600 font-medium border-r border-zinc-100">
                {row.title.split(' ')[0]}
              </td>
              {dataCols.map(col => {
                const cell = row.cells[col]
                const sel  = selectedCols.includes(col)
                return (
                  <td
                    key={col}
                    title={
                      cell?.value
                        ? `${cell.value} (${cell.confidenceLevel}, ${cell.extractionMethod})`
                        : 'Not extracted'
                    }
                    className={`px-1.5 py-1.5 text-center text-[8px] border ${cellBg(cell)} ${
                      sel ? 'ring-1 ring-inset ring-zinc-700' : ''
                    } transition-all`}
                    style={{ maxWidth: 80 }}
                  >
                    <span
                      className={`block truncate ${cell?.extractionMethod === 'inferred' ? 'italic' : ''}`}
                    >
                      {cellText(cell)}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Gap dimension card for one selected column ────────────────────────────────
function ColumnGapCard({
  col,
  matrixRows,
  onInsert,
}: {
  col: string
  matrixRows: { cells: Record<string, MatrixCell> }[]
  onInsert: (text: string) => void
}) {
  const dims = computeGapDims(col, matrixRows)
  const triggered = dims.filter(d => d.triggered)
  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(triggered.map(d => [d.type, d.triggered]))
  )

  function toggle(type: string) {
    setChecked(prev => ({ ...prev, [type]: !prev[type] }))
  }

  function insertSelected() {
    const sentences = dims
      .filter(d => checked[d.type])
      .map(d => d.insertText)
      .join(' ')
    if (sentences) onInsert(sentences)
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 border-b border-zinc-200">
        <span className="text-[11px] font-bold text-zinc-800 flex-1">{col}</span>
        <span className="text-[9px] text-zinc-400">{triggered.length} gap type{triggered.length !== 1 ? 's' : ''} detected</span>
      </div>

      {/* Dimension rows */}
      <div className="divide-y divide-zinc-100">
        {dims.map(dim => (
          <label
            key={dim.type}
            className={`flex items-start gap-2.5 px-3 py-2.5 cursor-pointer transition-colors ${
              dim.triggered ? 'hover:bg-zinc-50' : 'opacity-40 cursor-default'
            }`}
          >
            <input
              type="checkbox"
              checked={!!checked[dim.type]}
              disabled={!dim.triggered}
              onChange={() => dim.triggered && toggle(dim.type)}
              className="mt-0.5 shrink-0 accent-zinc-900"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <SeverityDot severity={dim.severity} />
                <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-semibold border ${dim.color}`}>
                  {dim.label}
                </span>
              </div>
              <p className="text-[10px] text-zinc-600 leading-relaxed">{dim.description}</p>
            </div>
          </label>
        ))}
      </div>

      {/* Insert action */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-zinc-100 bg-zinc-50">
        <span className="text-[9px] text-zinc-400">
          {Object.values(checked).filter(Boolean).length} selected
        </span>
        <button
          onClick={insertSelected}
          disabled={!Object.values(checked).some(Boolean)}
          className="text-[9px] text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-0.5 hover:bg-blue-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          → Insert into statement
        </button>
      </div>
    </div>
  )
}

// ── System matrix heatmap (clickable cols) ────────────────────────────────────
function SystemHeatmap({
  selectedCols,
  onToggle,
}: {
  selectedCols: string[]
  onToggle: (col: string) => void
}) {
  const { state } = useApp()
  const sysCols = state.systemMatrixColumns ?? []
  const sysRows = state.systemMatrixRows ?? []
  if (!sysRows.length || !sysCols.length) return null

  function cellCls(cell: MatrixCell | undefined) {
    if (!cell || !cell.value) return 'bg-red-50 text-red-300 border-red-100'
    if (cell.confidenceLevel === 'high')   return 'bg-green-100 text-green-700 border-green-200'
    if (cell.confidenceLevel === 'medium') return 'bg-amber-100 text-amber-700 border-amber-200'
    return 'bg-orange-100 text-orange-700 border-orange-200'
  }

  return (
    <div className="mt-4">
      <p className="text-[9px] font-bold text-violet-500 uppercase tracking-wide mb-1.5">
        System Review Coverage — click column to analyse gaps
      </p>
      <div className="overflow-x-auto rounded border border-violet-100">
        <table className="border-collapse w-full">
          <thead>
            <tr className="bg-violet-50">
              <th className="px-2 py-1.5 text-left text-[8px] font-semibold text-violet-400 min-w-[60px] sticky left-0 bg-violet-50">System</th>
              {sysCols.map(col => {
                const sel = selectedCols.includes(col)
                return (
                  <th
                    key={col}
                    onClick={() => onToggle(col)}
                    className={`px-1.5 py-2 text-center text-[8px] font-semibold cursor-pointer border-b-2 select-none transition-all ${
                      sel
                        ? 'text-violet-900 border-violet-600 bg-violet-100/60'
                        : 'text-violet-400 border-transparent hover:text-violet-700 hover:border-violet-300'
                    }`}
                    style={{ minWidth: 76 }}
                  >
                    {col}
                    {sel && <span className="block text-[7px] text-violet-500 font-normal mt-0.5">analysing ●</span>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sysRows.map(row => (
              <tr key={row.systemId}>
                <td className="px-2 py-1.5 text-[8px] text-zinc-600 font-medium border-r border-violet-50 bg-white sticky left-0">
                  {row.name.split(' ')[0]}
                </td>
                {sysCols.map(col => {
                  const cell = row.cells[col]
                  const sel  = selectedCols.includes(col)
                  return (
                    <td key={col} title={cell?.value || 'Not assessed'}
                      className={`px-1.5 py-1.5 text-center text-[8px] border ${cellCls(cell)} ${sel ? 'ring-1 ring-inset ring-violet-500' : ''} transition-all`}
                      style={{ maxWidth: 80 }}>
                      <span className="block truncate">
                        {cell?.value ? cell.value.slice(0, 13) + (cell.value.length > 13 ? '…' : '') : '—'}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Gap card for system columns ───────────────────────────────────────────────
function SystemColumnGapCard({
  col,
  onInsert,
}: {
  col: string
  onInsert: (text: string) => void
}) {
  const { state } = useApp()
  const sysRows = state.systemMatrixRows ?? []
  const total = sysRows.length
  const cells = sysRows.map(r => r.cells[col]).filter(c => c?.value)
  const missing = total - cells.length
  const missingRate = missing / Math.max(total, 1)
  const avgConf = cells.length ? cells.reduce((s, c) => s + (c.confidenceScore ?? 0), 0) / cells.length : 0
  const lowConfCount = cells.filter(c => c.confidenceLevel === 'low' || c.confidenceLevel === 'none').length

  const dims = [
    {
      type: 'coverage',
      label: 'Coverage Gap',
      color: 'bg-red-100 text-red-700 border-red-300',
      severity: (missingRate > 0.5 ? 'high' : missingRate > 0.2 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
      description: `${missing} of ${total} systems lack data for "${col}" — this dimension is not fully assessed across the system landscape.`,
      insertText: `A coverage gap exists for "${col}" in the system review: ${missing} of ${total} evaluated systems were not assessed on this dimension, limiting comparative conclusions.`,
      triggered: missing > 0,
    },
    {
      type: 'quality',
      label: 'Evidence Quality',
      color: 'bg-amber-100 text-amber-700 border-amber-300',
      severity: (avgConf < 50 ? 'high' : avgConf < 70 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
      description: `Average confidence for "${col}" across systems is ${Math.round(avgConf)}% — the system evidence on this dimension has limited reliability.`,
      insertText: `The system review evidence on "${col}" has low average confidence (${Math.round(avgConf)}%), suggesting that published system data on this dimension should be interpreted cautiously.`,
      triggered: avgConf < 75 && cells.length > 0,
    },
    {
      type: 'low_conf',
      label: 'Contested Claims',
      color: 'bg-purple-100 text-purple-700 border-purple-300',
      severity: (lowConfCount > cells.length * 0.4 ? 'high' : lowConfCount > 0 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
      description: `${lowConfCount} systems show low-confidence data for "${col}" — vendor claims or publicly available information conflicts with independent assessments.`,
      insertText: `For "${col}", ${lowConfCount} systems in the review have low-confidence data, indicating that independent evaluation of system capabilities on this dimension is needed.`,
      triggered: lowConfCount > 0,
    },
  ]

  const [checked, setChecked] = useState<Record<string, boolean>>(
    Object.fromEntries(dims.map(d => [d.type, d.triggered]))
  )

  return (
    <div className="rounded-lg border border-violet-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 border-b border-violet-100">
        <span className="text-[11px] font-bold text-violet-800 flex-1">{col}</span>
        <span className="text-[9px] text-violet-400">System review · {dims.filter(d => d.triggered).length} gap type{dims.filter(d => d.triggered).length !== 1 ? 's' : ''}</span>
      </div>
      <div className="divide-y divide-zinc-100">
        {dims.map(dim => (
          <label key={dim.type} className={`flex items-start gap-2.5 px-3 py-2.5 cursor-pointer transition-colors ${dim.triggered ? 'hover:bg-zinc-50' : 'opacity-40 cursor-default'}`}>
            <input
              type="checkbox"
              checked={!!checked[dim.type]}
              disabled={!dim.triggered}
              onChange={() => dim.triggered && setChecked(p => ({ ...p, [dim.type]: !p[dim.type] }))}
              className="mt-0.5 shrink-0 accent-violet-600"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dim.severity === 'high' ? 'bg-red-500' : dim.severity === 'medium' ? 'bg-amber-400' : 'bg-zinc-300'}`} />
                <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-semibold border ${dim.color}`}>{dim.label}</span>
              </div>
              <p className="text-[10px] text-zinc-600 leading-relaxed">{dim.description}</p>
            </div>
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between px-3 py-2 border-t border-zinc-100 bg-zinc-50">
        <span className="text-[9px] text-zinc-400">{Object.values(checked).filter(Boolean).length} selected</span>
        <button
          onClick={() => {
            const text = dims.filter(d => checked[d.type]).map(d => d.insertText).join(' ')
            if (text) onInsert(text)
          }}
          disabled={!Object.values(checked).some(Boolean)}
          className="text-[9px] text-violet-600 hover:text-violet-800 border border-violet-200 rounded px-2 py-0.5 hover:bg-violet-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          → Insert into statement
        </button>
      </div>
    </div>
  )
}

// ── Main Screen7 ──────────────────────────────────────────────────────────────
export function Screen7() {
  const { state, dispatch } = useApp()
  const [selectedCols, setSelectedCols] = useState<string[]>([])
  const [selectedSysCols, setSelectedSysCols] = useState<string[]>([])
  const [regenerating, setRegenerating] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [showRegenModal, setShowRegenModal] = useState(false)
  const [customRegenPrompt, setCustomRegenPrompt] = useState<string | null>(null)

  const wordCount = state.gapStatement.split(/\s+/).filter(Boolean).length

  function toggleCol(col: string) {
    setSelectedCols(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    )
  }

  function toggleSysCol(col: string) {
    setSelectedSysCols(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    )
  }

  function insertIntoStatement(text: string) {
    const sep = state.gapStatement.trim() ? '\n\n' : ''
    dispatch({ type: 'UPDATE_GAP_STATEMENT', text: state.gapStatement + sep + text })
  }

  async function handleRegenerate(prompt?: string | null) {
    setRegenerating(true)
    try {
      const selectedSystems = (state.systemItems ?? []).filter(s => s.selected)
      const res = await fetch(`${API}/gaps/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom_system_prompt: prompt ?? null,
          matrix_rows: state.matrixRows.map(r => ({
            title: r.title, authors: r.authors, year: r.year,
            cells: Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, {
              value: c.value, confidenceScore: c.confidenceScore,
              confidenceLevel: c.confidenceLevel, evidenceType: c.evidenceType,
              extractionMethod: c.extractionMethod,
            }])),
          })),
          system_rows: (state.systemMatrixRows ?? []).filter(r =>
            selectedSystems.some(s => s.id === r.systemId)
          ).map(r => ({
            name: r.name, vendor: r.vendor, category: r.category,
            cells: Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, {
              value: c.value, confidenceScore: c.confidenceScore,
              confidenceLevel: c.confidenceLevel, evidenceType: c.evidenceType,
              extractionMethod: c.extractionMethod,
            }])),
          })),
          columns: state.matrixColumns,
          system_columns: state.systemMatrixColumns ?? [],
          profile: state.profile,
          themes: state.themes.map(t => ({
            name: t.name,
            coverageLabel: t.coverageLabel,
            blocks: t.blocks.map(b => ({ blockType: b.blockType, content: b.content })),
          })),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.statement) dispatch({ type: 'UPDATE_GAP_STATEMENT', text: data.statement })
      }
    } catch { /* silent */ }
    finally { setRegenerating(false) }
  }

  async function handleConfirm() {
    setConfirming(true)
    try {
      const res = await fetch(`${API}/final-question/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gap_statement: state.gapStatement,
          profile: state.profile,
          themes: state.themes.map(t => ({
            name: t.name,
            coverageLabel: t.coverageLabel,
            blocks: t.blocks.map(b => ({ blockType: b.blockType, content: b.content })),
          })),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.rq_options?.length) dispatch({ type: 'SET_RQ_OPTIONS', options: data.rq_options })
        if (data.study_designs?.length) dispatch({ type: 'SET_STUDY_DESIGN_OPTIONS', options: data.study_designs })
      }
    } catch { /* silent — advance anyway */ }
    finally {
      setConfirming(false)
      dispatch({ type: 'ADVANCE_STEP' })
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Topic banner */}
      <div className="h-9 bg-zinc-950 flex items-center px-4 gap-2 shrink-0">
        <span className="text-[11px] text-zinc-500">Topic:</span>
        <span className="text-[13px] text-white font-bold">{state.sessionTitle}</span>
        <div className="flex-1" />
        <span className="text-[11px] text-zinc-500">Step 7 · Gap &amp; Statement</span>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Matrix Coverage + Gap Analysis ── */}
        <div className="w-[500px] shrink-0 border-r border-zinc-200 relative">
          <div className="absolute inset-0 overflow-y-auto bg-white">

            {/* Header */}
            <div className="px-4 pt-3 pb-2 border-b border-zinc-100">
              <p className="text-[12px] font-bold text-zinc-800">Matrix Coverage</p>
              <p className="text-[9px] text-zinc-400 mt-0.5">
                Click a column to analyse all gap dimensions — evidence, quality, reliability, and contested conclusions.
              </p>
            </div>

            {/* Legend */}
            <div className="px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-100">
              {[
                { cls: 'bg-green-100',  label: 'High confidence' },
                { cls: 'bg-amber-100',  label: 'Medium' },
                { cls: 'bg-orange-100', label: 'Low' },
                { cls: 'bg-red-50',     label: 'Not extracted' },
              ].map(({ cls, label }) => (
                <div key={label} className="flex items-center gap-1">
                  <div className={`w-3 h-3 rounded border border-zinc-200 ${cls}`} />
                  <span className="text-[8px] text-zinc-500">{label}</span>
                </div>
              ))}
              <div className="flex items-center gap-1">
                <span className="text-[9px] italic text-zinc-400">~val</span>
                <span className="text-[8px] text-zinc-400">= inferred (reliability risk)</span>
              </div>
            </div>

            {/* Heatmap */}
            <div className="px-3 py-2">
              <MatrixHeatmap selectedCols={selectedCols} onToggle={toggleCol} />
              <SystemHeatmap selectedCols={selectedSysCols} onToggle={toggleSysCol} />
            </div>

            {/* Coverage summary */}
            <div className="px-4 py-2 border-t border-zinc-100 bg-zinc-50">
              <p className="text-[9px] text-zinc-500">
                <span className="font-semibold text-zinc-700">{state.matrixRows.length}</span> of{' '}
                <span className="font-semibold text-zinc-700">{state.reviewList.length}</span> papers extracted ·{' '}
                <span className="text-red-600 font-semibold">
                  {state.reviewList.length - state.matrixRows.length} papers not yet in matrix
                </span>{' '}
                — an evidence gap in itself
              </p>
            </div>

            {/* Gap cards per selected column */}
            <div className="px-3 py-3 space-y-3">
              {selectedCols.length === 0 && selectedSysCols.length === 0 ? (
                <div className="text-center mt-8 px-4">
                  <p className="text-[11px] text-zinc-400 mb-1">No column selected</p>
                  <p className="text-[10px] text-zinc-300 leading-relaxed">
                    Click a column header above to surface all gap types — not just missing evidence, but also
                    quality problems, reliability issues, and contested conclusions.
                  </p>
                </div>
              ) : (
                <>
                  {selectedCols.length > 0 && (
                    <>
                      <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">
                        Literature Matrix — {selectedCols.length} column{selectedCols.length !== 1 ? 's' : ''}
                      </p>
                      {selectedCols.map(col => (
                        <ColumnGapCard
                          key={`lit-${col}`}
                          col={col}
                          matrixRows={state.matrixRows}
                          onInsert={insertIntoStatement}
                        />
                      ))}
                    </>
                  )}
                  {selectedSysCols.length > 0 && (
                    <>
                      <p className="text-[9px] font-bold text-violet-400 uppercase tracking-wide mt-2">
                        System Review — {selectedSysCols.length} column{selectedSysCols.length !== 1 ? 's' : ''}
                      </p>
                      {selectedSysCols.map(col => (
                        <SystemColumnGapCard
                          key={`sys-${col}`}
                          col={col}
                          onInsert={insertIntoStatement}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Gap Statement ── */}
        <div className="flex-1 flex flex-col overflow-y-auto px-4 py-4 bg-white">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide flex-1">Gap Statement</span>
            <AIBadge />
            <QuestionButton />
          </div>
          <p className="text-[10px] italic text-purple-400 mb-3">
            AI-drafted from matrix gaps. Edit freely — this goes into your introduction.
          </p>

          <textarea
            value={state.gapStatement}
            onChange={e => dispatch({ type: 'UPDATE_GAP_STATEMENT', text: e.target.value })}
            className="w-full bg-zinc-50 border border-zinc-300 rounded-lg p-3 text-[11px] text-zinc-800 resize-none focus:outline-none focus:border-zinc-500 leading-relaxed mb-2"
            style={{ height: 220 }}
          />

          <div className="mb-2">
            <WordCountBar count={wordCount} />
          </div>

          <div className="flex justify-end mb-4 gap-1">
            <div className="flex rounded overflow-hidden border border-zinc-300">
              <button
                onClick={() => handleRegenerate(customRegenPrompt)}
                disabled={regenerating}
                className="flex items-center gap-1.5 px-3 h-7 text-[11px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
              >
                {regenerating
                  ? <span className="w-3 h-3 border border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
                  : '↺'}
                {customRegenPrompt && <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />}
                {regenerating ? 'Regenerating…' : 'Regenerate'}
              </button>
              <button
                onClick={() => setShowRegenModal(true)}
                disabled={regenerating}
                title="Customize AI prompt"
                className="px-2 h-7 border-l border-zinc-200 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 text-[10px] disabled:opacity-50 transition-colors"
              >
                ⚙
              </button>
            </div>
          </div>

          {showRegenModal && (
            <CustomizePromptModal
              promptKey="gaps-generate"
              title="Regenerate Gap Statement"
              initialCustomPrompt={customRegenPrompt}
              onClose={() => setShowRegenModal(false)}
              onGenerate={(prompt) => {
                setCustomRegenPrompt(prompt)
                setShowRegenModal(false)
                handleRegenerate(prompt)
              }}
            />
          )}

          {/* Gaps cited */}
          {selectedCols.length > 0 && (
            <div className="mb-4">
              <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide mb-2">Gaps Cited</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedCols.map(col => {
                  const cited = state.gapStatement.toLowerCase().includes(col.toLowerCase().split(' ')[0])
                  return (
                    <span
                      key={col}
                      className={`px-2 py-0.5 rounded-full border text-[9px] ${
                        cited
                          ? 'bg-blue-100 text-blue-700 border-blue-300'
                          : 'bg-zinc-100 text-zinc-400 border-zinc-200'
                      }`}
                    >
                      {col}{!cited && ' (not yet cited)'}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {/* Example patterns */}
          <div className="mb-4">
            <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide mb-2">Example Patterns</p>
            <div className="flex flex-col gap-1.5">
              {EXAMPLE_PATTERNS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => insertIntoStatement(p)}
                  className="px-2 py-1.5 bg-zinc-100 rounded text-[9px] text-zinc-600 text-left hover:bg-zinc-200 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Quality check */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 mb-4">
            <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide mb-2">Quality Check</p>
            <div className="flex flex-col gap-1.5">
              {QUALITY_INDICATORS.map(qi => (
                <QualityBar key={qi.label} score={qi.score} label={qi.label} />
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleConfirm}
              disabled={confirming}
              className="flex items-center gap-2 px-5 h-9 bg-zinc-900 text-white rounded text-[12px] font-semibold hover:bg-zinc-700 disabled:opacity-60 transition-colors"
            >
              {confirming && (
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {confirming ? 'Generating…' : 'Confirm → Final Question'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
