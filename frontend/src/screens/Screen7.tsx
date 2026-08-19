import { useState } from 'react'
import { useApp } from '../store/AppContext'
import { AIBadge } from '../components/shared/AIBadge'
import { WordCountBar } from '../components/shared/QualityBar'
import { CustomizePromptModal } from '../components/shared/CustomizePromptModal'
import type { MatrixCell } from '../types'
import { API, apiFetch } from '../lib/api'
import { journalEntry } from '../lib/decisionJournal'
import { buildRobSummaries } from '../lib/robSummaries'


// ── Constants ─────────────────────────────────────────────────────────────────
const META_COLS = new Set(['#', 'Title', 'Authors', 'Year'])

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

// ── Cross-paper evidence for one selected schema axis ─────────────────────────
function ColumnGapCard({
  col,
  matrixRows,
  gap,
  loading,
  onGenerate,
}: {
  col: string
  matrixRows: { title: string; authors?: string; year?: number | null; cells: Record<string, MatrixCell> }[]
  gap?: string
  loading: boolean
  onGenerate: () => void
}) {
  const reported = matrixRows.filter(row => row.cells[col]?.value)
  const missing = matrixRows.length - reported.length

  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 border-b border-zinc-200">
        <span className="text-[11px] font-bold text-zinc-800 flex-1">{col}</span>
        <span className="text-[9px] text-zinc-400">{reported.length}/{matrixRows.length} papers report this axis</span>
      </div>
      <div className="px-3 py-3 bg-blue-50">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-[10px] font-semibold text-blue-800 flex-1">Schema gap across papers</p>
          <button
            onClick={onGenerate}
            disabled={loading}
            className="px-2 h-5 rounded border border-blue-200 bg-white text-[9px] text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {loading ? 'Generating…' : 'Generate'}
          </button>
        </div>
        <p className="text-[10px] text-blue-700 leading-relaxed">
          This compares all papers under this one schema direction and identifies the gap created by their shared pattern, disagreement, or incomparability.
        </p>
      </div>
      <div className="px-3 py-3 border-t border-blue-100">
        {loading ? (
          <div className="flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="w-3 h-3 border border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            Comparing papers on this schema direction…
          </div>
        ) : gap ? (
          <p className="text-[11px] text-zinc-700 leading-relaxed whitespace-pre-line">{gap}</p>
        ) : (
          <p className="text-[10px] text-zinc-400">Generate this schema gap to see the cross-paper comparison result here.</p>
        )}
      </div>
      {missing > 0 && <div className="px-3 py-2 border-t border-zinc-100 bg-zinc-50 text-[9px] text-zinc-400">{missing} paper{missing === 1 ? '' : 's'} do not report this axis.</div>}
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
  gap,
  loading,
  onGenerate,
}: {
  col: string
  gap?: string
  loading: boolean
  onGenerate: () => void
}) {
  const { state } = useApp()
  const sysRows = state.systemMatrixRows ?? []
  const reported = sysRows.filter(row => row.cells[col]?.value)
  const missing = sysRows.length - reported.length

  return (
    <div className="rounded-lg border border-violet-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 border-b border-violet-100">
        <span className="text-[11px] font-bold text-violet-800 flex-1">{col}</span>
        <span className="text-[9px] text-violet-400">{reported.length}/{sysRows.length} systems report this axis</span>
      </div>
      <div className="px-3 py-3 bg-violet-50/60">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-[10px] font-semibold text-violet-800 flex-1">Schema gap across systems</p>
          <button
            onClick={onGenerate}
            disabled={loading}
            className="px-2 h-5 rounded border border-violet-200 bg-white text-[9px] text-violet-700 hover:bg-violet-100 disabled:opacity-50"
          >
            {loading ? 'Generating…' : 'Generate'}
          </button>
        </div>
        <p className="text-[10px] text-violet-700 leading-relaxed">
          This compares all systems under this one schema direction and identifies the system-level gap or validation gap.
        </p>
      </div>
      <div className="px-3 py-3 border-t border-violet-100">
        {loading ? (
          <div className="flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="w-3 h-3 border border-violet-200 border-t-violet-600 rounded-full animate-spin" />
            Comparing systems on this schema direction…
          </div>
        ) : gap ? (
          <p className="text-[11px] text-zinc-700 leading-relaxed whitespace-pre-line">{gap}</p>
        ) : (
          <p className="text-[10px] text-zinc-400">Generate this schema gap to see the cross-system comparison result here.</p>
        )}
      </div>
      {missing > 0 && <div className="px-3 py-2 border-t border-zinc-100 bg-zinc-50 text-[9px] text-zinc-400">{missing} system{missing === 1 ? '' : 's'} do not report this axis.</div>}
    </div>
  )
}

