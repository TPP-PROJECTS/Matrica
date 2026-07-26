import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/AppContext'
import { CustomizePromptModal } from '../components/shared/CustomizePromptModal'
import { SchemaBuilder } from '../components/matrix/SchemaBuilder'
import type { MatrixCell, ConfidenceLevel, SystemMatrixRow, ResultCard, SystemItem } from '../types'
import { API, apiFetch } from '../lib/api'
import { runPool } from '../lib/runPool'
import { partitionNewPapers } from '../lib/dedupe'
import { journalEntry } from '../lib/decisionJournal'

// How many auto-fill requests are in flight at once. Enough to hide most of the
// per-request latency without hammering the API from a single browser tab.
const FILL_CONCURRENCY = 4


// ── Evidence popover types ────────────────────────────────────────────────────
interface EvidenceTarget {
  rect: DOMRect
  cell: MatrixCell
  column: string
  // literature context
  paperTitle?: string
  paperAbstract?: string
  paperAuthors?: string
  paperYear?: number
  // system context
  systemName?: string
  systemVendor?: string
  systemDescription?: string
}

// ── Evidence popover (fixed overlay) ─────────────────────────────────────────
function EvidencePopover({
  target,
  domain,
  focus,
  onClose,
}: {
  target: EvidenceTarget
  domain: string
  focus: string
  onClose: () => void
}) {
  const { dispatch } = useApp()
  const [reasoning, setReasoning] = useState<string | null>(null)
  const [sources, setSources] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Position the popover to the right of the button, flip left if near right edge
  const POPOVER_W = 320
  const vw = window.innerWidth
  const left = target.rect.right + 10 + POPOVER_W > vw
    ? target.rect.left - POPOVER_W - 10
    : target.rect.right + 10
  const top = Math.min(target.rect.top, window.innerHeight - 280)

  useEffect(() => {
    async function fetch_() {
      try {
        const res = await apiFetch(`${API}/matrix/cell-evidence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cell_value: target.cell.value,
            column_name: target.column,
            paper_title: target.paperTitle ?? '',
            paper_abstract: target.paperAbstract ?? '',
            paper_authors: target.paperAuthors ?? '',
            paper_year: target.paperYear ?? null,
            system_name: target.systemName ?? '',
            system_vendor: target.systemVendor ?? '',
            system_description: target.systemDescription ?? '',
            domain,
            focus,
          }),
        })
        if (!res.ok) throw new Error()
        const data = await res.json()
        setReasoning(data.reasoning)
        setSources(data.sources ?? [])
        dispatch({
          type: 'ADD_DECISION_JOURNAL_ENTRY',
          entry: journalEntry({
            kind: 'ai_explanation_view',
            step: 6,
            action: 'Viewed matrix evidence and reasoning',
            entityType: 'matrix_cell',
            entityId: `${target.paperTitle || target.systemName || 'row'}:${target.column}`,
            entityLabel: `${target.paperTitle || target.systemName || 'Matrix row'} — ${target.column}`,
            details: [
              data.reasoning,
              ...(data.sources ?? []).map((source: string) => `Source: ${source}`),
            ].filter(Boolean).join('\n'),
          }),
        })
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    fetch_()
  // The evidence target is immutable for the lifetime of this popover.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Popover card */}
      <div
        className="fixed z-50 bg-white border border-zinc-200 rounded-xl shadow-2xl flex flex-col"
        style={{ left, top, width: POPOVER_W, maxHeight: 340 }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-100 shrink-0">
          <span className="w-5 h-5 rounded-full bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">?</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-zinc-800 truncate">{target.column}</p>
            <p className="text-[9px] text-zinc-400 truncate">{target.paperTitle || target.systemName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-[14px] leading-none shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 py-4 justify-center">
              <span className="w-4 h-4 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
              <span className="text-[11px] text-zinc-400">Reasoning…</span>
            </div>
          )}

          {error && (
            <p className="text-[11px] text-red-500 py-4 text-center">Could not load evidence.</p>
          )}

          {!loading && !error && reasoning && (
            <>
              <div>
                <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5">Evidence & Reasoning</p>
                <p className="text-[11px] text-zinc-700 leading-relaxed">{reasoning}</p>
              </div>

              {sources.length > 0 && (
                <div>
                  <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5">Sources</p>
                  <ul className="space-y-1">
                    {sources.map((s, i) => (
                      <li key={i} className="text-[10px] text-violet-700 leading-snug flex gap-1.5">
                        <span className="text-zinc-300 shrink-0 mt-0.5">·</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Cell value preview */}
        <div className="px-3 py-2 border-t border-zinc-100 bg-zinc-50 rounded-b-xl shrink-0">
          <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mb-0.5">Cell value</p>
          <p className="text-[10px] text-zinc-600 italic line-clamp-2">"{target.cell.value}"</p>
        </div>
      </div>
    </>
  )
}

// ── Clean cell renderer (no dots, no badges) ──────────────────────────────────
function CellContent({
  cell,
  onEvidence,
}: {
  cell: MatrixCell | undefined
  column: string
  onEvidence?: (rect: DOMRect) => void
}) {
  if (!cell || cell.evidenceType === 'not_available') {
    return (
      <td className="border border-zinc-200 bg-zinc-50 px-2 py-1 min-w-[140px]">
        <span className="text-[8px] italic text-zinc-300">—</span>
      </td>
    )
  }

  return (
    <td className="relative border border-zinc-200 bg-white px-2 py-1.5 min-w-[140px] group">
      <p className="text-[10px] text-zinc-800 leading-snug pr-5">{cell.value}</p>
      {onEvidence && (
        <button
          onClick={e => {
            e.stopPropagation()
            onEvidence(e.currentTarget.getBoundingClientRect())
          }}
          className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-zinc-200 text-zinc-500 text-[8px] font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-violet-600 hover:text-white transition-all"
          title="Show evidence"
        >
          ?
        </button>
      )}
    </td>
  )
}

// ── Pending cell (autofill in progress) ──────────────────────────────────────
function PendingCell() {
  return (
    <td className="border border-violet-100 bg-violet-50/40 px-2 py-2 min-w-[140px]">
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 border border-violet-300 border-t-violet-600 rounded-full animate-spin shrink-0" />
        <span className="text-[9px] text-violet-400 italic">filling…</span>
      </div>
    </td>
  )
}

// ── Editable column header (rename / delete) ─────────────────────────────────
function ColumnHeader({ col, borderClass, description, emptyCount, onFill, busy }: {
  col: string
  borderClass: string
  description?: string
  /** Cells still empty in this column; the fill button is pointless at 0. */
  emptyCount?: number
  onFill?: (col: string) => void
  busy?: boolean
}) {
  const ref = useRef<HTMLTableCellElement>(null)
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null)

  function showTip() {
    if (!description) return
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const width = 280
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    setTip({ left, top: r.bottom + 4 })
  }

  return (
    <th
      ref={ref}
      onMouseEnter={showTip}
      onMouseLeave={() => setTip(null)}
      className={`border ${borderClass} px-2 py-1.5 text-[9px] font-semibold text-white min-w-[140px] ${description ? 'cursor-help' : ''}`}
    >
      <span className="inline-flex items-center gap-1">
        <span>{col}</span>
        {description && <span className="text-white/50 text-[8px]" aria-hidden>ⓘ</span>}
        {onFill && (emptyCount ?? 0) > 0 && (
          <button
            onClick={e => { e.stopPropagation(); onFill(col) }}
            disabled={busy}
            title={`Fill the ${emptyCount} empty cell${emptyCount === 1 ? '' : 's'} in this column`}
            className="ml-0.5 px-1 rounded bg-purple-600 text-white text-[8px] font-bold hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ✦{emptyCount}
          </button>
        )}
      </span>
      {tip && description && (
        <div
          style={{ position: 'fixed', left: tip.left, top: tip.top, width: 280, zIndex: 60 }}
          className="px-2.5 py-1.5 rounded-md bg-zinc-900 text-white text-[10px] font-normal normal-case leading-snug shadow-xl border border-zinc-700 pointer-events-none whitespace-normal"
        >
          <span className="block font-semibold mb-0.5">{col}</span>
          {description}
        </div>
      )}
    </th>
  )
}

// Fresh recommendation pool for a Regenerate: replaces the previous pool.
// Drops internal duplicates and anything already chosen as a column.
function freshSuggestions(fresh: string[], exclude: string[]): string[] {
  const ex = new Set(exclude.map(c => c.toLowerCase().trim()))
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of fresh) {
    const k = c.toLowerCase().trim()
    if (ex.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(c)
  }
  return out
}

function mergeColumnOptions(...groups: string[][]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const group of groups) {
    for (const col of group) {
      const k = col.toLowerCase().trim()
      if (!k || seen.has(k)) continue
      seen.add(k)
      out.push(col)
    }
  }
  return out
}

// Keep only descriptions for columns the user hasn't already selected, so a
// regenerate never rewrites the description of a column already in the matrix.
function newColumnDescriptions(descriptions: Record<string, string> | undefined, exclude: string[]): Record<string, string> {
  if (!descriptions) return {}
  const ex = new Set(exclude.map(c => c.toLowerCase().trim()))
  return Object.fromEntries(Object.entries(descriptions).filter(([k]) => !ex.has(k.toLowerCase().trim())))
}

function EditColumnsModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl flex flex-col w-[720px] max-h-[85vh]">
        <div className="flex items-center px-5 py-3.5 border-b border-zinc-200 shrink-0">
          <span className="text-[13px] font-bold text-zinc-900 flex-1">{title}</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-[18px] leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex items-center justify-end px-5 py-3 border-t border-zinc-200 shrink-0">
          <button onClick={onClose} className="px-4 h-8 bg-zinc-900 text-white rounded text-[11px] font-semibold hover:bg-zinc-700">Done</button>
        </div>
      </div>
    </div>
  )
}

// ── Add papers modal (file upload + URL/DOI) ─────────────────────────────────
interface ParseItem {
  key: string
  kind: 'file' | 'url'
  label: string
  status: 'pending' | 'parsing' | 'done' | 'error'
  error?: string
  file?: File
  url?: string
  paper?: ResultCard
}

function AddPapersModal({ onClose, onAdd }: { onClose: () => void; onAdd: (papers: ResultCard[]) => void }) {
  const [items, setItems] = useState<ParseItem[]>([])
  const [urlText, setUrlText] = useState('')
  const [parsing, setParsing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setItems(prev => [
      ...prev,
      ...Array.from(files).map((f, i) => ({
        key: `f_${Date.now()}_${i}`, kind: 'file' as const, label: f.name, status: 'pending' as const, file: f,
      })),
    ])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function addUrls() {
    const urls = urlText.split('\n').map(s => s.trim()).filter(Boolean)
    if (urls.length === 0) return
    setItems(prev => [
      ...prev,
      ...urls.map((u, i) => ({
        key: `u_${Date.now()}_${i}`, kind: 'url' as const, label: u, status: 'pending' as const, url: u,
      })),
    ])
    setUrlText('')
  }

  async function parseAll() {
    if (parsing) return
    setParsing(true)
    const queue = items.filter(it => it.status === 'pending' || it.status === 'error')
    for (const it of queue) {
      setItems(prev => prev.map(p => p.key === it.key ? { ...p, status: 'parsing', error: undefined } : p))
      try {
        let res: Response
        if (it.kind === 'file' && it.file) {
          const fd = new FormData()
          fd.append('file', it.file)
          res = await apiFetch(`${API}/matrix/ingest-paper-file`, { method: 'POST', body: fd })
        } else {
          res = await apiFetch(`${API}/matrix/ingest-paper-url`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: it.url }),
          })
        }
        if (!res.ok) {
          const detail = await res.json().then(d => d.detail).catch(() => null)
          throw new Error(typeof detail === 'string' ? detail : 'Parse failed')
        }
        const data = await res.json()
        const paper: ResultCard = {
          id: `up_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title: data.title,
          authors: data.authors ?? '',
          year: data.year ?? 0,
          source: data.source ?? (it.kind === 'file' ? 'upload' : 'url'),
          relevanceScore: 0,
          abstract: data.abstract ?? '',
          topicId: '', queryId: '', confidence: 'none',
          isDuplicate: false, status: 'included', notes: '',
        }
        setItems(prev => prev.map(p => p.key === it.key ? { ...p, status: 'done', paper } : p))
      } catch (e) {
        setItems(prev => prev.map(p => p.key === it.key
          ? { ...p, status: 'error', error: e instanceof Error ? e.message : 'Parse failed' } : p))
      }
    }
    setParsing(false)
  }

  const parsed = items.filter(it => it.status === 'done' && it.paper)
  const hasQueue = items.some(it => it.status === 'pending' || it.status === 'error')

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={parsing ? undefined : onClose} />
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[460px] max-h-[80vh] bg-white rounded-xl shadow-2xl flex flex-col">
        <div className="flex items-center px-4 py-3 border-b border-zinc-100 shrink-0">
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-zinc-800">Add papers to matrix</p>
            <p className="text-[10px] text-zinc-400">Upload PDF/text files or paste URLs / DOIs — one per line</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-[15px]">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,application/pdf,text/plain"
              className="hidden"
              onChange={e => addFiles(e.target.files)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 h-16 border-2 border-dashed border-zinc-300 rounded-lg text-[11px] text-zinc-500 hover:border-purple-400 hover:text-purple-600 transition-colors"
            >
              ⬆ Choose PDF / text files
            </button>
          </div>

          <div className="flex gap-2 items-start">
            <textarea
              value={urlText}
              onChange={e => setUrlText(e.target.value)}
              placeholder={'https://doi.org/10.1000/xyz\nhttps://pubmed.ncbi.nlm.nih.gov/…'}
              rows={2}
              className="flex-1 border border-zinc-300 rounded px-2 py-1.5 text-[11px] text-zinc-800 outline-none focus:border-purple-500 resize-none"
            />
            <button
              onClick={addUrls}
              disabled={!urlText.trim()}
              className="px-3 h-8 border border-zinc-300 rounded text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
            >
              Add
            </button>
          </div>

          {items.length > 0 && (
            <ul className="space-y-1.5">
              {items.map(it => (
                <li key={it.key} className="flex items-start gap-2 border border-zinc-100 rounded px-2 py-1.5">
                  <span className="text-[10px] mt-0.5 shrink-0">{it.kind === 'file' ? '📄' : '🔗'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-zinc-700 truncate">{it.label}</p>
                    {it.status === 'done' && it.paper && (
                      <p className="text-[9px] text-emerald-600 truncate">✓ {it.paper.title}{it.paper.year ? ` (${it.paper.year})` : ''}</p>
                    )}
                    {it.status === 'error' && <p className="text-[9px] text-red-500 truncate">{it.error}</p>}
                  </div>
                  {it.status === 'parsing' && (
                    <span className="w-3 h-3 border border-purple-200 border-t-purple-600 rounded-full animate-spin shrink-0 mt-0.5" />
                  )}
                  {it.status !== 'parsing' && !parsing && (
                    <button
                      onClick={() => setItems(prev => prev.filter(p => p.key !== it.key))}
                      className="text-zinc-300 hover:text-zinc-500 text-[10px] shrink-0"
                    >✕</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-100 shrink-0">
          <span className="text-[10px] text-zinc-400 flex-1">
            {parsed.length > 0 ? `${parsed.length} parsed` : items.length > 0 ? `${items.length} item(s)` : ''}
          </span>
          <button
            onClick={parseAll}
            disabled={!hasQueue || parsing}
            className="px-3 h-7 border border-purple-300 text-purple-700 rounded text-[11px] hover:bg-purple-50 disabled:opacity-40 flex items-center gap-1.5"
          >
            {parsing && <span className="w-2.5 h-2.5 border border-purple-300 border-t-purple-600 rounded-full animate-spin" />}
            {parsing ? 'Parsing…' : 'Parse all'}
          </button>
          <button
            onClick={() => onAdd(parsed.map(it => it.paper!))}
            disabled={parsed.length === 0 || parsing}
            className="px-3 h-7 bg-purple-600 text-white rounded text-[11px] font-medium hover:bg-purple-700 disabled:opacity-40"
          >
            Add {parsed.length > 0 ? parsed.length : ''} paper{parsed.length === 1 ? '' : 's'} to matrix
          </button>
        </div>
      </div>
    </>
  )
}

// ── Add system modal (lookup by name) ────────────────────────────────────────
function AddSystemModal({
  domain,
  focus,
  existingNames,
  onClose,
  onAdd,
}: {
  domain: string
  focus: string
  existingNames: Set<string>
  onClose: () => void
  onAdd: (item: SystemItem) => void
}) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ name: string; description: string; category: string; url: string | null; vendor: string } | null>(null)
  const [added, setAdded] = useState<string[]>([])

  async function search() {
    const q = name.trim()
    if (!q || loading) return
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await apiFetch(`${API}/systems/lookup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: q, domain, focus }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (!data.found) { setError(`No system could be identified for “${q}”.`); return }
      setResult(data)
    } catch {
      setError('Lookup failed — is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  function addResult() {
    if (!result) return
    if (existingNames.has(result.name.toLowerCase().trim()) || added.some(n => n.toLowerCase() === result.name.toLowerCase())) {
      setError(`“${result.name}” is already in the matrix.`)
      return
    }
    onAdd({
      id: `sys-manual-${Date.now()}`,
      name: result.name,
      description: result.description,
      category: result.category || 'other',
      url: result.url ?? null,
      vendor: result.vendor ?? '',
      aiGenerated: false,
      selected: true,
    })
    setAdded(a => [...a, result.name])
    setResult(null)
    setName('')
    setError(null)
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] bg-white rounded-xl shadow-2xl flex flex-col">
        <div className="flex items-center px-4 py-3 border-b border-zinc-100">
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-zinc-800">Add system to matrix</p>
            <p className="text-[10px] text-zinc-400">Type a system name — AI will identify and profile it</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-[15px]">✕</button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="flex gap-2">
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') search() }}
              placeholder="e.g. Epic Systems, IBM Watson Health…"
              className="flex-1 h-8 border border-zinc-300 rounded px-2 text-[11px] text-zinc-800 outline-none focus:border-violet-500"
            />
            <button
              onClick={search}
              disabled={!name.trim() || loading}
              className="px-3 h-8 bg-violet-600 text-white rounded text-[11px] hover:bg-violet-700 disabled:opacity-40 flex items-center gap-1.5"
            >
              {loading && <span className="w-2.5 h-2.5 border border-violet-300 border-t-white rounded-full animate-spin" />}
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>

          {error && <p className="text-[10px] text-red-500">{error}</p>}

          {result && (
            <div className="border border-violet-200 bg-violet-50/40 rounded-lg px-3 py-2.5 space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-[12px] font-semibold text-zinc-800 flex-1">{result.name}</p>
                <span className="text-[8px] px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded">{result.category}</span>
              </div>
              {result.vendor && <p className="text-[10px] text-zinc-500">{result.vendor}</p>}
              <p className="text-[10px] text-zinc-600 leading-relaxed">{result.description}</p>
              {result.url && <p className="text-[9px] text-violet-600 truncate">{result.url}</p>}
              <button
                onClick={addResult}
                className="mt-1 px-3 h-7 bg-violet-600 text-white rounded text-[11px] font-medium hover:bg-violet-700"
              >
                Add to matrix
              </button>
            </div>
          )}

          {added.length > 0 && (
            <p className="text-[10px] text-emerald-600">✓ Added: {added.join(', ')}</p>
          )}
        </div>

        <div className="flex justify-end px-4 py-3 border-t border-zinc-100">
          <button onClick={onClose} className="px-3 h-7 border border-zinc-300 rounded text-[11px] text-zinc-600 hover:bg-zinc-50">Done</button>
        </div>
      </div>
    </>
  )
}

// ── Literature matrix ─────────────────────────────────────────────────────────
function LiteratureMatrix({ onEvidence }: { onEvidence: (t: EvidenceTarget) => void }) {
  const { state, dispatch } = useApp()
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState(false)
  const [filling, setFilling] = useState(false)
  const [fillDone, setFillDone] = useState(0)
  const [fillTotal, setFillTotal] = useState(0)
  const [fillingRowIds, setFillingRowIds] = useState<Set<string>>(new Set())
  const [fillingColumn, setFillingColumn] = useState<string | null>(null)
  const abortRef = useRef(false)
  const [showAutoFillModal, setShowAutoFillModal] = useState(false)
  const [customAutoFillPrompt, setCustomAutoFillPrompt] = useState<string | null>(null)
  const [showEditCols, setShowEditCols] = useState(false)
  const [editColsLoading, setEditColsLoading] = useState(false)
  const [editColsPrompt, setEditColsPrompt] = useState<string | null>(null)
  const [newCols, setNewCols] = useState<string[]>([])
  const [showAddPapers, setShowAddPapers] = useState(false)
  const [columnJustification, setColumnJustification] = useState('')

  const dataCols = state.matrixColumns.filter(
    c => c !== '#' && c !== 'Title' && c !== 'Authors' && c !== 'Year'
  )

  // Re-recommend columns from the *selected papers* (edit context), appended below
  // the existing suggestion pool and deduped against current columns.
  async function regenLitColumns(prompt?: string | null) {
    setEditColsPrompt(prompt ?? null)
    setEditColsLoading(true)
    try {
      const res = await apiFetch(`${API}/matrix/generate-columns`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          papers: state.reviewList.map(p => ({ title: p.title, abstract: p.abstract, authors: p.authors, year: p.year })),
          topics: state.topics.filter(t => t.selected).map(t => ({ title: t.title, description: t.description, type: t.type })),
          profile: state.profile,
          exclude_columns: dataCols,
          custom_system_prompt: prompt ?? null,
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      const fresh = freshSuggestions(data.columns, dataCols)
      dispatch({ type: 'SET_MATRIX_COLUMN_SUGGESTIONS', columns: mergeColumnOptions(state.matrixColumnSuggestions, fresh) })
      setNewCols(fresh)
      const descs = newColumnDescriptions(data.descriptions, dataCols)
      if (Object.keys(descs).length) dispatch({ type: 'MERGE_COLUMN_DESCRIPTIONS', system: false, descriptions: descs })
    } catch { /* keep prior suggestions */ } finally { setEditColsLoading(false) }
  }

  const reviewListIds = new Set(state.reviewList.map(p => p.id))
  const rowsMismatch = state.reviewList.length > 0 &&
    !state.matrixRows.every(r => reviewListIds.has(r.paperId))
  const needsInit = state.reviewList.length > 0 && (
    state.matrixColumns.length === 0 || state.matrixRows.length === 0 || rowsMismatch
  )

  async function runGenerate() {
    setGenerating(true); setGenError(false)
    try {
      const res = await apiFetch(`${API}/matrix/generate-columns`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          papers: state.reviewList.map(p => ({ title: p.title, abstract: p.abstract, authors: p.authors, year: p.year })),
          topics: state.topics.filter(t => t.selected).map(t => ({ title: t.title, description: t.description, type: t.type })),
          profile: state.profile,
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      dispatch({ type: 'SET_MATRIX_COLUMNS', columns: data.columns })
      if (data.descriptions) dispatch({ type: 'MERGE_COLUMN_DESCRIPTIONS', system: false, descriptions: data.descriptions })
      dispatch({ type: 'INIT_MATRIX_ROWS' })
    } catch { setGenError(true) } finally { setGenerating(false) }
  }

  useEffect(() => {
    if (!needsInit || generating) return
    const timer = window.setTimeout(() => { void runGenerate() }, 0)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsInit])

  /**
   * Fill `columns` for each paper. Passing a single column is what the
   * per-column header button uses — adding a column to an established matrix
   * would otherwise mean re-running every row for every column it already has.
   */
  async function fillPapers(
    papers: { id: string; title: string; abstract: string; authors: string; year: number; source?: string }[],
    columns: string[] = dataCols,
    prompt?: string | null,
  ) {
    if (filling || columns.length === 0 || papers.length === 0) return
    abortRef.current = false
    setFilling(true); setFillDone(0); setFillTotal(papers.length)
    setFillingColumn(columns.length === 1 ? columns[0] : null)

    await runPool(papers, FILL_CONCURRENCY, async paper => {
      setFillingRowIds(prev => new Set(prev).add(paper.id))
      try {
        const res = await apiFetch(`${API}/matrix/autofill-row`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paper: { title: paper.title, abstract: paper.abstract, authors: paper.authors, year: paper.year || null, url: paper.source ?? '' },
            columns, profile: state.profile,
            topics: state.topics.filter(t => t.selected).map(t => ({ title: t.title, description: t.description, type: t.type })),
            custom_system_prompt: prompt ?? null,
          }),
        })
        if (!res.ok) throw new Error()
        const data = await res.json()
        const cells: Record<string, MatrixCell> = {}
        for (const [col, cd] of Object.entries(data.cells as Record<string, { value: string; evidenceType: string; confidenceScore: number; confidenceLevel: string; extractionMethod: string }>)) {
          cells[col] = { value: cd.value, aiGenerated: true, confidenceScore: cd.confidenceScore, confidenceLevel: cd.confidenceLevel as ConfidenceLevel, evidenceType: cd.evidenceType as MatrixCell['evidenceType'], sourceRef: '', extractionMethod: cd.extractionMethod as MatrixCell['extractionMethod'], verifiedByStudent: false }
        }
        dispatch({ type: 'UPDATE_MATRIX_ROW_CELLS', paperId: paper.id, cells })
      } finally {
        setFillingRowIds(prev => { const n = new Set(prev); n.delete(paper.id); return n })
      }
    }, {
      onProgress: done => setFillDone(done),
      shouldAbort: () => abortRef.current,
    })

    setFillingRowIds(new Set()); setFillingColumn(null); setFilling(false)
  }

  function papersForRows() {
    return state.matrixRows
      .map(row => state.reviewList.find(p => p.id === row.paperId))
      .filter((p): p is NonNullable<typeof p> => !!p)
  }

  function handleAutoFill(prompt?: string | null) {
    fillPapers(papersForRows(), dataCols, prompt)
  }

  /** Fill one column across every row that is still empty in it. */
  function handleFillColumn(col: string) {
    const emptyRowIds = new Set(
      state.matrixRows.filter(r => !r.cells[col]?.value).map(r => r.paperId)
    )
    const papers = papersForRows().filter(p => emptyRowIds.has(p.id))
    fillPapers(papers, [col], customAutoFillPrompt)
  }

  function handleAddPapers(papers: ResultCard[]) {
    setShowAddPapers(false)
    if (papers.length === 0) return
    const { fresh } = partitionNewPapers([...state.results, ...state.reviewList], papers)
    dispatch({ type: 'ADD_UPLOADED_PAPERS', papers })
    // parse the newly added rows right away (columns must already exist;
    // otherwise the init effect will generate columns first)
    if (dataCols.length > 0) fillPapers(fresh, dataCols, customAutoFillPrompt)
  }

  if (state.reviewList.length === 0) return (
    <div className="flex items-center justify-center flex-1 flex-col gap-2">
      <p className="text-[13px] text-zinc-400">No papers in review list</p>
      <p className="text-[11px] text-zinc-300">Go back to Select Paper, or upload papers directly.</p>
      <button
        onClick={() => setShowAddPapers(true)}
        className="mt-2 px-4 h-8 bg-purple-600 text-white rounded text-[12px] hover:bg-purple-700"
      >
        ⬆ Upload papers
      </button>
      {showAddPapers && <AddPapersModal onClose={() => setShowAddPapers(false)} onAdd={handleAddPapers} />}
    </div>
  )

  if (generating) return (
    <div className="flex items-center justify-center flex-1 flex-col gap-4">
      <div className="w-7 h-7 border-2 border-zinc-200 border-t-purple-600 rounded-full animate-spin" />
      <p className="text-[13px] font-semibold text-zinc-700">Generating matrix columns…</p>
    </div>
  )

  if (genError) return (
    <div className="flex items-center justify-center flex-1 flex-col gap-3">
      <p className="text-[13px] text-zinc-500">Column generation failed</p>
      <button onClick={() => { setGenError(false); runGenerate() }} className="px-4 h-8 bg-zinc-900 text-white rounded text-[12px] hover:bg-zinc-700">Retry</button>
    </div>
  )

  const filledCount = state.matrixRows.reduce((n, row) => n + dataCols.filter(c => row.cells[c]?.value).length, 0)
  const totalCells = state.matrixRows.length * dataCols.length

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="h-8 bg-zinc-50 border-b border-zinc-200 flex items-center px-4 gap-3 shrink-0">
        <span className="text-[9px] text-zinc-400">{filledCount}/{totalCells} cells filled</span>
        {filling && (
          <div className="flex items-center gap-1.5 min-w-[140px]">
            <div className="flex-1 h-1.5 bg-zinc-200 rounded overflow-hidden">
              <div
                className="h-full bg-purple-600 rounded transition-[width] duration-200"
                style={{ width: `${fillTotal ? Math.round((fillDone / fillTotal) * 100) : 0}%` }}
              />
            </div>
            <span className="text-[9px] text-zinc-500 shrink-0">
              {fillDone}/{fillTotal}{fillingColumn ? ` · ${fillingColumn}` : ''}
            </span>
          </div>
        )}
        <div className="flex-1" />
        <button onClick={() => setShowEditCols(true)}
          title="Add new matrix columns based on the papers and systems you've selected"
          className="px-3 h-6 border border-zinc-300 rounded text-[10px] text-zinc-700 hover:bg-zinc-50">update matrix</button>
        <button onClick={() => setShowAddPapers(true)} disabled={filling}
          className="px-3 h-6 border border-zinc-300 rounded text-[10px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
          + Papers
        </button>
        <div className="flex rounded overflow-hidden">
          <button onClick={() => handleAutoFill(customAutoFillPrompt)} disabled={filling || dataCols.length === 0}
            className="px-3 h-6 bg-purple-600 text-white rounded-l text-[10px] flex items-center gap-1.5 hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
            {filling ? <><span className="w-2.5 h-2.5 border border-purple-300 border-t-white rounded-full animate-spin" />{fillDone}/{fillTotal} rows…</> : <><span>✦</span> {customAutoFillPrompt && <span className="w-1 h-1 rounded-full bg-amber-300 shrink-0" />} Auto-fill All</>}
          </button>
          <button onClick={() => setShowAutoFillModal(true)} disabled={filling || dataCols.length === 0}
            title="Customize AI prompt"
            className="px-1.5 h-6 bg-purple-700 text-purple-200 text-[10px] hover:bg-purple-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors border-l border-purple-500 rounded-r">
            ⚙
          </button>
        </div>
        {showAutoFillModal && (
          <CustomizePromptModal
            promptKey="matrix-lit-autofill"
            title="Auto-fill Literature Rows"
            initialCustomPrompt={customAutoFillPrompt}
            onClose={() => setShowAutoFillModal(false)}
            onGenerate={(prompt) => {
              setCustomAutoFillPrompt(prompt)
              setShowAutoFillModal(false)
              handleAutoFill(prompt)
            }}
          />
        )}
        {filling && <button onClick={() => { abortRef.current = true }} className="px-2 h-6 border border-zinc-300 rounded text-[10px] text-zinc-500 hover:bg-zinc-100">Stop</button>}
      </div>

      <div className="flex-1 overflow-auto">
        <table className="border-collapse text-left" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr className="bg-zinc-900">
              <th className="sticky left-0 z-10 bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-[9px] font-semibold text-white w-8">#</th>
              <th className="sticky left-8 z-10 bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-[9px] font-semibold text-white w-[180px]">Title · Authors · Year</th>
              {dataCols.map(col => (
                <ColumnHeader
                  key={col}
                  col={col}
                  borderClass="border-zinc-700"
                  description={state.columnDescriptions[col]}
                  emptyCount={state.matrixRows.filter(r => !r.cells[col]?.value).length}
                  onFill={handleFillColumn}
                  busy={filling}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {state.matrixRows.map((row, idx) => {
              const paper = state.reviewList.find(p => p.id === row.paperId)
              const isBeingFilled = fillingRowIds.has(row.paperId)
              return (
                <tr key={row.paperId} className={`${idx % 2 === 0 ? 'bg-zinc-50' : 'bg-white'} ${isBeingFilled ? 'ring-1 ring-inset ring-purple-300' : ''}`}>
                  <td className="sticky left-0 z-10 border border-zinc-200 px-2 py-1 text-[10px] text-zinc-400 font-medium bg-inherit">{idx + 1}</td>
                  <td className="sticky left-8 z-10 border border-zinc-200 px-2 py-2 bg-inherit w-[180px]">
                    <p className="text-[11px] font-semibold text-zinc-900 leading-tight line-clamp-2">{row.title}</p>
                    <p className="text-[9px] text-zinc-400 mt-0.5">{row.authors}</p>
                    <p className="text-[9px] text-zinc-400">{row.year || '—'}</p>
                  </td>
                  {dataCols.map(col =>
                    // During a single-column fill only that column is pending —
                    // blanking the whole row would hide values already verified.
                    isBeingFilled && (fillingColumn === null || fillingColumn === col)
                      ? <PendingCell key={`pending-${col}`} />
                      : <CellContent
                          key={`cell-${col}`}
                          cell={row.cells[col]}
                          column={col}
                          onEvidence={row.cells[col]?.value ? rect => onEvidence({
                            rect, cell: row.cells[col], column: col,
                            paperTitle: paper?.title, paperAbstract: paper?.abstract,
                            paperAuthors: paper?.authors, paperYear: paper?.year,
                          }) : undefined}
                        />
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showAddPapers && <AddPapersModal onClose={() => setShowAddPapers(false)} onAdd={handleAddPapers} />}

      {showEditCols && (
        <EditColumnsModal title="Edit literature Matrix" onClose={() => setShowEditCols(false)}>
          <input
            value={columnJustification}
            onChange={e => setColumnJustification(e.target.value)}
            placeholder="Why are you adding or removing columns? (optional)"
            className="w-full h-8 border border-blue-200 bg-blue-50/40 rounded px-2.5 text-[11px] text-zinc-700 outline-none focus:border-blue-400 mb-3"
          />
          <SchemaBuilder
            accent="zinc"
            available={mergeColumnOptions(state.matrixColumnSuggestions, dataCols)}
            selected={dataCols}
            descriptions={state.columnDescriptions}
            newColumns={newCols}
            loading={editColsLoading}
            customPrompt={editColsPrompt}
            promptKey="matrix-lit-columns"
            promptTitle="Literature Matrix Columns"
            onRegenerate={regenLitColumns}
            onChange={cols => {
              const added = cols.filter(c => !dataCols.includes(c))
              const removed = dataCols.filter(c => !cols.includes(c))
              dispatch({ type: 'SET_MATRIX_COLUMNS', columns: cols })
              dispatch({
                type: 'ADD_DECISION_JOURNAL_ENTRY',
                entry: journalEntry({
                  kind: 'justification',
                  step: 6,
                  action: added.length ? 'Added literature matrix column' : 'Removed literature matrix column',
                  entityType: 'matrix_column',
                  entityId: [...added, ...removed].join('|'),
                  entityLabel: [...added, ...removed].join(', '),
                  previousValue: dataCols.join(', '),
                  newValue: cols.join(', '),
                  justification: columnJustification.trim() || undefined,
                }),
              })
              setColumnJustification('')
            }}
          />
        </EditColumnsModal>
      )}
    </div>
  )
}

// ── System review matrix ──────────────────────────────────────────────────────
function SystemMatrix({ onEvidence }: { onEvidence: (t: EvidenceTarget) => void }) {
  const { state, dispatch } = useApp()
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState(false)
  const [filling, setFilling] = useState(false)
  const [fillDone, setFillDone] = useState(0)
  const [fillTotal, setFillTotal] = useState(0)
  const [fillingRowIds, setFillingRowIds] = useState<Set<string>>(new Set())
  const [fillingColumn, setFillingColumn] = useState<string | null>(null)
  const abortRef = useRef(false)
  const [showEditCols, setShowEditCols] = useState(false)
  const [editColsLoading, setEditColsLoading] = useState(false)
  const [editColsPrompt, setEditColsPrompt] = useState<string | null>(null)
  const [newCols, setNewCols] = useState<string[]>([])
  const [showAddSystem, setShowAddSystem] = useState(false)
  const [columnJustification, setColumnJustification] = useState('')

  const systemItems = state.systemItems ?? []
  const selectedSystems = systemItems.filter(s => s.selected)
  const systemMatrixRows: SystemMatrixRow[] = state.systemMatrixRows ?? []
  const systemMatrixColumns: string[] = state.systemMatrixColumns ?? []
  const dataCols = systemMatrixColumns.filter(c => c !== 'System Name' && c !== 'Vendor' && c !== 'Category')

  // Re-recommend columns from the *selected systems* (edit context), appended below
  // the existing suggestion pool and deduped against current columns.
  async function regenSysColumns(prompt?: string | null) {
    setEditColsPrompt(prompt ?? null)
    setEditColsLoading(true)
    try {
      const res = await apiFetch(`${API}/matrix/generate-system-columns`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systems: selectedSystems.map(s => ({ name: s.name, category: s.category, vendor: s.vendor, description: s.description })),
          topics: state.topics.filter(t => t.selected).map(t => ({ title: t.title, description: t.description, type: t.type })),
          profile: state.profile,
          exclude_columns: dataCols,
          custom_system_prompt: prompt ?? null,
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      const fresh = freshSuggestions(data.columns, dataCols)
      dispatch({ type: 'SET_SYSTEM_MATRIX_COLUMN_SUGGESTIONS', columns: mergeColumnOptions(state.systemMatrixColumnSuggestions, fresh) })
      setNewCols(fresh)
      const descs = newColumnDescriptions(data.descriptions, dataCols)
      if (Object.keys(descs).length) dispatch({ type: 'MERGE_COLUMN_DESCRIPTIONS', system: true, descriptions: descs })
    } catch { /* keep prior suggestions */ } finally { setEditColsLoading(false) }
  }

  const selectedIds = new Set(selectedSystems.map(s => s.id))
  const rowsMismatch = selectedSystems.length > 0 && !systemMatrixRows.every(r => selectedIds.has(r.systemId))
  const needsInit = selectedSystems.length > 0 && (systemMatrixColumns.length === 0 || systemMatrixRows.length === 0 || rowsMismatch)

  async function runGenerate() {
    setGenerating(true); setGenError(false)
    try {
      const res = await apiFetch(`${API}/matrix/generate-system-columns`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systems: selectedSystems.map(s => ({ name: s.name, category: s.category, vendor: s.vendor, description: s.description })),
          topics: state.topics.filter(t => t.selected).map(t => ({ title: t.title, description: t.description, type: t.type })),
          profile: state.profile,
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      dispatch({ type: 'SET_SYSTEM_MATRIX_COLUMNS', columns: data.columns })
      if (data.descriptions) dispatch({ type: 'MERGE_COLUMN_DESCRIPTIONS', system: true, descriptions: data.descriptions })
      dispatch({ type: 'INIT_SYSTEM_MATRIX_ROWS' })
    } catch { setGenError(true) } finally { setGenerating(false) }
  }

  useEffect(() => {
    if (!needsInit || generating) return
    const timer = window.setTimeout(() => { void runGenerate() }, 0)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsInit])

  async function fillSystems(
    systems: { id: string; name: string; category: string; vendor: string; description: string }[],
    columns: string[] = dataCols,
  ) {
    if (filling || columns.length === 0 || systems.length === 0) return
    abortRef.current = false
    setFilling(true); setFillDone(0); setFillTotal(systems.length)
    setFillingColumn(columns.length === 1 ? columns[0] : null)

    await runPool(systems, FILL_CONCURRENCY, async sys => {
      setFillingRowIds(prev => new Set(prev).add(sys.id))
      try {
        const res = await apiFetch(`${API}/matrix/autofill-system-row`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system: { name: sys.name, category: sys.category, vendor: sys.vendor, description: sys.description },
            columns, profile: state.profile,
          }),
        })
        if (!res.ok) throw new Error()
        const data = await res.json()
        const cells: Record<string, MatrixCell> = {}
        for (const [col, cd] of Object.entries(data.cells as Record<string, { value: string; evidenceType: string; confidenceScore: number; confidenceLevel: string; extractionMethod: string }>)) {
          cells[col] = { value: cd.value, aiGenerated: true, confidenceScore: cd.confidenceScore, confidenceLevel: cd.confidenceLevel as ConfidenceLevel, evidenceType: cd.evidenceType as MatrixCell['evidenceType'], sourceRef: '', extractionMethod: cd.extractionMethod as MatrixCell['extractionMethod'], verifiedByStudent: false }
        }
        dispatch({ type: 'UPDATE_SYSTEM_MATRIX_ROW_CELLS', systemId: sys.id, cells })
      } finally {
        setFillingRowIds(prev => { const n = new Set(prev); n.delete(sys.id); return n })
      }
    }, {
      onProgress: done => setFillDone(done),
      shouldAbort: () => abortRef.current,
    })

    setFillingRowIds(new Set()); setFillingColumn(null); setFilling(false)
  }

  function systemsForRows() {
    return systemMatrixRows
      .map(row => selectedSystems.find(s => s.id === row.systemId))
      .filter((s): s is NonNullable<typeof s> => !!s)
  }

  function handleAutoFill() {
    fillSystems(systemsForRows(), dataCols)
  }

  /** Fill one column across every system row that is still empty in it. */
  function handleFillColumn(col: string) {
    const emptyIds = new Set(
      systemMatrixRows.filter(r => !r.cells[col]?.value).map(r => r.systemId)
    )
    fillSystems(systemsForRows().filter(s => emptyIds.has(s.id)), [col])
  }

  function handleAddSystem(item: SystemItem) {
    dispatch({ type: 'ADD_SYSTEM_WITH_ROW', item })
    if (dataCols.length > 0) {
      fillSystems([{ id: item.id, name: item.name, category: item.category, vendor: item.vendor, description: item.description }], dataCols)
    }
  }

  if (selectedSystems.length === 0) return (
    <div className="flex items-center justify-center flex-1 flex-col gap-2">
      <p className="text-[13px] text-zinc-400">No systems selected</p>
      <p className="text-[11px] text-zinc-300">Go back to System Review, or add a system by name.</p>
      <button
        onClick={() => setShowAddSystem(true)}
        className="mt-2 px-4 h-8 bg-violet-600 text-white rounded text-[12px] hover:bg-violet-700"
      >
        + Add system
      </button>
      {showAddSystem && (
        <AddSystemModal
          domain={state.profile.domain}
          focus={state.profile.focus}
          existingNames={new Set(systemItems.map(s => s.name.toLowerCase().trim()))}
          onClose={() => setShowAddSystem(false)}
          onAdd={handleAddSystem}
        />
      )}
    </div>
  )
  if (generating) return (
    <div className="flex items-center justify-center flex-1 flex-col gap-4">
      <div className="w-7 h-7 border-2 border-zinc-200 border-t-violet-600 rounded-full animate-spin" />
      <p className="text-[13px] font-semibold text-zinc-700">Generating system review columns…</p>
    </div>
  )
  if (genError) return (
    <div className="flex items-center justify-center flex-1 flex-col gap-3">
      <p className="text-[13px] text-zinc-500">Column generation failed</p>
      <button onClick={() => { setGenError(false); runGenerate() }} className="px-4 h-8 bg-zinc-900 text-white rounded text-[12px] hover:bg-zinc-700">Retry</button>
    </div>
  )

  const filledCount = systemMatrixRows.reduce((n, row) => n + dataCols.filter(c => row.cells[c]?.value).length, 0)
  const totalCells = systemMatrixRows.length * dataCols.length

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="h-8 bg-violet-50 border-b border-violet-200 flex items-center px-4 gap-3 shrink-0">
        <span className="text-[9px] text-violet-400">{filledCount}/{totalCells} cells filled · {selectedSystems.length} systems</span>
        {filling && (
          <div className="flex items-center gap-1.5 min-w-[140px]">
            <div className="flex-1 h-1.5 bg-violet-200 rounded overflow-hidden">
              <div
                className="h-full bg-violet-600 rounded transition-[width] duration-200"
                style={{ width: `${fillTotal ? Math.round((fillDone / fillTotal) * 100) : 0}%` }}
              />
            </div>
            <span className="text-[9px] text-violet-600 shrink-0">
              {fillDone}/{fillTotal}{fillingColumn ? ` · ${fillingColumn}` : ''}
            </span>
          </div>
        )}
        <div className="flex-1" />
        <button onClick={() => setShowEditCols(true)}
          title="Add new matrix columns based on the papers and systems you've selected"
          className="px-3 h-6 border border-violet-300 rounded text-[10px] text-violet-700 hover:bg-violet-100">update matrix</button>
        <button onClick={() => setShowAddSystem(true)} disabled={filling}
          className="px-3 h-6 border border-violet-300 rounded text-[10px] text-violet-700 hover:bg-violet-100 disabled:opacity-50">
          + System
        </button>
        <button onClick={handleAutoFill} disabled={filling || dataCols.length === 0}
          className="px-3 h-6 bg-violet-600 text-white rounded text-[10px] flex items-center gap-1.5 hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
          {filling ? <><span className="w-2.5 h-2.5 border border-violet-300 border-t-white rounded-full animate-spin" />{fillDone}/{fillTotal} rows…</> : <><span>✦</span> Auto-fill All</>}
        </button>
        {filling && <button onClick={() => { abortRef.current = true }} className="px-2 h-6 border border-violet-300 rounded text-[10px] text-violet-600 hover:bg-violet-100">Stop</button>}
      </div>

      <div className="flex-1 overflow-auto">
        <table className="border-collapse text-left" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr className="bg-violet-900">
              <th className="sticky left-0 z-10 bg-violet-900 border border-violet-700 px-2 py-1.5 text-[9px] font-semibold text-white w-8">#</th>
              <th className="sticky left-8 z-10 bg-violet-900 border border-violet-700 px-2 py-1.5 text-[9px] font-semibold text-white w-[180px]">System · Vendor · Category</th>
              {dataCols.map(col => (
                <ColumnHeader
                  key={col}
                  col={col}
                  borderClass="border-violet-700"
                  description={state.systemColumnDescriptions[col]}
                  emptyCount={systemMatrixRows.filter(r => !r.cells[col]?.value).length}
                  onFill={handleFillColumn}
                  busy={filling}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {systemMatrixRows.map((row, idx) => {
              const sys = selectedSystems.find(s => s.id === row.systemId)
              const isBeingFilled = fillingRowIds.has(row.systemId)
              return (
                <tr key={row.systemId} className={`${idx % 2 === 0 ? 'bg-violet-50/30' : 'bg-white'} ${isBeingFilled ? 'ring-1 ring-inset ring-violet-400' : ''}`}>
                  <td className="sticky left-0 z-10 border border-zinc-200 px-2 py-1 text-[10px] text-zinc-400 font-medium bg-inherit">{idx + 1}</td>
                  <td className="sticky left-8 z-10 border border-zinc-200 px-2 py-2 bg-inherit w-[180px]">
                    <p className="text-[11px] font-semibold leading-tight">
                      {row.url ? <a href={row.url} target="_blank" rel="noopener noreferrer" className="hover:underline text-violet-800">{row.name}</a> : <span className="text-zinc-900">{row.name}</span>}
                    </p>
                    {row.vendor && <p className="text-[9px] text-zinc-400 mt-0.5">{row.vendor}</p>}
                    <span className="text-[8px] px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded mt-0.5 inline-block">{row.category}</span>
                  </td>
                  {dataCols.map(col =>
                    isBeingFilled && (fillingColumn === null || fillingColumn === col)
                      ? <PendingCell key={`pending-${col}`} />
                      : <CellContent
                          key={`cell-${col}`}
                          cell={row.cells[col]}
                          column={col}
                          onEvidence={row.cells[col]?.value ? rect => onEvidence({
                            rect, cell: row.cells[col], column: col,
                            systemName: sys?.name, systemVendor: sys?.vendor, systemDescription: sys?.description,
                          }) : undefined}
                        />
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showAddSystem && (
        <AddSystemModal
          domain={state.profile.domain}
          focus={state.profile.focus}
          existingNames={new Set(systemItems.map(s => s.name.toLowerCase().trim()))}
          onClose={() => setShowAddSystem(false)}
          onAdd={handleAddSystem}
        />
      )}

      {showEditCols && (
        <EditColumnsModal title="Edit System Matrix" onClose={() => setShowEditCols(false)}>
          <input
            value={columnJustification}
            onChange={e => setColumnJustification(e.target.value)}
            placeholder="Why are you adding or removing columns? (optional)"
            className="w-full h-8 border border-violet-200 bg-violet-50/40 rounded px-2.5 text-[11px] text-zinc-700 outline-none focus:border-violet-400 mb-3"
          />
          <SchemaBuilder
            accent="violet"
            available={mergeColumnOptions(state.systemMatrixColumnSuggestions, dataCols)}
            selected={dataCols}
            descriptions={state.systemColumnDescriptions}
            newColumns={newCols}
            loading={editColsLoading}
            customPrompt={editColsPrompt}
            promptKey="matrix-sys-columns"
            promptTitle="System Matrix Columns"
            onRegenerate={regenSysColumns}
            onChange={cols => {
              const added = cols.filter(c => !dataCols.includes(c))
              const removed = dataCols.filter(c => !cols.includes(c))
              dispatch({ type: 'SET_SYSTEM_MATRIX_COLUMNS', columns: cols })
              dispatch({
                type: 'ADD_DECISION_JOURNAL_ENTRY',
                entry: journalEntry({
                  kind: 'justification',
                  step: 6,
                  action: added.length ? 'Added system matrix column' : 'Removed system matrix column',
                  entityType: 'matrix_column',
                  entityId: `system:${[...added, ...removed].join('|')}`,
                  entityLabel: [...added, ...removed].join(', '),
                  previousValue: dataCols.join(', '),
                  newValue: cols.join(', '),
                  justification: columnJustification.trim() || undefined,
                }),
              })
              setColumnJustification('')
            }}
          />
        </EditColumnsModal>
      )}
    </div>
  )
}

// ── Main Screen5 ──────────────────────────────────────────────────────────────
export function Screen5() {
  const { state, dispatch } = useApp()
  const systemItems = state.systemItems ?? []
  const [activeTab, setActiveTab] = useState<'literature' | 'system'>('literature')
  const [evidenceTarget, setEvidenceTarget] = useState<EvidenceTarget | null>(null)
  const [synthesising, setSynthesising] = useState(false)
  const [synthError, setSynthError] = useState<string | null>(null)
  const [showSynthModal, setShowSynthModal] = useState(false)
  const [customSynthPrompt, setCustomSynthPrompt] = useState<string | null>(null)

  async function handleContinue(prompt?: string | null) {
    setSynthesising(true)
    setSynthError(null)
    try {
      const selectedSystems = systemItems.filter(s => s.selected)
      const res = await apiFetch(`${API}/synthesis/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom_system_prompt: prompt ?? null,
          matrix_rows: state.matrixRows.map(r => ({
            title: r.title,
            authors: r.authors,
            year: r.year,
            cells: Object.fromEntries(
              Object.entries(r.cells).map(([k, c]) => [k, {
                value: c.value,
                confidenceScore: c.confidenceScore,
                confidenceLevel: c.confidenceLevel,
                evidenceType: c.evidenceType,
              }])
            ),
          })),
          system_rows: (state.systemMatrixRows ?? []).filter(r =>
            selectedSystems.some(s => s.id === r.systemId)
          ).map(r => ({
            name: r.name,
            vendor: r.vendor,
            category: r.category,
            cells: Object.fromEntries(
              Object.entries(r.cells).map(([k, c]) => [k, {
                value: c.value,
                confidenceScore: c.confidenceScore,
                confidenceLevel: c.confidenceLevel,
                evidenceType: c.evidenceType,
              }])
            ),
          })),
          columns: state.matrixColumns,
          system_columns: state.systemMatrixColumns ?? [],
          profile: state.profile,
          topics: state.topics.filter(t => t.selected).map(t => ({
            title: t.title,
            description: t.description,
            type: t.type,
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
      dispatch({ type: 'ADVANCE_STEP' })
    } catch (error) {
      setSynthError(error instanceof Error ? error.message : 'Synthesis generation failed.')
    } finally {
      setSynthesising(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="h-10 border-b border-zinc-200 bg-white flex items-end px-4 gap-1 shrink-0">
        <button onClick={() => setActiveTab('literature')}
          className={`px-4 h-8 text-[12px] font-medium border-b-2 transition-colors ${activeTab === 'literature' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-700'}`}>
          Literature Review Matrix
          <span className="ml-1.5 text-[10px] text-zinc-400">({state.matrixRows.length})</span>
        </button>
        {state.systemMatrixEnabled && (
          <button onClick={() => setActiveTab('system')}
            className={`px-4 h-8 text-[12px] font-medium border-b-2 transition-colors ${activeTab === 'system' ? 'border-violet-600 text-violet-700' : 'border-transparent text-zinc-400 hover:text-violet-600'}`}>
            System Review Matrix
            <span className="ml-1.5 text-[10px] text-zinc-400">({systemItems.filter(s => s.selected).length})</span>
          </button>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-zinc-400 pb-2">Step 6 · Matrix Table</span>
      </div>

      {/* Active matrix */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {activeTab === 'literature' || !state.systemMatrixEnabled
          ? <LiteratureMatrix onEvidence={setEvidenceTarget} />
          : <SystemMatrix onEvidence={setEvidenceTarget} />
        }
      </div>

      {/* Footer */}
      <div className="h-[30px] border-t border-zinc-200 bg-zinc-50 flex items-center px-4 gap-4 shrink-0">
        <p className="text-[9px] text-zinc-400 flex-1">
          {synthesising
            ? <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 border border-zinc-400 border-t-zinc-700 rounded-full animate-spin inline-block" /> Generating synthesis…</span>
            : synthError
              ? <span className="text-red-600">Synthesis failed: {synthError} Retry before continuing.</span>
              : <>Hover a cell to reveal <span className="font-bold">?</span> — click for AI evidence reasoning</>
          }
        </p>
        <div className="flex rounded overflow-hidden">
          <button
            onClick={() => handleContinue(customSynthPrompt)}
            disabled={synthesising}
            className="px-4 h-6 bg-zinc-900 text-white rounded-l text-[11px] font-semibold hover:bg-zinc-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
            {customSynthPrompt && <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />}
            {synthesising ? 'Synthesising…' : 'Continue to Synthesis →'}
          </button>
          <button
            onClick={() => setShowSynthModal(true)}
            disabled={synthesising}
            title="Customize AI prompt"
            className="px-1.5 h-6 bg-zinc-800 text-zinc-400 text-[10px] hover:bg-zinc-600 hover:text-zinc-200 disabled:opacity-50 transition-colors border-l border-zinc-700 rounded-r">
            ⚙
          </button>
        </div>
      </div>

      {showSynthModal && (
        <CustomizePromptModal
          promptKey="synthesis-generate"
          title="Generate Synthesis"
          initialCustomPrompt={customSynthPrompt}
          onClose={() => setShowSynthModal(false)}
          onGenerate={(prompt) => {
            setCustomSynthPrompt(prompt)
            setShowSynthModal(false)
            handleContinue(prompt)
          }}
        />
      )}

      {/* Evidence popover (fixed overlay) */}
      {evidenceTarget && (
        <EvidencePopover
          target={evidenceTarget}
          domain={state.profile.domain}
          focus={state.profile.focus}
          onClose={() => setEvidenceTarget(null)}
        />
      )}
    </div>
  )
}
