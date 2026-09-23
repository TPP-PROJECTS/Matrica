import { useState } from 'react'
import { useApp } from '../store/AppContext'
import { AIBadge } from '../components/shared/AIBadge'
import { WordCountBar } from '../components/shared/QualityBar'
import { CustomizePromptModal } from '../components/shared/CustomizePromptModal'
import type { MatrixCell, SynthesisBlock, Theme } from '../types'
import { API, apiFetch } from '../lib/api'
import { journalEntry } from '../lib/decisionJournal'
import { buildRobSummaries } from '../lib/robSummaries'

/**
 * Synthesis and gap analysis, in one step.
 *
 * They used to be two, and each opened with its own rendering of the same
 * extraction matrix — the reader scrolled past the evidence once to read what
 * the studies say together, then again to read what they leave unanswered. The
 * matrix is laid out once here, and both readings hang off it: the columns a
 * theme synthesises from, and the column an axis gap is computed for.
 */

const META_COLS = new Set(['#', 'Title', 'Authors', 'Year'])

// ── Shared cell styling ───────────────────────────────────────────────────────
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

// ── Theme list item ───────────────────────────────────────────────────────────
/**
 * Coverage of a reviewer-defined theme, read off the matrix.
 *
 * A generated theme arrives with the model's own count; a theme the reviewer
 * defined has none, so it is worked out from the columns it draws on — a paper
 * counts when any of those columns holds a value for it.
 */
function liveCoverage(theme: Theme, rows: { cells: Record<string, MatrixCell> }[]) {
  const total = rows.length
  const cols = theme.sourceColumns ?? []
  const count = cols.length === 0 ? 0 : rows.filter(r => cols.some(c => r.cells[c]?.value)).length
  const share = total > 0 ? count / total : 0
  const label: Theme['coverageLabel'] = share >= 0.66 ? 'Dense' : share >= 0.33 ? 'Moderate' : 'Sparse'
  return { paperCount: count, totalPapers: total, coverageLabel: label }
}

