import { useState } from 'react'
import { useApp } from '../store/AppContext'
import { CustomizePromptModal } from '../components/shared/CustomizePromptModal'
import type { SynthesisBlock, Theme, MatrixCell } from '../types'
import { API } from '../lib/api'


// ── Helpers ───────────────────────────────────────────────────────────────────
function blockStyle(blockType: SynthesisBlock['blockType']) {
  switch (blockType) {
    case 'focus':    return { bg: 'bg-blue-50',   bar: 'bg-blue-400' }
    case 'patterns': return { bg: 'bg-green-50',  bar: 'bg-green-400' }
    case 'unclear':  return { bg: 'bg-yellow-50', bar: 'bg-yellow-400' }
    case 'missing':  return { bg: 'bg-red-50',    bar: 'bg-red-400' }
    case 'custom':   return { bg: 'bg-violet-50', bar: 'bg-violet-400' }
  }
}

function coverageColor(label: Theme['coverageLabel']) {
  if (label === 'Dense')    return 'text-green-600'
  if (label === 'Moderate') return 'text-amber-600'
  return 'text-red-600'
}

function cellBg(cell: MatrixCell | undefined) {
  if (!cell || !cell.value) return 'bg-red-50 text-red-400'
  if (cell.confidenceLevel === 'high')   return 'bg-green-50 text-green-800'
  if (cell.confidenceLevel === 'medium') return 'bg-amber-50 text-amber-800'
  return 'bg-orange-50 text-orange-800'
}