// ── Main Screen7 ──────────────────────────────────────────────────────────────
export function Screen7() {
  const { state, dispatch } = useApp()
  const [selectedCols, setSelectedCols] = useState<string[]>([])
  const [selectedSysCols, setSelectedSysCols] = useState<string[]>([])
  const [regenerating, setRegenerating] = useState(false)
  const [showRegenModal, setShowRegenModal] = useState(false)
  const [customRegenPrompt, setCustomRegenPrompt] = useState<string | null>(null)
  const [gapDraft, setGapDraft] = useState(state.gapStatement)
  const [gapJustification, setGapJustification] = useState('')
  // Schema-axis gaps live in AppState: they persist across reloads and are sent
  // to the assistant, so it can act on requests that reference them.
  const axisGaps = state.axisGaps
  const [axisLoading, setAxisLoading] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)

  const wordCount = gapDraft.split(/\s+/).filter(Boolean).length

  function saveGapEdit() {
    if (gapDraft === state.gapStatement) return
    dispatch({ type: 'UPDATE_GAP_STATEMENT', text: gapDraft })
    dispatch({
      type: 'ADD_DECISION_JOURNAL_ENTRY',
      entry: journalEntry({
        kind: 'justification',
        step: 8,
        action: 'Manually edited gap statement',
        entityType: 'gap_statement',
        entityId: 'overall-gap-statement',
        entityLabel: 'Overall Gap Statement',
        previousValue: state.gapStatement,
        newValue: gapDraft,
        justification: gapJustification.trim() || undefined,
      }),
    })
    setGapJustification('')
  }

  function toggleCol(col: string) {
    const isSelected = selectedCols.includes(col)
    setSelectedCols(isSelected ? [] : [col])
    if (!isSelected) void handleGenerateAxisGap('lit', col)
  }

  function toggleSysCol(col: string) {
    const isSelected = selectedSysCols.includes(col)
    setSelectedSysCols(isSelected ? [] : [col])
    if (!isSelected) void handleGenerateAxisGap('sys', col)
  }

  function buildGapPayload(prompt?: string | null, focusCols: string[] = [], focusSysCols: string[] = []) {
    const selectedSystems = (state.systemItems ?? []).filter(s => s.selected)
    return {
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
      focus_columns: focusCols,
      focus_system_columns: focusSysCols,
      profile: state.profile,
      topics: state.topics.filter(t => t.selected).map(t => ({
        title: t.title,
        description: t.description,
        type: t.type,
      })),
      themes: state.themes.map(t => ({
        name: t.name,
        coverageLabel: t.coverageLabel,
        blocks: t.blocks.map(b => ({ blockType: b.blockType, content: b.content })),
      })),
      // The gap step is asked to identify what is methodologically weak. Without
      // the appraisal it could only infer that from design labels in the matrix;
      // with it, the analysis can name the domain that actually failed and say
      // what a new study would have to do differently.
      rob_summaries: buildRobSummaries(state),
    }
  }

  async function handleGenerateAxisGap(kind: 'lit' | 'sys', col: string) {
    const key = `${kind}:${col}`
    setAxisLoading(key)
    setGenerationError(null)
    try {
      const res = await apiFetch(`${API}/gaps/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGapPayload(null, kind === 'lit' ? [col] : [], kind === 'sys' ? [col] : [])),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `Axis-gap generation failed (HTTP ${res.status})`)
      }
      const data = await res.json()
      if (!data.statement?.trim()) throw new Error('Axis-gap generation returned an empty statement.')
      dispatch({ type: 'SET_AXIS_GAP', key, text: data.statement })
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Axis-gap generation failed.')
    }
    finally { setAxisLoading(current => current === key ? null : current) }
  }

  async function handleRegenerate(prompt?: string | null) {
    setRegenerating(true)
    setGenerationError(null)
    try {
      const res = await apiFetch(`${API}/gaps/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGapPayload(prompt)),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `Gap regeneration failed (HTTP ${res.status})`)
      }
      const data = await res.json()
      if (!data.statement?.trim()) throw new Error('Gap regeneration returned an empty statement.')
      dispatch({ type: 'UPDATE_GAP_STATEMENT', text: data.statement })
      setGapDraft(data.statement)
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Gap regeneration failed.')
    }
    finally { setRegenerating(false) }
  }

  function handleConfirm() {
    if (!gapDraft.trim()) {
      setGenerationError('Write or generate a gap statement before continuing.')
      return
    }
    saveGapEdit()
    setGenerationError(null)
    dispatch({ type: 'ADVANCE_STEP' })
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
                Select one schema direction to generate a cross-paper or cross-system gap for that direction.
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
                    Click a schema column above first. The left panel will compare all papers/systems on that selected direction.
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
                          gap={axisGaps[`lit:${col}`]}
                          loading={axisLoading === `lit:${col}`}
                          onGenerate={() => handleGenerateAxisGap('lit', col)}
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
                          gap={axisGaps[`sys:${col}`]}
                          loading={axisLoading === `sys:${col}`}
                          onGenerate={() => handleGenerateAxisGap('sys', col)}
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
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide flex-1">Overall Gap Statement</span>
            <AIBadge />
          </div>
          <p className="text-[10px] italic text-purple-400 mb-3">
            Drafted from all papers and selected systems. Schema-specific gaps stay in the left panel.
          </p>

          <textarea
            value={gapDraft}
            onChange={e => setGapDraft(e.target.value)}
            className="w-full bg-zinc-50 border border-zinc-300 rounded-lg p-3 text-[11px] text-zinc-800 resize-none focus:outline-none focus:border-zinc-500 leading-relaxed mb-2"
            style={{ height: 220 }}
          />
          {gapDraft !== state.gapStatement && (
            <div className="flex items-center gap-2 mb-2">
              <input
                value={gapJustification}
                onChange={e => setGapJustification(e.target.value)}
                placeholder="Why did you change the gap statement? (optional)"
                className="flex-1 h-8 border border-blue-200 bg-blue-50/40 rounded px-2.5 text-[10px] text-zinc-700 outline-none focus:border-blue-400"
              />
              <button
                onClick={saveGapEdit}
                className="px-3 h-8 bg-blue-600 text-white rounded text-[10px] font-semibold hover:bg-blue-700"
              >
                Save edit
              </button>
            </div>
          )}

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
                {regenerating ? 'Regenerating overall gap…' : 'Regenerate overall gap'}
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

          {generationError && (
            <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[10px] text-red-700">
              {generationError}
            </p>
          )}
          <div className="flex justify-end">
            <button
              onClick={handleConfirm}
              className="flex items-center gap-2 px-5 h-9 bg-zinc-900 text-white rounded text-[12px] font-semibold hover:bg-zinc-700 transition-colors"
            >
              Confirm → Final Question
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