function ThemeCard({ theme, active, onClick }: { theme: Theme; active: boolean; onClick: () => void }) {
  const { state, dispatch } = useApp()
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(theme.name)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const cov = theme.userDefined
    ? liveCoverage(theme, state.matrixRows)
    : { paperCount: theme.paperCount, totalPapers: theme.totalPapers, coverageLabel: theme.coverageLabel }
  const pct = cov.totalPapers > 0 ? Math.round((cov.paperCount / cov.totalPapers) * 100) : 0

  function commitRename() {
    const name = draft.trim()
    if (name && name !== theme.name) dispatch({ type: 'RENAME_THEME', themeId: theme.id, name })
    else setDraft(theme.name)
    setRenaming(false)
  }

  return (
    <div
      onClick={onClick}
      // Switching theme is reading, not editing, so review mode lets it through.
      data-review-allow
      className={`group relative rounded mb-1.5 p-2 cursor-pointer border transition-colors ${
        active
          ? 'bg-blue-50 border-2 border-blue-500'
          : 'bg-white border border-zinc-200 hover:bg-zinc-50'
      }`}
      style={{ minHeight: '76px' }}
    >
      {/* Rename / delete. Outside the review-mode allowance on purpose: these
          change the synthesis, the card click only selects it. */}
      {!renaming && !confirmDelete && (
        <div data-review-block className="absolute top-1.5 right-1.5 hidden group-hover:flex gap-1">
          <button
            onClick={e => { e.stopPropagation(); setDraft(theme.name); setRenaming(true) }}
            title="Rename theme"
            className="w-5 h-5 rounded bg-white/90 border border-zinc-200 text-[9px] text-zinc-500 hover:text-zinc-900"
          >✎</button>
          <button
            onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
            title="Delete theme"
            className="w-5 h-5 rounded bg-white/90 border border-zinc-200 text-[10px] text-zinc-400 hover:text-red-600"
          >×</button>
        </div>
      )}

      {renaming ? (
        <input
          data-review-block
          autoFocus
          value={draft}
          onClick={e => e.stopPropagation()}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') { setDraft(theme.name); setRenaming(false) }
          }}
          className="w-full mb-1 border border-blue-300 rounded px-1.5 py-0.5 text-[11px] font-semibold text-zinc-900 bg-white outline-none"
        />
      ) : (
        <p className={`text-[11px] leading-tight mb-1 pr-11 ${active ? 'font-semibold text-zinc-900' : 'font-medium text-zinc-700'}`}>
          {theme.name}
        </p>
      )}

      {confirmDelete ? (
        <div data-review-block className="flex items-center gap-1.5 text-[9px]" onClick={e => e.stopPropagation()}>
          <span className="text-red-600 flex-1">Delete this theme and its blocks?</span>
          <button
            onClick={() => dispatch({ type: 'REMOVE_THEME', themeId: theme.id })}
            className="px-1.5 py-0.5 rounded bg-red-600 text-white font-semibold"
          >Delete</button>
          <button onClick={() => setConfirmDelete(false)} className="px-1.5 py-0.5 rounded border border-zinc-300 text-zinc-600">Keep</button>
        </div>
      ) : (
        <>
          <p className="text-[9px] text-zinc-400 mb-1">{cov.paperCount} of {cov.totalPapers} papers</p>
          <div className="h-2 bg-zinc-200 rounded overflow-hidden mb-0.5">
            <div className={`h-full rounded ${active ? 'bg-blue-500' : 'bg-zinc-400'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between gap-1">
            <span className={`text-[9px] font-medium ${coverageColor(cov.coverageLabel)}`}>
              {cov.coverageLabel}{cov.coverageLabel === 'Sparse' ? ' ⚠' : ''}
            </span>
            {theme.userDefined ? (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-white">yours</span>
            ) : theme.profileMatch && (
              <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${
                theme.profileMatch === 'profile_match' ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {theme.profileMatch === 'profile_match' ? 'profile match ✓' : 'inferred'}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** The four standard analysis blocks, empty, for a theme the reviewer defines. */
function emptyBlocks(themeId: string): SynthesisBlock[] {
  const kinds: { type: SynthesisBlock['blockType']; title: string }[] = [
    { type: 'focus', title: 'Core focus' },
    { type: 'patterns', title: 'Patterns across studies' },
    { type: 'unclear', title: 'Unclear or contested' },
    { type: 'missing', title: 'What is missing' },
  ]
  return kinds.map(k => ({
    id: `${themeId}-${k.type}`,
    blockType: k.type,
    title: k.title,
    content: '',
    paperCount: 0,
    avgConfidence: 0,
    isLowConfidence: false,
  }))
}

// ── New theme form ────────────────────────────────────────────────────────────
function NewThemeForm({
  onCreate, onClose,
}: {
  onCreate: (theme: Theme, fillWithAi: boolean) => void
  onClose: () => void
}) {
  const { state } = useApp()
  const [name, setName] = useState('')
  const [cols, setCols] = useState<string[]>([])
  const [sysCols, setSysCols] = useState<string[]>([])
  const [fillWithAi, setFillWithAi] = useState(true)

  const litOptions = state.matrixColumns.filter(c => !META_COLS.has(c))
  const sysOptions = state.systemMatrixColumns ?? []
  const taken = state.themes.some(t => t.name.trim().toLowerCase() === name.trim().toLowerCase())

  function toggle(list: string[], set: (v: string[]) => void, col: string) {
    set(list.includes(col) ? list.filter(c => c !== col) : [...list, col])
  }

  function create() {
    const trimmed = name.trim()
    if (!trimmed || taken) return
    const id = `theme-user-${Date.now()}`
    onCreate({
      id,
      name: trimmed,
      paperCount: 0,
      totalPapers: state.matrixRows.length,
      coverageLabel: 'Sparse',
      profileMatch: null,
      blocks: emptyBlocks(id),
      sourceColumns: cols,
      systemSourceColumns: sysCols,
      userDefined: true,
    }, fillWithAi && cols.length + sysCols.length > 0)
  }

  return (
    <div className="rounded border-2 border-dashed border-blue-300 bg-white p-2 mb-2" onClick={e => e.stopPropagation()}>
      <p className="text-[10px] font-bold text-blue-700 mb-1.5">New theme</p>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') onClose() }}
        placeholder="e.g. Implementation barriers"
        className="w-full border border-zinc-300 rounded px-1.5 py-1 text-[11px] text-zinc-900 outline-none focus:border-blue-400 mb-1"
      />
      {taken && <p className="text-[9px] text-red-500 mb-1">A theme with this name already exists.</p>}

      <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-wide mt-1 mb-1">Draws on</p>
      <div className="flex flex-wrap gap-1 mb-1.5 max-h-[110px] overflow-y-auto">
        {litOptions.length === 0 && <span className="text-[9px] text-zinc-400 italic">No matrix columns yet</span>}
        {litOptions.map(col => (
          <button
            key={col}
            onClick={() => toggle(cols, setCols, col)}
            className={`px-1.5 py-0.5 rounded-full border text-[9px] ${
              cols.includes(col) ? 'bg-blue-100 border-blue-300 text-blue-700' : 'border-zinc-200 text-zinc-500 hover:border-blue-200'
            }`}
          >{col}</button>
        ))}
        {sysOptions.map(col => (
          <button
            key={`sys-${col}`}
            onClick={() => toggle(sysCols, setSysCols, col)}
            className={`px-1.5 py-0.5 rounded-full border text-[9px] ${
              sysCols.includes(col) ? 'bg-violet-100 border-violet-300 text-violet-700' : 'border-zinc-200 text-violet-400 hover:border-violet-200'
            }`}
          >⚙ {col}</button>
        ))}
      </div>

      <label className="flex items-center gap-1.5 text-[9px] text-zinc-600 mb-2 cursor-pointer">
        <input type="checkbox" checked={fillWithAi} onChange={e => setFillWithAi(e.target.checked)} className="w-3 h-3 accent-violet-600" />
        Draft the four analysis blocks with AI
      </label>

      <div className="flex gap-1.5 justify-end">
        <button onClick={onClose} className="px-2 py-0.5 text-[10px] border border-zinc-300 rounded text-zinc-600 hover:bg-zinc-50">Cancel</button>
        <button
          onClick={create}
          disabled={!name.trim() || taken}
          className="px-2.5 py-0.5 text-[10px] bg-blue-600 text-white rounded font-semibold hover:bg-blue-700 disabled:opacity-40"
        >Add theme</button>
      </div>
    </div>
  )
}

// ── Column chips (which columns a theme synthesises from) ─────────────────────
function ColChips({
  selected, available, onAdd, onRemove, colorClass,
}: {
  selected: string[]
  available: string[]
  onAdd: (c: string) => void
  onRemove: (c: string) => void
  colorClass: 'blue' | 'violet'
}) {
  const [open, setOpen] = useState(false)
  const bg  = colorClass === 'violet' ? 'bg-violet-100 text-violet-700 border-violet-200' : 'bg-blue-100 text-blue-700 border-blue-200'
  const btn = colorClass === 'violet' ? 'border-violet-300 text-violet-500 hover:bg-violet-50' : 'border-blue-300 text-blue-500 hover:bg-blue-50'
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

// ── The one matrix ────────────────────────────────────────────────────────────
/**
 * How much of each cell to show. Full text is the default: the synthesis and
 * the gap are both read *from* these cells, and a 13-character snippet is not
 * something either can be checked against. Compact is there for a wide schema,
 * where the reader wants the coverage pattern rather than the wording.
 */
type MatrixDensity = 'full' | 'compact'

function MatrixCellContent({ cell, density }: { cell: MatrixCell | undefined; density: MatrixDensity }) {
  if (!cell || !cell.value) return <span className="text-red-300">—</span>
  const inferred = cell.extractionMethod === 'inferred'
  if (density === 'compact') {
    return <span className={`block truncate ${inferred ? 'italic' : ''}`}>{cellText(cell)}</span>
  }
  return (
    <span className={`block whitespace-pre-wrap break-words text-left ${inferred ? 'italic' : ''}`}>
      {inferred ? '~' : ''}{cell.value}
    </span>
  )
}

/**
 * Which columns the table shows. Every matrix column is shown by default — the
 * synthesis is read against the whole extraction, not only the part the model
 * chose — and the theme's own columns are highlighted within it. Narrowing to
 * just those is available, never the default.
 */
type ColumnScope = 'all' | 'theme'

/**
 * Blue rails down both edges of a highlighted column. Drawn as inset shadows so
 * they sit on top of the confidence colouring instead of replacing it: the
 * reader needs both at once — which columns the theme uses, and how reliable
 * each cell in them is.
 */
const THEME_COL_RAIL = { boxShadow: 'inset 2px 0 0 #3b82f6, inset -2px 0 0 #3b82f6' }
const THEME_COL_RAIL_SYS = { boxShadow: 'inset 2px 0 0 #7c3aed, inset -2px 0 0 #7c3aed' }

/** Column width per density — wide enough in full mode to read a sentence. */
function colStyle(density: MatrixDensity) {
  return density === 'full' ? { minWidth: 200, maxWidth: 320 } : { minWidth: 76, maxWidth: 96 }
}

function LiteratureHeatmap({
  gapCols, themeCols, onGapToggle, density, scope, themeLabel,
}: {
  gapCols: string[]
  themeCols: string[]
  onGapToggle: (col: string) => void
  density: MatrixDensity
  scope: ColumnScope
  /** "AI-selected" for a generated theme, "your choice" for a reviewer-defined one. */
  themeLabel: string
}) {
  const { state } = useApp()
  const allCols = state.matrixColumns.filter(c => !META_COLS.has(c))
  const dataCols = scope === 'theme' ? allCols.filter(c => themeCols.includes(c)) : allCols

  if (state.matrixRows.length === 0) {
    return <p className="text-[11px] text-zinc-400 italic px-1 py-4">No papers have been extracted into the matrix yet.</p>
  }
  if (dataCols.length === 0) {
    return (
      <p className="text-[11px] text-zinc-400 italic px-1 py-4">
        This theme draws on no literature column yet — add one above, or switch back to all columns.
      </p>
    )
  }

  return (
    // Its own scroll box, both ways, so a long or wide matrix never pushes the
    // synthesis and gap sections off the page — the header row and the paper
    // column stay pinned while you move through it.
    <div className="overflow-auto max-h-[460px] rounded border border-zinc-200 resize-y">
      <table className="border-separate border-spacing-0 w-max min-w-full">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-30 bg-white px-2 py-1.5 text-left text-[9px] font-semibold text-zinc-500 border-b border-r border-zinc-200"
                style={{ minWidth: density === 'full' ? 180 : 90, maxWidth: density === 'full' ? 240 : 110 }}>
              Paper
            </th>
            {dataCols.map(col => {
              const sel = gapCols.includes(col)
              const linked = themeCols.includes(col)
              return (
                <th
                  key={col}
                  onClick={() => onGapToggle(col)}
                  title={`Click to analyse the gap across papers in "${col}"${linked ? ` · used by this theme (${themeLabel})` : ''}`}
                  className={`sticky top-0 z-20 px-2 py-2 text-left text-[9px] font-semibold cursor-pointer transition-colors border-b-2 select-none ${
                    linked
                      ? sel ? 'bg-blue-700 text-white border-b-zinc-900' : 'bg-blue-600 text-white border-b-blue-800 hover:bg-blue-700'
                      : sel ? 'text-zinc-900 border-b-zinc-900 bg-zinc-100' : 'text-zinc-500 border-b-zinc-200 bg-white hover:text-zinc-800 hover:bg-zinc-50'
                  }`}
                  style={{ ...colStyle(density), ...(linked ? THEME_COL_RAIL : {}) }}
                >
                  {linked && (
                    <span className="block text-[7px] font-bold uppercase tracking-wide text-blue-100 mb-0.5">
                      ★ Used by theme · {themeLabel}
                    </span>
                  )}
                  {col}
                  {sel && <span className={`block text-[8px] font-normal mt-0.5 ${linked ? 'text-blue-100' : 'text-zinc-500'}`}>analysing gap ●</span>}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {state.matrixRows.map(row => (
            <tr key={row.paperId}>
              <td
                title={`${row.title}${row.authors ? ` — ${row.authors}` : ''}${row.year ? ` (${row.year})` : ''}`}
                className="sticky left-0 z-10 bg-white px-2 py-1.5 align-top text-[9px] text-zinc-700 font-medium border-b border-r border-zinc-200"
                style={{ minWidth: density === 'full' ? 180 : 90, maxWidth: density === 'full' ? 240 : 110 }}
              >
                {density === 'full' ? (
                  <>
                    <span className="block leading-snug">{row.title}</span>
                    <span className="block text-[8px] text-zinc-400 font-normal mt-0.5 truncate">
                      {[row.authors, row.year || ''].filter(Boolean).join(' · ')}
                    </span>
                  </>
                ) : (
                  <span className="block truncate">{row.title.split(' ')[0]}</span>
                )}
              </td>
              {dataCols.map(col => {
                const cell = row.cells[col]
                const sel  = gapCols.includes(col)
                const linked = themeCols.includes(col)
                return (
                  <td
                    key={col}
                    title={cell?.value ? `${cell.value} (${cell.confidenceLevel}, ${cell.extractionMethod})` : 'Not extracted'}
                    className={`px-2 py-1.5 align-top text-[9px] leading-snug border-b border-r ${cellBg(cell)} ${sel ? 'ring-1 ring-inset ring-zinc-700' : ''}`}
                    style={{ ...colStyle(density), ...(linked ? THEME_COL_RAIL : {}) }}
                  >
                    <MatrixCellContent cell={cell} density={density} />
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

function SystemHeatmap({
  gapCols, themeCols, onGapToggle, density, scope, themeLabel,
}: {
  gapCols: string[]
  themeCols: string[]
  onGapToggle: (col: string) => void
  density: MatrixDensity
  scope: ColumnScope
  themeLabel: string
}) {
  const { state } = useApp()
  const allSysCols = state.systemMatrixColumns ?? []
  const sysCols = scope === 'theme' ? allSysCols.filter(c => themeCols.includes(c)) : allSysCols
  const sysRows = state.systemMatrixRows ?? []
  if (!sysRows.length || !sysCols.length) return null

  return (
    <div className="mt-4">
      <p className="text-[9px] font-bold text-violet-500 uppercase tracking-wide mb-1.5">
        System Review Matrix — click a column to analyse its gap
      </p>
      <div className="overflow-auto max-h-[360px] rounded border border-violet-200 resize-y">
        <table className="border-separate border-spacing-0 w-max min-w-full">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 bg-violet-50 px-2 py-1.5 text-left text-[9px] font-semibold text-violet-500 border-b border-r border-violet-200"
                  style={{ minWidth: density === 'full' ? 160 : 80 }}>
                System
              </th>
              {sysCols.map(col => {
                const sel = gapCols.includes(col)
                const linked = themeCols.includes(col)
                return (
                  <th
                    key={col}
                    onClick={() => onGapToggle(col)}
                    title={`Click to analyse the gap across systems in "${col}"${linked ? ` · used by this theme (${themeLabel})` : ''}`}
                    className={`sticky top-0 z-20 px-2 py-2 text-left text-[9px] font-semibold cursor-pointer border-b-2 select-none transition-colors ${
                      linked
                        ? sel ? 'bg-violet-800 text-white border-b-zinc-900' : 'bg-violet-600 text-white border-b-violet-800 hover:bg-violet-700'
                        : sel ? 'text-violet-900 border-b-violet-600 bg-violet-100' : 'text-violet-500 border-b-violet-200 bg-violet-50 hover:text-violet-800'
                    }`}
                    style={{ ...colStyle(density), ...(linked ? THEME_COL_RAIL_SYS : {}) }}
                  >
                    {linked && (
                      <span className="block text-[7px] font-bold uppercase tracking-wide text-violet-100 mb-0.5">
                        ★ Used by theme · {themeLabel}
                      </span>
                    )}
                    {col}
                    {sel && <span className={`block text-[8px] font-normal mt-0.5 ${linked ? 'text-violet-100' : 'text-violet-500'}`}>analysing gap ●</span>}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sysRows.map(row => (
              <tr key={row.systemId}>
                <td title={row.name}
                    className="sticky left-0 z-10 bg-white px-2 py-1.5 align-top text-[9px] text-zinc-700 font-medium border-b border-r border-violet-100"
                    style={{ minWidth: density === 'full' ? 160 : 80 }}>
                  {density === 'full' ? (
                    <>
                      <span className="block leading-snug">{row.name}</span>
                      {row.vendor && <span className="block text-[8px] text-zinc-400 font-normal mt-0.5">{row.vendor}</span>}
                    </>
                  ) : (
                    <span className="block truncate">{row.name.split(' ')[0]}</span>
                  )}
                </td>
                {sysCols.map(col => {
                  const cell = row.cells[col]
                  const sel  = gapCols.includes(col)
                  const linked = themeCols.includes(col)
                  return (
                    <td
                      key={col}
                      title={cell?.value || 'Not assessed'}
                      className={`px-2 py-1.5 align-top text-[9px] leading-snug border-b border-r ${cellBg(cell)} ${sel ? 'ring-1 ring-inset ring-violet-500' : ''}`}
                      style={{ ...colStyle(density), ...(linked ? THEME_COL_RAIL_SYS : {}) }}
                    >
                      <MatrixCellContent cell={cell} density={density} />
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

// ── Axis gap cards ────────────────────────────────────────────────────────────
function AxisGapCard({
  col, kind, reported, total, gap, loading, onGenerate, onClose,
}: {
  col: string
  kind: 'lit' | 'sys'
  reported: number
  total: number
  gap?: string
  loading: boolean
  onGenerate: () => void
  onClose: () => void
}) {
  const sys = kind === 'sys'
  const missing = total - reported
  return (
    <div className={`rounded-lg border bg-white overflow-hidden ${sys ? 'border-violet-200' : 'border-zinc-200'}`}>
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${sys ? 'bg-violet-50 border-violet-100' : 'bg-zinc-50 border-zinc-200'}`}>
        <span className={`text-[11px] font-bold flex-1 ${sys ? 'text-violet-800' : 'text-zinc-800'}`}>{col}</span>
        <span className={`text-[9px] ${sys ? 'text-violet-400' : 'text-zinc-400'}`}>
          {reported}/{total} {sys ? 'systems' : 'papers'} report this axis
        </span>
        <button onClick={onClose} title="Stop analysing this column" className="text-zinc-300 hover:text-zinc-600 text-[11px] leading-none">×</button>
      </div>
      <div className={`px-3 py-3 ${sys ? 'bg-violet-50/60' : 'bg-blue-50'}`}>
        <div className="flex items-center gap-2 mb-1">
          <p className={`text-[10px] font-semibold flex-1 ${sys ? 'text-violet-800' : 'text-blue-800'}`}>
            Schema gap across {sys ? 'systems' : 'papers'}
          </p>
          <button
            onClick={onGenerate}
            disabled={loading}
            className={`px-2 h-5 rounded border bg-white text-[9px] disabled:opacity-50 ${
              sys ? 'border-violet-200 text-violet-700 hover:bg-violet-100' : 'border-blue-200 text-blue-700 hover:bg-blue-100'
            }`}
          >
            {loading ? 'Generating…' : gap ? 'Regenerate' : 'Generate'}
          </button>
        </div>
        <p className={`text-[10px] leading-relaxed ${sys ? 'text-violet-700' : 'text-blue-700'}`}>
          This compares everything under one schema direction and names the gap created by their shared pattern,
          disagreement, or incomparability.
        </p>
      </div>
      <div className="px-3 py-3 border-t border-zinc-100">
        {loading ? (
          <div className="flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="w-3 h-3 border border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            Comparing on this schema direction…
          </div>
        ) : gap ? (
          <p className="text-[11px] text-zinc-700 leading-relaxed whitespace-pre-line">{gap}</p>
        ) : (
          <p className="text-[10px] text-zinc-400">Generate this schema gap to see the comparison result here.</p>
        )}
      </div>
      {missing > 0 && (
        <div className="px-3 py-2 border-t border-zinc-100 bg-zinc-50 text-[9px] text-zinc-400">
          {missing} {sys ? 'system' : 'paper'}{missing === 1 ? '' : 's'} do not report this axis.
        </div>
      )}
    </div>
  )
}