// ── Theme list item ───────────────────────────────────────────────────────────
function ThemeCard({ theme, active, onClick }: { theme: Theme; active: boolean; onClick: () => void }) {
  const pct = Math.round((theme.paperCount / theme.totalPapers) * 100)
  return (
    <div
      onClick={onClick}
      className={`rounded mb-1.5 p-2 cursor-pointer border transition-colors ${
        active
          ? 'bg-blue-50 border-2 border-blue-500'
          : 'bg-white border border-zinc-200 hover:bg-zinc-50'
      }`}
      style={{ minHeight: '76px' }}
    >
      <p className={`text-[11px] leading-tight mb-1 ${active ? 'font-semibold text-zinc-900' : 'font-medium text-zinc-700'}`}>
        {theme.name}
      </p>
      <p className="text-[9px] text-zinc-400 mb-1">{theme.paperCount} of {theme.totalPapers} papers</p>
      <div className="h-2 bg-zinc-200 rounded overflow-hidden mb-0.5">
        <div
          className={`h-full rounded ${active ? 'bg-blue-500' : 'bg-zinc-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-[9px] font-medium ${coverageColor(theme.coverageLabel)}`}>
          {theme.coverageLabel}{theme.coverageLabel === 'Sparse' ? ' ⚠' : ''}
        </span>
        {theme.profileMatch && (
          <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${
            theme.profileMatch === 'profile_match'
              ? 'bg-teal-100 text-teal-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {theme.profileMatch === 'profile_match' ? 'profile match ✓' : 'inferred'}
          </span>
        )}
      </div>
      {(theme.sourceColumns ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {(theme.sourceColumns ?? []).map(c => (
            <span key={c} className="px-1 py-0.5 bg-blue-100 text-blue-600 rounded text-[7px]">{c}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Reusable column chip picker ───────────────────────────────────────────────
function ColChips({
  selected,
  available,
  onAdd,
  onRemove,
  colorClass,
}: {
  selected: string[]
  available: string[]
  onAdd: (c: string) => void
  onRemove: (c: string) => void
  colorClass: string   // e.g. 'blue' | 'violet'
}) {
  const [open, setOpen] = useState(false)
  const bg   = colorClass === 'violet' ? 'bg-violet-100 text-violet-700 border-violet-200' : 'bg-blue-100 text-blue-700 border-blue-200'
  const btn  = colorClass === 'violet' ? 'border-violet-300 text-violet-500 hover:bg-violet-50' : 'border-blue-300 text-blue-500 hover:bg-blue-50'
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {selected.map(col => (
        <span key={col} className={`flex items-center gap-1 px-2 py-0.5 border rounded-full text-[10px] ${bg}`}>
          {col}
          <button onClick={() => onRemove(col)} className="leading-none ml-0.5 opacity-60 hover:opacity-100">×</button>
        </span>
      ))}
      <div className="relative">
        <button onClick={() => setOpen(v => !v)} className={`px-2 py-0.5 border border-dashed rounded-full text-[10px] ${btn}`}>
          + Add
        </button>
        {open && (
          <div className="absolute z-20 left-0 top-full mt-1 bg-white border border-zinc-200 rounded-lg shadow-xl py-1 min-w-[140px]">
            {available.length > 0 ? available.map(col => (
              <button key={col} onClick={() => { onAdd(col); setOpen(false) }} className="block w-full text-left px-3 py-1.5 text-[10px] text-zinc-700 hover:bg-zinc-50">
                {col}
              </button>
            )) : <p className="px-3 py-2 text-[10px] text-zinc-400">All columns linked</p>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Matrix Sources panel ──────────────────────────────────────────────────────
function MatrixSourcesPanel({ theme }: { theme: Theme }) {
  const { state, dispatch } = useApp()
  const [expanded, setExpanded] = useState(true)

  const litCols    = theme.sourceColumns ?? []
  const sysCols    = theme.systemSourceColumns ?? []
  const LIT_AVAIL  = state.matrixColumns.filter(c => !['#', 'Title', 'Authors', 'Year'].includes(c) && !litCols.includes(c))
  const SYS_AVAIL  = (state.systemMatrixColumns ?? []).filter(c => !sysCols.includes(c))
  const hasSysData = (state.systemMatrixRows ?? []).length > 0 && (state.systemMatrixColumns ?? []).length > 0
  const totalLinked = litCols.length + sysCols.length

  return (
    <div className="border border-blue-200 rounded-lg mb-4 overflow-visible bg-blue-50/20">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-50/40 rounded-t-lg"
      >
        <span className="text-[9px] font-bold text-blue-600 uppercase tracking-wide flex-1">▸ Matrix Data Sources</span>
        <span className="text-[9px] text-blue-400">{totalLinked} column{totalLinked !== 1 ? 's' : ''} linked</span>
        <span className="text-blue-300 text-[11px]">{expanded ? '▴' : '▾'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Literature columns */}
          <div>
            <p className="text-[8px] font-bold text-blue-500 uppercase tracking-wide mb-1.5">Literature Matrix</p>
            <ColChips
              selected={litCols}
              available={LIT_AVAIL}
              onAdd={col => dispatch({ type: 'UPDATE_THEME_COLUMNS', themeId: theme.id, columns: [...litCols, col] })}
              onRemove={col => dispatch({ type: 'UPDATE_THEME_COLUMNS', themeId: theme.id, columns: litCols.filter(c => c !== col) })}
              colorClass="blue"
            />
            {litCols.length > 0 && state.matrixRows.length > 0 && (
              <div className="overflow-x-auto rounded border border-blue-100 mt-2">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-blue-50">
                      <th className="px-2 py-1.5 border-b border-blue-100 text-[8px] font-bold text-blue-500 min-w-[68px] sticky left-0 bg-blue-50">Paper</th>
                      {litCols.map(col => (
                        <th key={col} className="px-2 py-1.5 border-b border-l border-blue-100 text-[8px] font-bold text-blue-500 min-w-[120px]">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {state.matrixRows.map(row => (
                      <tr key={row.paperId} className="border-t border-blue-50 hover:bg-blue-50/30">
                        <td className="px-2 py-1.5 border-r border-blue-50 text-[8px] text-zinc-600 font-medium sticky left-0 bg-white">{row.title.split(' ')[0]}</td>
                        {litCols.map(col => {
                          const cell = row.cells[col]
                          const value = cell?.value ?? ''
                          return (
                            <td key={col} title={value || 'Not extracted'} className={`px-2 py-1.5 border-l border-blue-50 text-[8px] leading-relaxed ${cellBg(cell)}`}>
                              {value ? value.slice(0, 55) + (value.length > 55 ? '…' : '') : <span className="text-red-300 italic">—</span>}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* System columns */}
          {hasSysData && (
            <div>
              <p className="text-[8px] font-bold text-violet-500 uppercase tracking-wide mb-1.5">System Review Matrix</p>
              <ColChips
                selected={sysCols}
                available={SYS_AVAIL}
                onAdd={col => dispatch({ type: 'UPDATE_THEME_SYSTEM_COLUMNS', themeId: theme.id, columns: [...sysCols, col] })}
                onRemove={col => dispatch({ type: 'UPDATE_THEME_SYSTEM_COLUMNS', themeId: theme.id, columns: sysCols.filter(c => c !== col) })}
                colorClass="violet"
              />
              {sysCols.length > 0 && (
                <div className="overflow-x-auto rounded border border-violet-100 mt-2">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-violet-50">
                        <th className="px-2 py-1.5 border-b border-violet-100 text-[8px] font-bold text-violet-500 min-w-[68px] sticky left-0 bg-violet-50">System</th>
                        {sysCols.map(col => (
                          <th key={col} className="px-2 py-1.5 border-b border-l border-violet-100 text-[8px] font-bold text-violet-500 min-w-[120px]">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(state.systemMatrixRows ?? []).map(row => (
                        <tr key={row.systemId} className="border-t border-violet-50 hover:bg-violet-50/30">
                          <td className="px-2 py-1.5 border-r border-violet-50 text-[8px] text-zinc-600 font-medium sticky left-0 bg-white">{row.name.split(' ')[0]}</td>
                          {sysCols.map(col => {
                            const cell = row.cells[col]
                            const value = cell?.value ?? ''
                            return (
                              <td key={col} title={value || 'Not assessed'} className={`px-2 py-1.5 border-l border-violet-50 text-[8px] leading-relaxed ${cellBg(cell)}`}>
                                {value ? value.slice(0, 55) + (value.length > 55 ? '…' : '') : <span className="text-red-300 italic">—</span>}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-3">
            {[{ cls: 'bg-green-100', label: 'High' }, { cls: 'bg-amber-100', label: 'Medium' }, { cls: 'bg-orange-100', label: 'Low' }, { cls: 'bg-red-50', label: 'Missing' }].map(({ cls, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div className={`w-2.5 h-2.5 rounded ${cls}`} />
                <span className="text-[7px] text-zinc-400">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Synthesis block card ──────────────────────────────────────────────────────
function SynthesisBlockCard({
  block,
  theme,
  onRegenerate,
}: {
  block: SynthesisBlock
  theme: Theme
  onRegenerate: (block: SynthesisBlock, customPrompt?: string | null) => Promise<void>
}) {
  const { dispatch } = useApp()
  const style = blockStyle(block.blockType)
  const [regenerating, setRegenerating] = useState(false)
  const [editingContent, setEditingContent] = useState(false)
  const [draft, setDraft] = useState(block.content)
  const [showPromptModal, setShowPromptModal] = useState(false)
  const [customPrompt, setCustomPrompt] = useState<string | null>(null)

  async function handleRegenerate(prompt?: string | null) {
    setRegenerating(true)
    try {
      await onRegenerate(block, prompt)
    } finally {
      setRegenerating(false)
    }
  }

  function saveEdit() {
    dispatch({ type: 'UPDATE_SYNTHESIS_BLOCK', themeId: theme.id, blockId: block.id, content: draft })
    setEditingContent(false)
  }

  return (
    <div className={`relative rounded-lg mb-3 border border-zinc-200 ${style.bg} flex overflow-hidden`}>
      <div className={`w-[3px] shrink-0 ${style.bar}`} />
      <div className="flex-1 p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[12px] font-bold text-zinc-950 flex-1">{block.title}</span>
          {block.blockType === 'custom' && (
            <span className="px-1.5 py-0.5 bg-violet-100 text-violet-600 text-[8px] font-semibold rounded">custom</span>
          )}
          <div className="flex rounded overflow-hidden border border-zinc-300">
            <button
              onClick={() => handleRegenerate(customPrompt)}
              disabled={regenerating}
              className="flex items-center gap-1 px-2 h-6 text-[10px] bg-white/70 hover:bg-white text-zinc-600 hover:text-zinc-900 disabled:opacity-50 transition-colors"
              title="Regenerate with AI"
            >
              {regenerating
                ? <span className="w-2.5 h-2.5 border border-zinc-400 border-t-zinc-700 rounded-full animate-spin" />
                : <span>↺</span>}
              {customPrompt && <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />}
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
            <button
              onClick={() => setShowPromptModal(true)}
              disabled={regenerating}
              title="Customize AI prompt"
              className="px-1.5 h-6 border-l border-zinc-300 bg-white/70 hover:bg-white text-zinc-400 hover:text-zinc-700 text-[10px] disabled:opacity-50 transition-colors"
            >
              ⚙
            </button>
          </div>
          {showPromptModal && (
            <CustomizePromptModal
              promptKey="synthesis-block"
              title={`Regenerate: ${block.title}`}
              initialCustomPrompt={customPrompt}
              onClose={() => setShowPromptModal(false)}
              onGenerate={(prompt) => {
                setCustomPrompt(prompt)
                setShowPromptModal(false)
                handleRegenerate(prompt)
              }}
            />
          )}
        </div>

        {editingContent ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={4}
              className="w-full border border-zinc-300 rounded px-2 py-1.5 text-[11px] text-zinc-800 resize-none focus:outline-none focus:border-zinc-500 bg-white"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDraft(block.content); setEditingContent(false) }} className="px-2 py-0.5 text-[10px] border border-zinc-300 rounded text-zinc-600 hover:bg-zinc-50">Cancel</button>
              <button onClick={saveEdit} className="px-2 py-0.5 text-[10px] bg-zinc-800 text-white rounded hover:bg-zinc-700">Save</button>
            </div>
          </div>
        ) : (
          <p className={`text-[10px] text-zinc-700 leading-relaxed mb-2 ${block.isLowConfidence ? 'italic' : ''}`}>
            {block.content || <span className="text-zinc-400 italic">No content yet — click Regenerate or Edit to add.</span>}
          </p>
        )}

        {block.isLowConfidence && !editingContent && (
          <p className="text-[9px] italic text-amber-700 mb-2">Some underlying data is medium/low confidence.</p>
        )}

        {!editingContent && (
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setDraft(block.content); setEditingContent(true) }}
              className="text-[10px] text-zinc-500 hover:text-zinc-800 border border-zinc-300 rounded px-2 py-0.5 bg-white/70 hover:bg-white"
            >
              ✎ Edit
            </button>
            <span className="text-[9px] text-zinc-400">
              {block.paperCount} papers / avg conf: {Math.round(block.avgConfidence * 100)}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Add custom analyst form ───────────────────────────────────────────────────
function AddAnalystForm({
  theme,
  onClose,
}: {
  theme: Theme
  onClose: () => void
}) {
  const { state, dispatch } = useApp()
  const [name, setName] = useState('')
  const [generating, setGenerating] = useState(false)
  const [manualContent, setManualContent] = useState('')
  const [mode, setMode] = useState<'ai' | 'manual'>('ai')

  async function handleAdd() {
    const title = name.trim()
    if (!title) return
    const blockId = `custom-${Date.now()}`

    if (mode === 'manual') {
      dispatch({
        type: 'ADD_SYNTHESIS_BLOCK',
        themeId: theme.id,
        block: {
          id: blockId,
          blockType: 'custom',
          title,
          content: manualContent.trim(),
          paperCount: state.matrixRows.length,
          avgConfidence: 0.5,
          isLowConfidence: false,
        },
      })
      onClose()
      return
    }

    // AI fill
    setGenerating(true)
    try {
      const res = await fetch(`${API}/synthesis/regenerate-block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block_type: 'custom',
          block_title: title,
          theme_name: theme.name,
          source_columns: theme.sourceColumns,
          matrix_rows: state.matrixRows.map(r => ({
            title: r.title, authors: r.authors, year: r.year,
            cells: Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, { value: c.value, confidenceScore: c.confidenceScore, confidenceLevel: c.confidenceLevel, evidenceType: c.evidenceType }])),
          })),
          system_rows: (state.systemMatrixRows ?? []).map(r => ({
            name: r.name, vendor: r.vendor, category: r.category,
            cells: Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, { value: c.value, confidenceScore: c.confidenceScore, confidenceLevel: c.confidenceLevel, evidenceType: c.evidenceType }])),
          })),
          columns: state.matrixColumns,
          system_columns: state.systemMatrixColumns ?? [],
          profile: state.profile,
        }),
      })
      const data = res.ok ? await res.json() : { content: '', paper_count: 0, avg_confidence: 0.5, is_low_confidence: false }
      dispatch({
        type: 'ADD_SYNTHESIS_BLOCK',
        themeId: theme.id,
        block: {
          id: blockId,
          blockType: 'custom',
          title,
          content: data.content,
          paperCount: data.paper_count,
          avgConfidence: data.avg_confidence,
          isLowConfidence: data.is_low_confidence,
        },
      })
    } finally {
      setGenerating(false)
      onClose()
    }
  }

  return (
    <div className="rounded-lg border-2 border-dashed border-violet-300 bg-violet-50/40 p-3 mb-3">
      <p className="text-[10px] font-bold text-violet-700 mb-2">New Analyst</p>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Analyst name, e.g. 'Methodological quality' or 'Cost considerations'"
        className="w-full border border-zinc-300 rounded px-2 py-1.5 text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-violet-400 bg-white mb-2"
        autoFocus
        onKeyDown={e => e.key === 'Enter' && !generating && handleAdd()}
      />
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => setMode('ai')}
          className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${mode === 'ai' ? 'bg-violet-600 text-white border-violet-600' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50'}`}
        >
          ✦ AI Fill
        </button>
        <button
          onClick={() => setMode('manual')}
          className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${mode === 'manual' ? 'bg-zinc-800 text-white border-zinc-800' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50'}`}
        >
          ✎ Write manually
        </button>
      </div>
      {mode === 'manual' && (
        <textarea
          value={manualContent}
          onChange={e => setManualContent(e.target.value)}
          rows={3}
          placeholder="Write your synthesis here…"
          className="w-full border border-zinc-300 rounded px-2 py-1.5 text-[11px] text-zinc-800 resize-none focus:outline-none focus:border-zinc-500 bg-white mb-2"
        />
      )}
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="px-2 py-0.5 text-[10px] border border-zinc-300 rounded text-zinc-600 hover:bg-zinc-50">Cancel</button>
        <button
          onClick={handleAdd}
          disabled={!name.trim() || generating}
          className="flex items-center gap-1.5 px-3 py-0.5 text-[10px] bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50"
        >
          {generating && <span className="w-2.5 h-2.5 border border-violet-300 border-t-white rounded-full animate-spin" />}
          {generating ? 'Generating…' : 'Add'}
        </button>
      </div>
    </div>
  )
}

// ── Main Screen6 ──────────────────────────────────────────────────────────────
export function Screen6() {
  const { state, dispatch } = useApp()
  const [activeThemeId, setActiveThemeId] = useState(state.activeThemeId)
  const [showAddAnalyst, setShowAddAnalyst] = useState(false)
  const [gapGenerating, setGapGenerating] = useState(false)

  async function handleContinueToGap() {
    setGapGenerating(true)
    try {
      const selectedSystems = (state.systemItems ?? []).filter(s => s.selected)
      const res = await fetch(`${API}/gaps/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
    } catch { /* silent — advance anyway */ }
    finally {
      setGapGenerating(false)
      dispatch({ type: 'ADVANCE_STEP' })
    }
  }

  const activeTheme = state.themes.find(t => t.id === activeThemeId) ?? state.themes[0]

  async function handleRegenerate(block: SynthesisBlock, customPrompt?: string | null) {
    if (!activeTheme) return
    try {
      const res = await fetch(`${API}/synthesis/regenerate-block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block_type: block.blockType,
          block_title: block.title,
          theme_name: activeTheme.name,
          source_columns: activeTheme.sourceColumns,
          matrix_rows: state.matrixRows.map(r => ({
            title: r.title, authors: r.authors, year: r.year,
            cells: Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, { value: c.value, confidenceScore: c.confidenceScore, confidenceLevel: c.confidenceLevel, evidenceType: c.evidenceType }])),
          })),
          system_rows: (state.systemMatrixRows ?? []).map(r => ({
            name: r.name, vendor: r.vendor, category: r.category,
            cells: Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, { value: c.value, confidenceScore: c.confidenceScore, confidenceLevel: c.confidenceLevel, evidenceType: c.evidenceType }])),
          })),
          columns: state.matrixColumns,
          system_columns: state.systemMatrixColumns ?? [],
          profile: state.profile,
          custom_system_prompt: customPrompt ?? null,
        }),
      })
      if (!res.ok) return
      const data = await res.json()
      dispatch({ type: 'UPDATE_SYNTHESIS_BLOCK', themeId: activeTheme.id, blockId: block.id, content: data.content })
    } catch { /* silent */ }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Topic banner */}
      <div className="h-9 bg-zinc-950 flex items-center px-4 gap-2 shrink-0">
        <span className="text-[11px] text-zinc-500">Topic:</span>
        <span className="text-[13px] text-white font-bold">{state.sessionTitle}</span>
        <div className="flex-1" />
        <span className="text-[11px] text-zinc-500">Step 6 · Synthesis</span>
      </div>

      {/* Consistency alert */}
      {state.consistencyAlert && (
        <div className="flex items-center gap-3 px-4 border-2 border-red-400 bg-red-50" style={{ minHeight: 40 }}>
          <span className="text-[11px] text-red-800 flex-1">
            ⚠ SYSTEM ALERT: {state.consistencyAlert.claim} contradicts {state.consistencyAlert.data}
          </span>
          <button className="px-2 py-1 bg-red-500 text-white text-[10px] rounded">Review conflict</button>
          <button onClick={() => dispatch({ type: 'DISMISS_CONSISTENCY_ALERT' })} className="text-[10px] text-zinc-600 hover:text-zinc-900">Dismiss</button>
        </div>
      )}

      {/* Main two-column */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left — Themes */}
        <aside className="w-[210px] shrink-0 bg-zinc-50 border-r border-zinc-200 flex flex-col overflow-hidden">
          <div className="px-3 pt-3 pb-2 shrink-0">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">Themes</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {state.themes.map(theme => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                active={theme.id === activeThemeId}
                onClick={() => { setActiveThemeId(theme.id); setShowAddAnalyst(false) }}
              />
            ))}
          </div>
        </aside>

        {/* Right — Matrix sources + Synthesis blocks */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {activeTheme && (
              <>
                <MatrixSourcesPanel theme={activeTheme} />

                {activeTheme.blocks.map(block => (
                  <SynthesisBlockCard
                    key={block.id}
                    block={block}
                    theme={activeTheme}
                    onRegenerate={handleRegenerate}
                  />
                ))}

                {showAddAnalyst ? (
                  <AddAnalystForm theme={activeTheme} onClose={() => setShowAddAnalyst(false)} />
                ) : (
                  <button
                    onClick={() => setShowAddAnalyst(true)}
                    className="w-full py-2 border-2 border-dashed border-zinc-200 rounded-lg text-[11px] text-zinc-400 hover:border-violet-300 hover:text-violet-500 transition-colors"
                  >
                    + Add Custom Analyst
                  </button>
                )}
              </>
            )}
          </div>

          <div className="px-4 pb-4 shrink-0">
            <button className="px-4 h-8 border border-zinc-300 rounded text-[11px] text-zinc-700 hover:bg-zinc-50">
              Export all as Word draft →
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="h-12 border-t border-zinc-200 bg-white flex items-center justify-end px-4 gap-3 shrink-0">
        {gapGenerating && (
          <span className="flex items-center gap-1.5 text-[10px] text-zinc-400">
            <span className="w-3 h-3 border border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
            Generating gap statement…
          </span>
        )}
        <button
          onClick={handleContinueToGap}
          disabled={gapGenerating}
          className="px-5 h-9 bg-zinc-900 text-white rounded text-[12px] font-semibold hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          Continue to Gap &amp; Statement →
        </button>
      </div>
    </div>
  )
}