// ── Synthesis block card ──────────────────────────────────────────────────────
function SynthesisBlockCard({
  block, theme, onRegenerate, onRemove,
}: {
  block: SynthesisBlock
  theme: Theme
  onRegenerate: (block: SynthesisBlock, customPrompt?: string | null) => Promise<void>
  onRemove: () => void
}) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const { dispatch } = useApp()
  const style = blockStyle(block.blockType)
  const [regenerating, setRegenerating] = useState(false)
  const [editingContent, setEditingContent] = useState(false)
  const [draft, setDraft] = useState(block.content)
  const [showPromptModal, setShowPromptModal] = useState(false)
  const [customPrompt, setCustomPrompt] = useState<string | null>(null)
  const [editJustification, setEditJustification] = useState('')

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
    dispatch({
      type: 'ADD_DECISION_JOURNAL_ENTRY',
      entry: journalEntry({
        kind: 'justification',
        step: 6,
        action: 'Manually edited synthesis',
        entityType: 'synthesis',
        entityId: `${theme.id}:${block.id}`,
        entityLabel: `${theme.name} — ${block.title}`,
        previousValue: block.content,
        newValue: draft,
        justification: editJustification.trim() || undefined,
      }),
    })
    setEditJustification('')
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
          {confirmRemove ? (
            <span className="flex items-center gap-1 text-[9px]">
              <span className="text-red-600">Remove block?</span>
              <button onClick={onRemove} className="px-1.5 h-5 rounded bg-red-600 text-white font-semibold">Remove</button>
              <button onClick={() => setConfirmRemove(false)} className="px-1.5 h-5 rounded border border-zinc-300 text-zinc-600 bg-white">Keep</button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmRemove(true)}
              title="Remove this block from the theme"
              className="w-6 h-6 rounded border border-zinc-300 bg-white/70 text-zinc-400 hover:text-red-600 text-[11px]"
            >×</button>
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
            <input
              value={editJustification}
              onChange={e => setEditJustification(e.target.value)}
              placeholder="Why did you change this synthesis? (optional)"
              className="w-full h-7 border border-blue-200 bg-white rounded px-2 text-[10px] text-zinc-700 outline-none focus:border-blue-400"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDraft(block.content); setEditJustification(''); setEditingContent(false) }} className="px-2 py-0.5 text-[10px] border border-zinc-300 rounded text-zinc-600 hover:bg-zinc-50">Cancel</button>
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

// ── Add custom analyst ────────────────────────────────────────────────────────
function AddAnalystForm({ theme, onClose }: { theme: Theme; onClose: () => void }) {
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

    setGenerating(true)
    try {
      const res = await apiFetch(`${API}/synthesis/regenerate-block`, {
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

// ── Main screen ───────────────────────────────────────────────────────────────
export function ScreenSynthesisGap() {
  const { state, dispatch } = useApp()
  // The selected theme lives in the store, so a theme just added (by the
  // reviewer or the assistant) is the one shown, and the choice survives reload.
  const activeThemeId = state.activeThemeId
  const setActiveThemeId = (themeId: string) => dispatch({ type: 'SET_ACTIVE_THEME', themeId })
  const [showAddAnalyst, setShowAddAnalyst] = useState(false)
  const [showNewTheme, setShowNewTheme] = useState(false)
  // Theme ids whose blocks are being drafted right now, for the spinner.
  const [fillingThemeIds, setFillingThemeIds] = useState<string[]>([])
  const [density, setDensity] = useState<MatrixDensity>('full')
  const [columnScope, setColumnScope] = useState<ColumnScope>('all')
  const [generationError, setGenerationError] = useState<string | null>(null)

  // Gap-axis selection (one literature column and/or one system column).
  const [gapCols, setGapCols] = useState<string[]>([])
  const [gapSysCols, setGapSysCols] = useState<string[]>([])
  const [axisLoading, setAxisLoading] = useState<string | null>(null)

  // Overall gap statement
  const [gapDraft, setGapDraft] = useState(state.gapStatement)
  const [gapJustification, setGapJustification] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const [showRegenModal, setShowRegenModal] = useState(false)
  const [customRegenPrompt, setCustomRegenPrompt] = useState<string | null>(null)

  // Themes, when the matrix step has not produced them yet
  const [synthesising, setSynthesising] = useState(false)
  const [showSynthModal, setShowSynthModal] = useState(false)
  const [customSynthPrompt, setCustomSynthPrompt] = useState<string | null>(null)

  const activeTheme = state.themes.find(t => t.id === activeThemeId) ?? state.themes[0]
  const litCols = activeTheme?.sourceColumns ?? []
  const sysCols = activeTheme?.systemSourceColumns ?? []
  const LIT_AVAIL = state.matrixColumns.filter(c => !META_COLS.has(c) && !litCols.includes(c))
  const SYS_AVAIL = (state.systemMatrixColumns ?? []).filter(c => !sysCols.includes(c))
  const hasSysData = (state.systemMatrixRows ?? []).length > 0 && (state.systemMatrixColumns ?? []).length > 0
  const allLitColCount = state.matrixColumns.filter(c => !META_COLS.has(c)).length
  const allSysColCount = hasSysData ? (state.systemMatrixColumns ?? []).length : 0
  // A generated theme can name a column that has since been removed or renamed
  // in the matrix; it is counted only where it can actually be shown.
  const themeColCount =
    litCols.filter(c => state.matrixColumns.includes(c)).length +
    (hasSysData ? sysCols.filter(c => (state.systemMatrixColumns ?? []).includes(c)).length : 0)
  // Who picked the highlighted columns — the model, or the reviewer.
  const themeLabel = activeTheme?.userDefined ? 'your choice' : 'AI-selected'
  const wordCount = gapDraft.split(/\s+/).filter(Boolean).length

  // ── Payload builders ───────────────────────────────────────────────────────
  function litRows() {
    return state.matrixRows.map(r => ({
      title: r.title, authors: r.authors, year: r.year,
      cells: Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, {
        value: c.value, confidenceScore: c.confidenceScore,
        confidenceLevel: c.confidenceLevel, evidenceType: c.evidenceType,
        extractionMethod: c.extractionMethod,
      }])),
    }))
  }

  function systemRows() {
    const selectedSystems = (state.systemItems ?? []).filter(s => s.selected)
    return (state.systemMatrixRows ?? [])
      .filter(r => selectedSystems.some(s => s.id === r.systemId))
      .map(r => ({
        name: r.name, vendor: r.vendor, category: r.category,
        cells: Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, {
          value: c.value, confidenceScore: c.confidenceScore,
          confidenceLevel: c.confidenceLevel, evidenceType: c.evidenceType,
          extractionMethod: c.extractionMethod,
        }])),
      }))
  }

  function buildGapPayload(prompt?: string | null, focusCols: string[] = [], focusSysCols: string[] = []) {
    return {
      custom_system_prompt: prompt ?? null,
      matrix_rows: litRows(),
      system_rows: systemRows(),
      columns: state.matrixColumns,
      system_columns: state.systemMatrixColumns ?? [],
      focus_columns: focusCols,
      focus_system_columns: focusSysCols,
      profile: state.profile,
      topics: state.topics.filter(t => t.selected).map(t => ({
        title: t.title, description: t.description, type: t.type,
      })),
      themes: state.themes.map(t => ({
        name: t.name,
        coverageLabel: t.coverageLabel,
        blocks: t.blocks.map(b => ({ blockType: b.blockType, content: b.content })),
      })),
      // The gap analysis is asked what is methodologically weak; with the
      // appraisal attached it can name the domain that actually failed.
      rob_summaries: buildRobSummaries(state),
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async function handleGenerateThemes(prompt?: string | null) {
    setSynthesising(true)
    setGenerationError(null)
    try {
      const res = await apiFetch(`${API}/synthesis/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom_system_prompt: prompt ?? null,
          matrix_rows: litRows(),
          system_rows: systemRows(),
          columns: state.matrixColumns,
          system_columns: state.systemMatrixColumns ?? [],
          rob_summaries: buildRobSummaries(state),
          profile: state.profile,
          topics: state.topics.filter(t => t.selected).map(t => ({
            title: t.title, description: t.description, type: t.type,
          })),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `Synthesis generation failed (HTTP ${res.status})`)
      }
      const data = await res.json()
      if (!data.themes?.length) throw new Error('Synthesis generation returned no themes.')
      dispatch({ type: 'SET_THEMES', themes: data.themes })
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Synthesis generation failed.')
    } finally {
      setSynthesising(false)
    }
  }

  async function handleRegenerateBlock(block: SynthesisBlock, customPrompt?: string | null) {
    if (!activeTheme) return
    await regenerateBlockFor(activeTheme, block, customPrompt)
  }

  /**
   * Draft every empty block of a theme.
   *
   * Takes the theme itself rather than reading the active one: it runs straight
   * after a theme is added, before the render that would make it active.
   * Sequential rather than parallel so one failure stops the run with the
   * blocks before it kept, instead of four half-answered requests.
   */
  async function fillThemeBlocks(theme: Theme) {
    const empty = theme.blocks.filter(b => b.blockType !== 'custom' && !b.content.trim())
    if (empty.length === 0) return
    setFillingThemeIds(ids => [...ids, theme.id])
    try {
      for (const block of empty) {
        const ok = await regenerateBlockFor(theme, block)
        if (!ok) break
      }
    } finally {
      setFillingThemeIds(ids => ids.filter(id => id !== theme.id))
    }
  }

  function handleCreateTheme(theme: Theme, fillWithAi: boolean) {
    dispatch({ type: 'ADD_THEME', theme })
    setShowNewTheme(false)
    setShowAddAnalyst(false)
    if (fillWithAi) void fillThemeBlocks(theme)
  }

  async function regenerateBlockFor(theme: Theme, block: SynthesisBlock, customPrompt?: string | null): Promise<boolean> {
    setGenerationError(null)
    try {
      const res = await apiFetch(`${API}/synthesis/regenerate-block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block_type: block.blockType,
          block_title: block.title,
          theme_name: theme.name,
          source_columns: theme.sourceColumns,
          matrix_rows: litRows(),
          system_rows: systemRows(),
          columns: state.matrixColumns,
          system_columns: state.systemMatrixColumns ?? [],
          profile: state.profile,
          custom_system_prompt: customPrompt ?? null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `Block regeneration failed (HTTP ${res.status})`)
      }
      const data = await res.json()
      if (!data.content?.trim()) throw new Error('Block regeneration returned empty content.')
      dispatch({
        type: 'UPDATE_SYNTHESIS_BLOCK', themeId: theme.id, blockId: block.id, content: data.content,
        stats: typeof data.paper_count === 'number'
          ? { paperCount: data.paper_count, avgConfidence: data.avg_confidence ?? 0, isLowConfidence: Boolean(data.is_low_confidence) }
          : undefined,
      })
      return true
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Block regeneration failed.')
      return false
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
    } finally {
      setAxisLoading(current => (current === key ? null : current))
    }
  }

  async function handleRegenerateOverall(prompt?: string | null) {
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
        throw new Error(body?.detail || `Gap generation failed (HTTP ${res.status})`)
      }
      const data = await res.json()
      if (!data.statement?.trim()) throw new Error('Gap generation returned an empty statement.')
      dispatch({ type: 'UPDATE_GAP_STATEMENT', text: data.statement })
      setGapDraft(data.statement)
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Gap generation failed.')
    } finally {
      setRegenerating(false)
    }
  }

  function saveGapEdit() {
    if (gapDraft === state.gapStatement) return
    dispatch({ type: 'UPDATE_GAP_STATEMENT', text: gapDraft })
    dispatch({
      type: 'ADD_DECISION_JOURNAL_ENTRY',
      entry: journalEntry({
        kind: 'justification',
        step: 6,
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

  function toggleGapCol(col: string) {
    const isSelected = gapCols.includes(col)
    setGapCols(isSelected ? [] : [col])
    if (!isSelected && !state.axisGaps[`lit:${col}`]) void handleGenerateAxisGap('lit', col)
  }

  function toggleGapSysCol(col: string) {
    const isSelected = gapSysCols.includes(col)
    setGapSysCols(isSelected ? [] : [col])
    if (!isSelected && !state.axisGaps[`sys:${col}`]) void handleGenerateAxisGap('sys', col)
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
        <span className="text-[11px] text-zinc-500">Step 6 · Synthesis &amp; Gap</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left — Themes */}
        <aside className="w-[210px] shrink-0 bg-zinc-50 border-r border-zinc-200 flex flex-col overflow-hidden">
          <div className="px-3 pt-3 pb-2 shrink-0 flex items-center gap-2">
            <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide flex-1">Themes</span>
            {state.themes.length > 0 && (
              <button
                onClick={() => handleGenerateThemes(customSynthPrompt)}
                disabled={synthesising}
                title="Regenerate the themes from the current matrix"
                className="text-[9px] text-zinc-400 hover:text-zinc-700 disabled:opacity-50"
              >
                {synthesising ? '…' : '↺'}
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {state.themes.length === 0 && !showNewTheme && (
              <p className="text-[10px] text-zinc-400 italic px-1 py-3">
                No themes yet — generate them from the matrix, or define your own below.
              </p>
            )}
            {state.themes.map(theme => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                active={theme.id === (activeTheme?.id ?? '')}
                onClick={() => { setActiveThemeId(theme.id); setShowAddAnalyst(false) }}
              />
            ))}
            {showNewTheme ? (
              <NewThemeForm onCreate={handleCreateTheme} onClose={() => setShowNewTheme(false)} />
            ) : (
              <button
                onClick={() => setShowNewTheme(true)}
                title="Define a theme of your own — its name and the matrix columns it draws on"
                className="w-full mb-3 py-1.5 border-2 border-dashed border-zinc-300 rounded text-[10px] text-zinc-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
              >
                + New theme
              </button>
            )}
          </div>
        </aside>

        {/* Right — one matrix, then synthesis, then gap */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          <div className="flex-1 overflow-y-auto px-4 py-4">

            {/* ── 1. The evidence matrix, shown once ── */}
            <section className="border border-zinc-200 rounded-lg mb-5">
              <div className="px-3 py-2 border-b border-zinc-100 flex items-center gap-2">
                <span className="text-[11px] font-bold text-zinc-800 flex-1">Evidence Matrix</span>
                <div data-review-allow className="flex rounded overflow-hidden border border-zinc-300 text-[9px]">
                  {(['all', 'theme'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setColumnScope(mode)}
                      disabled={mode === 'theme' && !activeTheme}
                      title={mode === 'all'
                        ? 'Every matrix column, with the ones this theme uses highlighted'
                        : 'Only the columns this theme uses'}
                      className={`px-2 h-5 disabled:opacity-40 ${columnScope === mode ? 'bg-blue-600 text-white' : 'bg-white text-zinc-500 hover:bg-zinc-50'}`}
                    >
                      {mode === 'all' ? `All columns (${allLitColCount + allSysColCount})` : `Theme columns (${themeColCount})`}
                    </button>
                  ))}
                </div>
                <div data-review-allow className="flex rounded overflow-hidden border border-zinc-300 text-[9px]">
                  {(['full', 'compact'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setDensity(mode)}
                      title={mode === 'full' ? 'Show every cell in full — scroll the table both ways' : 'One line per cell, to see the coverage pattern of a wide schema'}
                      className={`px-2 h-5 ${density === mode ? 'bg-zinc-800 text-white' : 'bg-white text-zinc-500 hover:bg-zinc-50'}`}
                    >
                      {mode === 'full' ? 'Full text' : 'Compact'}
                    </button>
                  ))}
                </div>
                <span className="text-[9px] text-zinc-400">
                  {state.matrixRows.length} of {state.reviewList.length} papers extracted
                  {state.reviewList.length - state.matrixRows.length > 0 && (
                    <span className="text-red-600 font-semibold"> · {state.reviewList.length - state.matrixRows.length} not yet in matrix</span>
                  )}
                </span>
              </div>

              {/* Legend */}
              <div className="px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-100">
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
                <span className="text-[8px] text-zinc-400"><span className="italic">~val</span> = inferred (reliability risk)</span>
                {activeTheme && themeColCount > 0 && (
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-blue-600" style={THEME_COL_RAIL} />
                    <span className="text-[8px] text-zinc-600 font-medium">
                      ★ = used by “{activeTheme.name}” ({themeLabel})
                    </span>
                  </div>
                )}
                <div className="flex-1" />
                <span className="text-[8px] text-zinc-400">Click any column header to analyse its gap</span>
              </div>

              {/* Which columns the active theme synthesises from */}
              {activeTheme && (
                <div className="px-3 py-2 border-b border-zinc-100 bg-blue-50/30 space-y-2">
                  <div>
                    <p className="text-[8px] font-bold text-blue-500 uppercase tracking-wide mb-1.5">
                      Highlighted columns — what “{activeTheme.name}” draws on ({themeLabel}; add or remove to change it)
                    </p>
                    <ColChips
                      selected={litCols}
                      available={LIT_AVAIL}
                      onAdd={col => dispatch({ type: 'UPDATE_THEME_COLUMNS', themeId: activeTheme.id, columns: [...litCols, col] })}
                      onRemove={col => dispatch({ type: 'UPDATE_THEME_COLUMNS', themeId: activeTheme.id, columns: litCols.filter(c => c !== col) })}
                      colorClass="blue"
                    />
                  </div>
                  {hasSysData && (
                    <div>
                      <p className="text-[8px] font-bold text-violet-500 uppercase tracking-wide mb-1.5">System columns</p>
                      <ColChips
                        selected={sysCols}
                        available={SYS_AVAIL}
                        onAdd={col => dispatch({ type: 'UPDATE_THEME_SYSTEM_COLUMNS', themeId: activeTheme.id, columns: [...sysCols, col] })}
                        onRemove={col => dispatch({ type: 'UPDATE_THEME_SYSTEM_COLUMNS', themeId: activeTheme.id, columns: sysCols.filter(c => c !== col) })}
                        colorClass="violet"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="px-3 py-2">
                <LiteratureHeatmap
                  gapCols={gapCols} themeCols={litCols} onGapToggle={toggleGapCol}
                  density={density} scope={activeTheme ? columnScope : 'all'} themeLabel={themeLabel}
                />
                <SystemHeatmap
                  gapCols={gapSysCols} themeCols={sysCols} onGapToggle={toggleGapSysCol}
                  density={density} scope={activeTheme ? columnScope : 'all'} themeLabel={themeLabel}
                />
              </div>
            </section>

            {/* ── 2. Synthesis ── */}
            <section className="mb-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide flex-1">
                  Synthesis{activeTheme ? ` — ${activeTheme.name}` : ''}
                </span>
                {activeTheme && fillingThemeIds.includes(activeTheme.id) ? (
                  <span className="flex items-center gap-1 text-[9px] text-violet-600">
                    <span className="w-2.5 h-2.5 border border-violet-300 border-t-violet-600 rounded-full animate-spin" />
                    Drafting blocks…
                  </span>
                ) : activeTheme && activeTheme.blocks.some(b => b.blockType !== 'custom' && !b.content.trim()) && (
                  <button
                    onClick={() => void fillThemeBlocks(activeTheme)}
                    disabled={(activeTheme.sourceColumns ?? []).length + (activeTheme.systemSourceColumns ?? []).length === 0}
                    title={(activeTheme.sourceColumns ?? []).length + (activeTheme.systemSourceColumns ?? []).length === 0
                      ? 'Link at least one matrix column to this theme first'
                      : 'Draft every empty block of this theme from the columns it draws on'}
                    className="px-2 h-5 rounded border border-violet-300 text-[9px] text-violet-700 hover:bg-violet-50 disabled:opacity-40"
                  >
                    ✦ Fill empty blocks
                  </button>
                )}
                <AIBadge />
              </div>

              {state.themes.length === 0 ? (
                <div className="border-2 border-dashed border-zinc-200 rounded-lg px-4 py-6 text-center">
                  <p className="text-[11px] text-zinc-500 mb-1">No synthesis yet.</p>
                  <p className="text-[10px] text-zinc-400 mb-3">
                    Themes are read out of the matrix above — generate them once the extraction looks right,
                    or define your own with <span className="font-semibold">+ New theme</span> on the left.
                  </p>
                  <div className="inline-flex rounded overflow-hidden border border-zinc-300">
                    <button
                      onClick={() => handleGenerateThemes(customSynthPrompt)}
                      disabled={synthesising || state.matrixRows.length === 0}
                      className="px-4 h-8 bg-zinc-900 text-white text-[11px] font-semibold hover:bg-zinc-700 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {synthesising && <span className="w-3 h-3 border border-zinc-500 border-t-white rounded-full animate-spin" />}
                      {customSynthPrompt && <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />}
                      {synthesising ? 'Synthesising…' : 'Generate synthesis'}
                    </button>
                    <button
                      onClick={() => setShowSynthModal(true)}
                      disabled={synthesising}
                      title="Customize AI prompt"
                      className="px-2 h-8 bg-zinc-800 text-zinc-400 text-[10px] hover:bg-zinc-600 hover:text-zinc-200 disabled:opacity-50 border-l border-zinc-700"
                    >
                      ⚙
                    </button>
                  </div>
                  {state.matrixRows.length === 0 && (
                    <p className="text-[9px] text-zinc-400 mt-2">Extract at least one paper in the matrix step first.</p>
                  )}
                </div>
              ) : activeTheme && (
                <>
                  {activeTheme.blocks.map(block => (
                    <SynthesisBlockCard
                      key={block.id}
                      block={block}
                      theme={activeTheme}
                      onRegenerate={handleRegenerateBlock}
                      onRemove={() => dispatch({ type: 'REMOVE_SYNTHESIS_BLOCK', themeId: activeTheme.id, blockId: block.id })}
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
            </section>

            {/* ── 3. Schema-axis gaps ── */}
            <section className="mb-5">
              <span className="block text-[9px] font-bold text-zinc-400 uppercase tracking-wide mb-2">
                Schema Gaps
              </span>
              {gapCols.length === 0 && gapSysCols.length === 0 ? (
                <p className="text-[10px] text-zinc-400 border border-dashed border-zinc-200 rounded-lg px-3 py-4">
                  Click a column header in the matrix above to compare every paper or system on that one direction
                  and name the gap it leaves.
                </p>
              ) : (
                <div className="space-y-3">
                  {gapCols.map(col => (
                    <AxisGapCard
                      key={`lit-${col}`}
                      col={col}
                      kind="lit"
                      reported={state.matrixRows.filter(r => r.cells[col]?.value).length}
                      total={state.matrixRows.length}
                      gap={state.axisGaps[`lit:${col}`]}
                      loading={axisLoading === `lit:${col}`}
                      onGenerate={() => handleGenerateAxisGap('lit', col)}
                      onClose={() => setGapCols([])}
                    />
                  ))}
                  {gapSysCols.map(col => (
                    <AxisGapCard
                      key={`sys-${col}`}
                      col={col}
                      kind="sys"
                      reported={(state.systemMatrixRows ?? []).filter(r => r.cells[col]?.value).length}
                      total={(state.systemMatrixRows ?? []).length}
                      gap={state.axisGaps[`sys:${col}`]}
                      loading={axisLoading === `sys:${col}`}
                      onGenerate={() => handleGenerateAxisGap('sys', col)}
                      onClose={() => setGapSysCols([])}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* ── 4. Overall gap statement ── */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide flex-1">Overall Gap Statement</span>
                <AIBadge />
              </div>
              <p className="text-[10px] italic text-purple-400 mb-2">
                Drafted from every paper, the selected systems and the synthesis above. Column-specific gaps stay in Schema Gaps.
              </p>

              <textarea
                value={gapDraft}
                onChange={e => setGapDraft(e.target.value)}
                placeholder="Generate a gap statement, or write your own."
                className="w-full bg-zinc-50 border border-zinc-300 rounded-lg p-3 text-[11px] text-zinc-800 resize-none focus:outline-none focus:border-zinc-500 leading-relaxed mb-2"
                style={{ height: 200 }}
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

              <div className="flex justify-end mb-2">
                <div className="flex rounded overflow-hidden border border-zinc-300">
                  <button
                    onClick={() => handleRegenerateOverall(customRegenPrompt)}
                    disabled={regenerating}
                    className="flex items-center gap-1.5 px-3 h-7 text-[11px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
                  >
                    {regenerating
                      ? <span className="w-3 h-3 border border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
                      : '↺'}
                    {customRegenPrompt && <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />}
                    {regenerating
                      ? 'Generating overall gap…'
                      : state.gapStatement ? 'Regenerate overall gap' : 'Generate overall gap'}
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
            </section>
          </div>

          {/* Footer */}
          <div className="h-12 border-t border-zinc-200 bg-white flex items-center justify-end px-4 gap-3 shrink-0">
            {generationError && (
              <span className="text-[10px] text-red-600 flex-1 truncate" title={generationError}>
                {generationError}
              </span>
            )}
            <button
              onClick={handleConfirm}
              className="flex items-center gap-2 px-5 h-9 bg-zinc-900 text-white rounded text-[12px] font-semibold hover:bg-zinc-700 transition-colors"
            >
              Confirm → Final Question
            </button>
          </div>
        </div>
      </div>

      {showRegenModal && (
        <CustomizePromptModal
          promptKey="gaps-generate"
          title="Generate Gap Statement"
          initialCustomPrompt={customRegenPrompt}
          onClose={() => setShowRegenModal(false)}
          onGenerate={(prompt) => {
            setCustomRegenPrompt(prompt)
            setShowRegenModal(false)
            handleRegenerateOverall(prompt)
          }}
        />
      )}
      {showSynthModal && (
        <CustomizePromptModal
          promptKey="synthesis-generate"
          title="Generate Synthesis"
          initialCustomPrompt={customSynthPrompt}
          onClose={() => setShowSynthModal(false)}
          onGenerate={(prompt) => {
            setCustomSynthPrompt(prompt)
            setShowSynthModal(false)
            handleGenerateThemes(prompt)
          }}
        />
      )}
    </div>
  )
}
