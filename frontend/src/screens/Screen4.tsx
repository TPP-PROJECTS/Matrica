import { useState, useEffect, useRef } from 'react'
import { useApp } from '../store/AppContext'
import type { ResultCard, ScreeningCriterion } from '../types'
import { API, apiFetch } from '../lib/api'
import { runPool } from '../lib/runPool'
import { screenPaper } from '../lib/screenApi'
import { CitationsModal } from '../components/overlays/CitationsModal'
import { CustomizePromptModal } from '../components/shared/CustomizePromptModal'
import { journalEntry } from '../lib/decisionJournal'

// How many screening requests run at once — matched to the matrix auto-fill.
const SCREEN_CONCURRENCY = 4

interface ScreenTally { include: number; exclude: number; uncertain: number; failed: number }
interface AutoScreen {
  running: boolean
  done: number
  total: number
  summary: ScreenTally | null
  eligibleCount: number
  customPrompt: string | null
  setCustomPrompt: (p: string | null) => void
  /** Optional override used the same tick a new prompt is applied, before state commits. */
  run: (promptOverride?: string | null) => void
  cancel: () => void
}

/**
 * Drive an LLM screening pass over the papers not already decided by a human.
 *
 * Only AI-decided and untouched papers are eligible, so re-running never
 * overturns a human call. The run lives here (above the collapsible protocol
 * panel) so collapsing the panel mid-pass does not abandon it.
 */
function useAutoScreen(): AutoScreen {
  const { state, dispatch } = useApp()
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState<ScreenTally | null>(null)
  // The user's edited screening prompt, if any. Null means the backend default.
  // Held here so it survives collapsing the panel and applies to every re-run.
  const [customPrompt, setCustomPrompt] = useState<string | null>(null)
  const abortRef = useRef(false)

  const eligible = state.results.filter(
    p => !p.isDuplicate && (p.screenedBy === 'ai' || p.status === null)
  )

  async function run(promptOverride?: string | null) {
    if (running) return
    const papers = eligible
    if (papers.length === 0) return
    // An override wins for this run — setCustomPrompt in the same tick has not
    // committed yet, so reading state here would use the previous prompt.
    const effectivePrompt = promptOverride === undefined ? customPrompt : promptOverride
    abortRef.current = false
    setRunning(true); setDone(0); setTotal(papers.length); setSummary(null)
    papers.forEach(p => dispatch({ type: 'SET_SCREEN_STATUS', paperId: p.id, status: 'pending' }))

    const tally: ScreenTally = { include: 0, exclude: 0, uncertain: 0, failed: 0 }
    await runPool(papers, SCREEN_CONCURRENCY, async paper => {
      const outcome = await screenPaper(paper, state.criteria, state.profile, dispatch, effectivePrompt)
      tally[outcome === 'failed' ? 'failed' : outcome]++
    }, {
      onProgress: n => setDone(n),
      shouldAbort: () => abortRef.current,
    })

    setRunning(false)
    setSummary(tally)
  }

  return {
    running, done, total, summary,
    eligibleCount: eligible.length,
    customPrompt, setCustomPrompt,
    run,
    cancel: () => { abortRef.current = true },
  }
}


// ── Status badge ──────────────────────────────────────────────────────────────
function statusBadge(status: ResultCard['status']) {
  switch (status) {
    case 'included': return 'bg-zinc-900 text-white'
    case 'maybe':    return 'bg-amber-100 text-amber-800'
    case 'saved':    return 'bg-blue-100 text-blue-800'
    case 'excluded': return 'bg-red-100 text-red-700'
    default:         return 'bg-zinc-100 text-zinc-500'
  }
}

function statusLabel(status: ResultCard['status']): string {
  if (status === 'maybe') return 'pending'
  return status ?? '—'
}

function nextStatus(current: ResultCard['status']): ResultCard['status'] {
  if (current === 'included') return 'maybe'
  if (current === 'maybe')    return 'saved'
  return 'included'
}

// ── Screening protocol ────────────────────────────────────────────────────────
// PRISMA 2020 requires reporting the eligibility criteria a review screened
// against, and reporting excluded records *with reasons*. Both need the
// criteria to exist as data before screening starts, not as prose afterwards.

function ProtocolPanel({ onClose, auto }: { onClose: () => void; auto: AutoScreen }) {
  const { state, dispatch } = useApp()
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<ScreeningCriterion['kind']>('inclusion')
  const [showPromptModal, setShowPromptModal] = useState(false)

  function add() {
    const label = draft.trim()
    if (!label) return
    dispatch({
      type: 'ADD_CRITERION',
      criterion: { id: `c-${kind}-${Date.now()}`, kind, label },
    })
    setDraft('')
  }

  const inclusion = state.criteria.filter(c => c.kind === 'inclusion')
  const exclusion = state.criteria.filter(c => c.kind === 'exclusion')
  const hasCriteria = state.criteria.length > 0
  const aiDecided = state.results.filter(p => p.screenedBy === 'ai').length
  const pct = auto.total ? Math.round((auto.done / auto.total) * 100) : 0

  return (
    <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2.5 shrink-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wide">Screening protocol</span>
        <span className="text-[9px] text-zinc-400">
          define eligibility, then let the AI screen every paper against it
        </span>
        <button onClick={onClose} className="ml-auto text-[10px] text-zinc-400 hover:text-zinc-700">
          hide
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {([
          ['Include if', inclusion, 'text-green-700 border-green-200 bg-green-50'],
          ['Exclude if', exclusion, 'text-red-700 border-red-200 bg-red-50'],
        ] as const).map(([heading, list, tone]) => (
          <div key={heading}>
            <p className="text-[9px] font-semibold text-zinc-400 uppercase mb-1">{heading}</p>
            {list.length === 0 ? (
              <p className="text-[10px] text-zinc-400 italic">None defined yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {list.map(c => (
                  <span
                    key={c.id}
                    className={`group inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${tone}`}
                  >
                    {c.label}
                    <button
                      onClick={() => dispatch({ type: 'REMOVE_CRITERION', criterionId: c.id })}
                      className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-zinc-900"
                      title="Remove criterion"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 mt-2.5">
        <select
          value={kind}
          onChange={e => setKind(e.target.value as ScreeningCriterion['kind'])}
          className="h-6 border border-zinc-300 rounded px-1 text-[10px] text-zinc-700 bg-white focus:outline-none focus:border-zinc-500"
        >
          <option value="inclusion">Include if</option>
          <option value="exclusion">Exclude if</option>
        </select>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder={kind === 'inclusion' ? 'e.g. adults aged 18–65 with type 2 diabetes' : 'e.g. animal studies, case reports'}
          className="flex-1 h-6 border border-zinc-300 rounded px-1.5 text-[10px] text-zinc-700 bg-white focus:outline-none focus:border-zinc-500"
        />
        <button
          onClick={add}
          disabled={!draft.trim()}
          className="px-2 h-6 bg-zinc-900 text-white rounded text-[10px] font-semibold hover:bg-zinc-700 disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {/* ── Auto-screen ── */}
      <div className="mt-2.5 pt-2.5 border-t border-zinc-200">
        {auto.running ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-zinc-200 rounded overflow-hidden">
              <div className="h-full bg-purple-600 rounded transition-[width] duration-200" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] text-zinc-600 shrink-0">Screening {auto.done}/{auto.total}</span>
            <button onClick={auto.cancel} className="px-2 h-6 border border-zinc-300 rounded text-[10px] text-zinc-600 hover:bg-zinc-100">
              Stop
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded overflow-hidden">
              <button
                onClick={() => auto.run()}
                disabled={!hasCriteria || auto.eligibleCount === 0}
                title={!hasCriteria ? 'Add at least one criterion first'
                  : auto.eligibleCount === 0 ? 'No papers left to screen'
                  : `Screen ${auto.eligibleCount} paper(s) against the protocol`}
                className="flex items-center gap-1.5 px-3 h-6 bg-purple-600 text-white rounded-l text-[10px] font-semibold hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ✦ Auto-screen {auto.eligibleCount > 0 ? `${auto.eligibleCount} paper${auto.eligibleCount === 1 ? '' : 's'}` : 'all'}
                {auto.customPrompt && <span className="w-1 h-1 rounded-full bg-amber-300 shrink-0" title="Using a customised prompt" />}
              </button>
              <button
                onClick={() => setShowPromptModal(true)}
                disabled={!hasCriteria}
                title="Customise the AI screening prompt"
                className="px-1.5 h-6 bg-purple-700 text-purple-200 text-[10px] hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed border-l border-purple-500 rounded-r"
              >
                ⚙
              </button>
            </div>

            {auto.summary && (
              <span className="text-[10px] text-zinc-600">
                <span className="text-green-700 font-semibold">{auto.summary.include} included</span> ·{' '}
                <span className="text-red-700 font-semibold">{auto.summary.exclude} excluded</span> ·{' '}
                <span className="text-amber-700 font-semibold">{auto.summary.uncertain} unsure</span>
                {auto.summary.failed > 0 && <span className="text-zinc-500"> · {auto.summary.failed} failed</span>}
              </span>
            )}

            {aiDecided > 0 && (
              <button
                onClick={() => dispatch({ type: 'RESET_AI_SCREENING' })}
                className="ml-auto text-[10px] text-zinc-400 hover:text-red-600"
                title="Undo every decision the AI made; your own decisions are kept"
              >
                Reset AI decisions ({aiDecided})
              </button>
            )}
          </div>
        )}
        {!hasCriteria && (
          <p className="text-[10px] text-zinc-400 italic mt-1.5">
            Add inclusion / exclusion criteria above to enable AI screening.
          </p>
        )}
        <p className="text-[9px] text-zinc-400 mt-1.5 leading-relaxed">
          The AI judges from the title and abstract only, and leaves anything it can't decide as
          <span className="text-amber-600"> unsure</span> for you. Every AI decision is marked
          <span className="text-purple-600"> ✦ AI</span> and can be overridden — treat it as a first pass, not the final word.
        </p>
      </div>

      {showPromptModal && (
        <CustomizePromptModal
          promptKey="screening-classify"
          title="Screen Papers"
          initialCustomPrompt={auto.customPrompt}
          onClose={() => setShowPromptModal(false)}
          onGenerate={(prompt) => {
            auto.setCustomPrompt(prompt)
            setShowPromptModal(false)
            auto.run(prompt)   // pass explicitly; state hasn't committed yet
          }}
        />
      )}
    </div>
  )
}

/** Drop-down of exclusion reasons — the only way to exclude a paper. */
function ExcludeMenu({ paperId, onDone }: { paperId: string; onDone: () => void }) {
  const { state, dispatch } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const reasons = state.criteria.filter(c => c.kind === 'exclusion')
  const [otherReason, setOtherReason] = useState('')

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDone()
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [onDone])

  return (
    <div
      ref={ref}
      className="absolute z-40 left-0 top-full mt-1 w-60 bg-white border border-zinc-200 rounded-lg shadow-xl py-1"
    >
      <p className="px-2.5 py-1 text-[9px] font-bold text-zinc-400 uppercase tracking-wide">
        Reason for exclusion
      </p>
      {reasons.length === 0 ? (
        <p className="px-2.5 py-2 text-[10px] text-zinc-400 italic">
          No exclusion criterion is defined. You can still make the decision below.
        </p>
      ) : reasons.map(r => (
        <button
          key={r.id}
          onClick={() => {
            dispatch({
              type: 'EXCLUDE_PAPER',
              paperId,
              reasonId: r.id,
              reason: r.label,
              by: 'human',
            })
            onDone()
          }}
          className="w-full text-left px-2.5 py-1.5 text-[11px] text-zinc-700 hover:bg-red-50 hover:text-red-700"
        >
          {r.label}
        </button>
      ))}
      <div className="border-t border-zinc-100 p-2">
        <textarea
          value={otherReason}
          onChange={event => setOtherReason(event.target.value)}
          rows={2}
          placeholder="Other reason (optional)"
          className="w-full resize-none rounded border border-zinc-200 p-1.5 text-[10px] text-zinc-700 outline-none focus:border-red-300"
        />
        <button
          onClick={() => {
            dispatch({
              type: 'EXCLUDE_PAPER',
              paperId,
              reasonId: null,
              reason: otherReason.trim() || undefined,
              by: 'human',
            })
            onDone()
          }}
          className="mt-1.5 h-6 rounded bg-red-600 px-2.5 text-[10px] font-semibold text-white hover:bg-red-700"
        >
          {otherReason.trim() ? 'Exclude with reason' : 'Exclude'}
        </button>
      </div>
    </div>
  )
}

/** Include a paper, optionally attaching a reason. Skipping is one click. */
function IncludeMenu({ paperId, onDone }: { paperId: string; onDone: () => void }) {
  const { dispatch } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const [reason, setReason] = useState('')

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDone()
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [onDone])

  function include() {
    dispatch({ type: 'ADD_TO_REVIEW', paperId, status: 'included', reason: reason.trim() || undefined, by: 'human' })
    onDone()
  }

  return (
    <div
      ref={ref}
      className="absolute z-40 left-0 top-full mt-1 w-64 bg-white border border-zinc-200 rounded-lg shadow-xl p-2.5"
    >
      <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide mb-1.5">
        Include — reason (optional)
      </p>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) include() }}
        autoFocus
        rows={2}
        placeholder="Why does this paper qualify? Leave blank to skip."
        className="w-full border border-zinc-200 rounded p-1.5 text-[10px] text-zinc-700 resize-none outline-none focus:border-zinc-400"
      />
      <div className="flex items-center gap-2 mt-1.5">
        <button
          onClick={include}
          className="px-2.5 h-6 bg-zinc-900 text-white rounded text-[10px] font-semibold hover:bg-zinc-700"
        >
          {reason.trim() ? 'Include with reason' : 'Include'}
        </button>
        <span className="text-[9px] text-zinc-400">⌘↵</span>
      </div>
    </div>
  )
}

/** AI screening provenance + the model's reason, shown on AI-decided papers. */
function ScreeningReason({ paper }: { paper: ResultCard }) {
  if (paper.screenedBy !== 'ai' || !paper.screeningReason) return null
  return (
    <div className="flex items-start gap-1.5 bg-purple-50 border border-purple-100 rounded px-1.5 py-1">
      <span className="text-[8px] font-bold text-purple-600 bg-purple-100 rounded px-1 py-0.5 shrink-0 mt-px">✦ AI</span>
      <span className="text-[10px] text-purple-800 leading-snug">{paper.screeningReason}</span>
    </div>
  )
}

// ── Topic · Query hover chip ──────────────────────────────────────────────────
function TopicQueryChip({ paper }: { paper: ResultCard }) {
  const { state } = useApp()
  const topic = state.topics.find(t => t.id === paper.topicId)
  const query = state.queries.find(q => q.id === paper.queryId)
  const tNum = paper.topicId.replace('t', '')
  const qNum = paper.queryId.replace('q', '')

  return (
    <div className="relative group inline-block">
      <div className="flex gap-1">
        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[9px] cursor-default">
          T{tNum}
        </span>
        <span className="px-1.5 py-0.5 bg-zinc-100 text-zinc-600 border border-zinc-200 rounded text-[9px] cursor-default">
          Q{qNum}
        </span>
      </div>
      {/* Tooltip */}
      <div className="absolute z-30 left-0 top-full mt-1.5 w-64 bg-white border border-zinc-200 rounded-lg shadow-xl p-3 invisible group-hover:visible pointer-events-none">
        <p className="text-[10px] font-semibold text-zinc-700 mb-1">
          Topic {tNum}: {topic?.title ?? '—'}
        </p>
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          Query {qNum}: {query?.text ?? '—'}
        </p>
      </div>
    </div>
  )
}

// ── View Details modal (5 tabs) ───────────────────────────────────────────────
type Tab = 'overview' | 'abstract' | 'ai-summary' | 'conclusion' | 'metadata'

const TAB_LABELS: { key: Tab; label: string }[] = [
  { key: 'overview',   label: 'Overview' },
  { key: 'abstract',   label: 'Abstract' },
  { key: 'ai-summary', label: 'AI Summary' },
  { key: 'conclusion', label: 'Conclusion' },
  { key: 'metadata',   label: 'Metadata' },
]

function confidenceBadge(c: ResultCard['confidence']) {
  if (c === 'high')   return 'bg-green-100 text-green-700'
  if (c === 'medium') return 'bg-amber-100 text-amber-700'
  if (c === 'low')    return 'bg-red-100 text-red-700'
  return 'bg-zinc-100 text-zinc-400'
}

interface RecogniseResult {
  score: number
  level: string
  reasoning: string
  resolvedAbstract?: string | null
  model: string
}

interface PaperInsightsResult {
  summary: string
  conclusion: string | null
  conclusionAvailable: boolean
  resolvedAbstract: string
  model: string
}

function DetailModal({ paper, onClose, onAdd, onLater }: {
  paper: ResultCard
  onClose: () => void
  onAdd: () => void
  onLater: () => void
}) {
  const { state, dispatch } = useApp()
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [showCitations, setShowCitations] = useState(false)
  const [recognising, setRecognising] = useState(false)
  const [recogniseResult, setRecogniseResult] = useState<RecogniseResult | null>(null)
  const [recogniseError, setRecogniseError] = useState<string | null>(null)
  const [insights, setInsights] = useState<PaperInsightsResult | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsError, setInsightsError] = useState<string | null>(null)

  const topic = state.topics.find(t => t.id === paper.topicId)
  const query  = state.queries.find(q => q.id === paper.queryId)
  const inReview = state.reviewList.some(r => r.id === paper.id)

  useEffect(() => {
    async function runRecognise() {
      setRecognising(true)
      setRecogniseError(null)
      try {
        const res = await apiFetch(`${API}/recognise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'paper_relevance',
            paper: {
              title: paper.title,
              abstract: paper.abstract,
              authors: paper.authors,
              year: paper.year,
              url: paper.source,
            },
            profile: state.profile,
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.detail || 'Assessment failed')
        }
        const data = await res.json()
        setRecogniseResult(data)
        if (!paper.abstract.trim() && data.resolvedAbstract?.trim()) {
          dispatch({ type: 'UPDATE_PAPER_ABSTRACT', paperId: paper.id, abstract: data.resolvedAbstract.trim() })
        }
      } catch (error) {
        setRecogniseError(error instanceof Error ? error.message : 'Assessment failed')
      } finally {
        setRecognising(false)
      }
    }
    runRecognise()
  // `dispatch` is intentionally omitted: AppProvider wraps it per render, while
  // the paper/profile fields below are the actual request dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    paper.id, paper.title, paper.abstract, paper.authors, paper.year, paper.source,
    state.profile.domain, state.profile.population, state.profile.focus,
    state.profile.method, state.profile.reviewType,
  ])

  useEffect(() => {
    if (!['ai-summary', 'conclusion'].includes(activeTab) || insights || insightsLoading) return
    let cancelled = false
    async function loadInsights() {
      setInsightsLoading(true)
      setInsightsError(null)
      try {
        const res = await apiFetch(`${API}/papers/insights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paper: {
              title: paper.title,
              abstract: paper.abstract,
              authors: paper.authors,
              year: paper.year,
              url: paper.source,
            },
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.detail || 'Could not generate source-grounded insights')
        }
        const data = await res.json() as PaperInsightsResult
        if (cancelled) return
        setInsights(data)
        if (!paper.abstract.trim() && data.resolvedAbstract.trim()) {
          dispatch({ type: 'UPDATE_PAPER_ABSTRACT', paperId: paper.id, abstract: data.resolvedAbstract.trim() })
        }
      } catch (error) {
        if (!cancelled) setInsightsError(error instanceof Error ? error.message : 'Could not generate insights')
      } finally {
        if (!cancelled) setInsightsLoading(false)
      }
    }
    void loadInsights()
    return () => { cancelled = true }
  // The insight is fetched once for this modal. A newly hydrated abstract is
  // already returned in the same response, so adding it here would duplicate it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, paper.id, insights])

  const verifiedAbstract = insights?.resolvedAbstract || recogniseResult?.resolvedAbstract || paper.abstract

  return (
   <>
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[620px] flex flex-col"
        style={{ maxHeight: '82vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Fixed header */}
        <div className="px-5 pt-5 pb-0 shrink-0">
          <div className="flex items-start justify-between mb-3">
            <h2 className="text-[14px] font-bold text-zinc-950 leading-snug flex-1 mr-4">
              {paper.title}
            </h2>
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-700 text-[18px] leading-none shrink-0"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center justify-between mb-3 gap-2">
            <p className="text-[11px] text-zinc-500 min-w-0 truncate">
              {paper.authors} · {paper.year} · {paper.source}
            </p>
            <button
              onClick={() => setShowCitations(true)}
              title="Find this paper's references and citing papers"
              className="shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
            >
              ⇄ Snowball citations
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-zinc-200 -mx-5 px-5">
            {TAB_LABELS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-3 py-2 text-[11px] font-medium border-b-2 transition-colors mr-1 ${
                  activeTab === key
                    ? 'border-zinc-900 text-zinc-900'
                    : 'border-transparent text-zinc-400 hover:text-zinc-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* ── Overview ── */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${confidenceBadge(paper.confidence)}`}>
                  {paper.confidence} confidence
                </span>
                {paper.isDuplicate && (
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-bold rounded">
                    DUPLICATE
                  </span>
                )}
              </div>

              {/* AI Relevance — auto-assessed on open */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">AI Relevance</p>
                  {recognising && (
                    <span className="w-3 h-3 border border-purple-300 border-t-purple-600 rounded-full animate-spin" />
                  )}
                  {recogniseError && (
                    <span className="text-[9px] text-amber-600">{recogniseError}</span>
                  )}
                </div>

                {recogniseResult ? (
                  <div className="bg-purple-50 border border-purple-100 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2.5 bg-purple-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            recogniseResult.level === 'high' ? 'bg-green-500' :
                            recogniseResult.level === 'medium' ? 'bg-amber-500' :
                            recogniseResult.level === 'low' ? 'bg-orange-500' : 'bg-zinc-300'
                          }`}
                          style={{ width: `${recogniseResult.score}%` }}
                        />
                      </div>
                      <span className="text-[12px] font-bold text-zinc-700 shrink-0">{recogniseResult.score}%</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold capitalize shrink-0 ${
                        recogniseResult.level === 'high' ? 'bg-green-100 text-green-700' :
                        recogniseResult.level === 'medium' ? 'bg-amber-100 text-amber-700' :
                        recogniseResult.level === 'low' ? 'bg-orange-100 text-orange-700' : 'bg-zinc-100 text-zinc-400'
                      }`}>
                        {recogniseResult.level}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-600 leading-relaxed">{recogniseResult.reasoning}</p>
                    <p className="text-[9px] text-purple-400 italic">
                      AI-assessed from the verified title and abstract · {recogniseResult.model}
                    </p>
                  </div>
                ) : !recognising && !recogniseError ? null : null}
              </div>

              {/* Topic & query */}
              <div>
                <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide mb-1.5">Source</p>
                <div className="space-y-1.5 text-[11px]">
                  {topic && (
                    <div className="flex gap-2">
                      <span className="text-zinc-400 shrink-0 w-12">Topic</span>
                      <span className="text-zinc-700">{topic.title}</span>
                    </div>
                  )}
                  {query && (
                    <div className="flex gap-2">
                      <span className="text-zinc-400 shrink-0 w-12">Query</span>
                      <span className="text-zinc-600 italic text-[10px]">{query.text}</span>
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* ── Abstract ── */}
          {activeTab === 'abstract' && (
            <div>
              <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide mb-3">Full Abstract</p>
              {verifiedAbstract
                ? <p className="text-[12px] text-zinc-700 leading-relaxed">{verifiedAbstract}</p>
                : <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
                    No verified abstract is available from the source databases.
                  </p>}
            </div>
          )}

          {/* ── AI Summary ── */}
          {activeTab === 'ai-summary' && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">AI-Generated Summary</p>
                <span className="px-1.5 py-0.5 bg-purple-100 text-purple-600 text-[8px] font-semibold rounded">AI</span>
              </div>
              <div className="bg-purple-50/50 border border-purple-100 rounded-lg p-4">
                {insightsLoading && <p className="text-[11px] text-purple-500">Generating from the verified abstract…</p>}
                {insightsError && <p className="text-[11px] text-amber-700">{insightsError}</p>}
                {insights && <p className="text-[12px] text-zinc-700 leading-relaxed">{insights.summary}</p>}
              </div>
              <p className="text-[9px] italic text-zinc-400 mt-2">
                {insights
                  ? `Generated only from the verified abstract · ${insights.model}. Verify before citing.`
                  : 'No template or placeholder content is used.'}
              </p>
            </div>
          )}

          {/* ── Conclusion ── */}
          {activeTab === 'conclusion' && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">Key Conclusion</p>
                <span className="px-1.5 py-0.5 bg-purple-100 text-purple-600 text-[8px] font-semibold rounded">AI</span>
              </div>
              <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4">
                {insightsLoading && <p className="text-[11px] text-zinc-500">Checking the verified abstract…</p>}
                {insightsError && <p className="text-[11px] text-amber-700">{insightsError}</p>}
                {insights?.conclusionAvailable && insights.conclusion
                  ? <p className="text-[12px] text-zinc-700 leading-relaxed">{insights.conclusion}</p>
                  : insights && (
                    <p className="text-[11px] text-zinc-500">
                      The verified abstract does not state an explicit author conclusion.
                    </p>
                  )}
              </div>
              <p className="text-[9px] italic text-zinc-400 mt-2">
                Only an explicitly supported conclusion is shown; otherwise this section remains unavailable.
              </p>
            </div>
          )}

          {/* ── Metadata ── */}
          {activeTab === 'metadata' && (
            <div className="space-y-2">
              <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide mb-3">Publication Metadata</p>
              {[
                { label: 'Authors',         value: paper.authors },
                { label: 'Year',            value: String(paper.year) },
                { label: 'Source',          value: /^https?:\/\//.test(paper.source) ? paper.source : (paper.source || '—') },
                { label: 'Confidence',      value: paper.confidence },
                { label: 'Relevance',       value: `${paper.relevanceScore}%` },
                { label: 'Duplicate',       value: paper.isDuplicate ? 'Yes — overlaps with another result' : 'No' },
                { label: 'Topic ID',        value: paper.topicId },
                { label: 'Query ID',        value: paper.queryId },
              ].map(({ label, value }) => (
                <div key={label} className="flex gap-3 py-1.5 border-b border-zinc-100 last:border-0">
                  <span className="text-[10px] text-zinc-400 w-28 shrink-0">{label}</span>
                  <span className="text-[10px] text-zinc-700">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fixed footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-100 shrink-0">
          {/* Read paper link */}
          <a
            href={/^https?:\/\//.test(paper.source)
              ? paper.source
              : `https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-3 h-8 border border-zinc-300 rounded text-[11px] text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
          >
            ↗ Read Paper
          </a>

          <div className="w-px h-5 bg-zinc-200 mx-1" />

          {inReview ? (
            <span className="text-[11px] text-green-600 font-medium">✓ Already in review list</span>
          ) : (
            <>
              <button
                onClick={() => { onAdd(); onClose() }}
                className="px-4 h-8 bg-zinc-900 text-white rounded text-[11px] font-semibold hover:bg-zinc-700"
              >
                Add
              </button>
              <button
                onClick={() => { onLater(); onClose() }}
                className="px-4 h-8 border border-zinc-300 rounded text-[11px] text-zinc-700 hover:bg-zinc-50"
              >
                Later
              </button>
            </>
          )}
          <button onClick={onClose} className="ml-auto px-3 h-8 text-[11px] text-zinc-400 hover:text-zinc-600">
            Close
          </button>
        </div>
      </div>
    </div>
    {showCitations && (
      <CitationsModal
        seed={{ id: paper.id, title: paper.title, year: paper.year, url: paper.source, topicId: paper.topicId }}
        onClose={() => setShowCitations(false)}
      />
    )}
   </>
  )
}

// ── Left: paper card (detailed) ───────────────────────────────────────────────
function PaperCard({ paper, onViewDetails, onSnowball }: {
  paper: ResultCard
  onViewDetails: (p: ResultCard) => void
  onSnowball: (p: ResultCard) => void
}) {
  const { dispatch, state } = useApp()
  const inReview = state.reviewList.some(r => r.id === paper.id)
  const [excludeOpen, setExcludeOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const excluded = paper.status === 'excluded'
  const uncertain = paper.screenUncertain === true
  const screening = paper.screenStatus === 'pending'
  const screenFailed = paper.screenStatus === 'failed'
  const aiIncluded = inReview && paper.screenedBy === 'ai'

  function later() {
    dispatch({ type: 'ADD_TO_REVIEW', paperId: paper.id, status: 'maybe', by: 'human' })
  }

  return (
    <div className={`rounded-lg border bg-white p-3 flex flex-col gap-1.5 ${
      excluded ? 'border-l-4 border-l-red-400 border-r border-t border-b border-zinc-200'
      : uncertain ? 'border-l-4 border-l-amber-300 border-r border-t border-b border-zinc-200'
      : aiIncluded ? 'border-l-4 border-l-purple-300 border-r border-t border-b border-zinc-200'
      : paper.isDuplicate ? 'border-l-4 border-l-orange-300 border-r border-t border-b border-zinc-200'
      : 'border-zinc-200'
      }`}>
      {/* Title */}
      <p className="text-[12px] font-semibold leading-snug text-zinc-950">
        {paper.title}
      </p>

      {screening && (
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 border border-purple-300 border-t-purple-600 rounded-full animate-spin" />
          <span className="text-[10px] text-purple-500">AI screening…</span>
        </div>
      )}

      {screenFailed && (
        <span className="text-[10px] text-red-500">AI screening failed — decide manually below.</span>
      )}

      {excluded && (
        <div>
          <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[9px] font-bold rounded">EXCLUDED</span>
        </div>
      )}

      {uncertain && (
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-bold rounded">✦ AI UNSURE</span>
          <span className="text-[10px] text-zinc-500 italic">needs your decision</span>
        </div>
      )}

      {/* AI reason (include / exclude / uncertain) */}
      {!screening && <ScreeningReason paper={paper} />}

      {/* Authors · Year · Source */}
      <p className="text-[10px] text-zinc-400">
        {paper.authors} · {paper.year} · {paper.source}
      </p>

      {/* Abstract snippet */}
      <p className="text-[11px] text-zinc-600 line-clamp-2 leading-relaxed">
        {paper.abstract}
      </p>

      {/* Relevance bar */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-zinc-400 shrink-0">Relevance</span>
        <div className="flex-1 h-1.5 bg-zinc-100 rounded overflow-hidden">
          <div
            className={`h-full rounded ${
              paper.confidence === 'high'   ? 'bg-green-500' :
              paper.confidence === 'medium' ? 'bg-amber-500' :
              paper.confidence === 'low'    ? 'bg-orange-400' : 'bg-zinc-300'
            }`}
            style={{ width: `${paper.relevanceScore}%` }}
          />
        </div>
        <span className="text-[9px] text-zinc-500">{paper.relevanceScore}%</span>
      </div>

      {/* Source chain */}
      <p className="text-[9px] text-zinc-400 italic">
        {paper.origin === 'snowball'
          ? 'via citation snowballing'
          : paper.origin === 'upload'
            ? 'via manual upload'
            : `via Topic ${paper.topicId.replace('t', '')} · Query ${paper.queryId.replace('q', '')}`}
      </p>

      {/* Action row */}
      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={() => onViewDetails(paper)}
          className="px-2.5 h-7 border border-zinc-300 rounded text-[10px] text-zinc-700 hover:bg-zinc-50"
        >
          View Details
        </button>
        {excluded ? (
          <div className="relative">
            <button
              onClick={() => setAddOpen(v => !v)}
              className="px-2.5 h-7 bg-zinc-900 text-white rounded text-[10px] font-medium hover:bg-zinc-700"
            >
              Add back
            </button>
            {addOpen && <IncludeMenu paperId={paper.id} onDone={() => setAddOpen(false)} />}
          </div>
        ) : (
          <>
            {inReview ? (
              <span className="flex items-center gap-1.5">
                <span className="text-[10px] text-green-600 font-medium">✓ Added</span>
                {aiIncluded && <span className="px-1 py-0.5 bg-purple-100 text-purple-600 text-[8px] font-bold rounded">✦ AI</span>}
              </span>
            ) : (
              <>
                <div className="relative">
                  <button
                    onClick={() => setAddOpen(v => !v)}
                    className="px-2.5 h-7 bg-zinc-900 text-white rounded text-[10px] font-medium hover:bg-zinc-700"
                  >
                    Add
                  </button>
                  {addOpen && <IncludeMenu paperId={paper.id} onDone={() => setAddOpen(false)} />}
                </div>
                <button
                  onClick={later}
                  className="px-2.5 h-7 border border-zinc-300 rounded text-[10px] text-zinc-600 hover:bg-zinc-50"
                >
                  Later
                </button>
              </>
            )}
            <div className="relative">
              <button
                onClick={() => setExcludeOpen(v => !v)}
                title="Exclude this paper, recording which criterion it fails"
                className="px-2.5 h-7 border border-zinc-300 rounded text-[10px] text-red-500 hover:bg-red-50 hover:border-red-300"
              >
                Exclude
              </button>
              {excludeOpen && <ExcludeMenu paperId={paper.id} onDone={() => setExcludeOpen(false)} />}
            </div>
          </>
        )}
        <button
          onClick={() => onSnowball(paper)}
          title="Find this paper's references and the papers citing it"
          className="px-2.5 h-7 border border-blue-200 bg-blue-50 rounded text-[10px] text-blue-700 font-medium hover:bg-blue-100"
        >
          ⇄ Snowball
        </button>
        {paper.isDuplicate && (
          <span className="ml-auto px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-bold rounded">
            DUP
          </span>
        )}
      </div>
    </div>
  )
}

// ── Right: review list item ───────────────────────────────────────────────────
function ReviewListItem({ paper, index, onNoteChange }: {
  paper: ResultCard
  index: number
  onNoteChange: (id: string, val: string) => void
}) {
  const { dispatch } = useApp()

  function cycleStatus() {
    dispatch({ type: 'UPDATE_REVIEW_STATUS', paperId: paper.id, status: nextStatus(paper.status) })
  }

  function remove() {
    dispatch({ type: 'REMOVE_FROM_REVIEW', paperId: paper.id })
  }

  return (
    <div className="border-b border-zinc-100 px-3 py-2.5 hover:bg-zinc-50 group">
      {/* Title row */}
      <div className="flex items-start gap-2">
        <span className="text-[10px] text-zinc-400 shrink-0 mt-0.5">{index + 1}.</span>
        <p className="text-[11px] font-semibold text-zinc-900 leading-snug flex-1 line-clamp-2">
          {paper.title}
        </p>
        <button
          onClick={remove}
          className="text-zinc-300 hover:text-red-500 text-[12px] leading-none shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
          title="Remove"
        >
          ✕
        </button>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 mt-1.5 ml-4 flex-wrap">
        <span className="text-[10px] text-zinc-400">{paper.year}</span>
        <TopicQueryChip paper={paper} />
        <button
          onClick={cycleStatus}
          className={`px-2 py-0.5 rounded-full text-[9px] font-semibold capitalize cursor-pointer ${statusBadge(paper.status)}`}
        >
          {statusLabel(paper.status)}
        </button>
      </div>

      {/* Note */}
      <div className="ml-4 mt-1.5">
        <input
          value={paper.notes}
          onChange={e => onNoteChange(paper.id, e.target.value)}
          className="w-full h-6 bg-zinc-50 border border-zinc-200 rounded px-1.5 text-[10px] text-zinc-700 outline-none focus:border-zinc-400"
          placeholder="Add note..."
        />
      </div>
    </div>
  )
}

// ── Sort / Filter bar ────────────────────────────────────────────────────────
type SortKey = 'relevance' | 'year_desc' | 'year_asc' | 'topic' | 'query'

function FilterChip({
  label,
  tooltip,
  active,
  onClick,
}: {
  label: string
  tooltip: string
  active: boolean
  onClick: () => void
}) {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border transition-colors ${
          active
            ? 'bg-blue-600 text-white border-blue-600'
            : 'bg-zinc-100 text-zinc-600 border-zinc-200 hover:border-blue-400 hover:text-blue-600'
        }`}
      >
        {label}
      </button>
      {/* Tooltip on hover */}
      <div className="absolute z-30 left-0 top-full mt-1.5 w-52 bg-white border border-zinc-200 rounded-lg shadow-xl p-2 invisible group-hover:visible pointer-events-none">
        <p className="text-[10px] text-zinc-700 leading-snug">{tooltip || label}</p>
      </div>
    </div>
  )
}

// ── Main Screen4 ──────────────────────────────────────────────────────────────
export function Screen4() {
  const { state, dispatch } = useApp()
  const [detailPaper, setDetailPaper] = useState<ResultCard | null>(null)
  const [snowballSeed, setSnowballSeed] = useState<ResultCard | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('relevance')
  const [filterTopicId, setFilterTopicId] = useState<string | null>(null)
  const [filterQueryId, setFilterQueryId] = useState<string | null>(null)
  const [showProtocol, setShowProtocol] = useState(false)
  // The Auto-screen trigger lives inside the protocol panel, so a pass can only
  // start while the panel is open — its progress bar stays reachable throughout.
  const auto = useAutoScreen()

  const includedCount = state.reviewList.filter(p => p.status === 'included').length
  const maybeCount    = state.reviewList.filter(p => p.status === 'maybe').length
  const excludedCount = state.results.filter(p => p.status === 'excluded').length

  // Notes live in the store, not component state — they were previously lost
  // the moment the user navigated away from this step.
  function handleNoteChange(id: string, val: string) {
    dispatch({ type: 'UPDATE_REVIEW_NOTE', paperId: id, note: val })
  }

  function handleViewDetails(paper: ResultCard) {
    dispatch({
      type: 'ADD_DECISION_JOURNAL_ENTRY',
      entry: journalEntry({
        kind: 'ai_explanation_view',
        step: 5,
        action: 'Viewed paper details before screening decision',
        entityType: 'paper',
        entityId: paper.id,
        entityLabel: paper.title,
        details: paper.abstract
          ? 'The user opened the paper metadata and abstract.'
          : 'The user opened the paper metadata; no abstract was present in the record.',
      }),
    })
    setDetailPaper(paper)
  }

  // Unique topics/queries that appear in results
  const resultTopicIds = [...new Set(state.results.map(r => r.topicId))]
  const resultQueryIds = [...new Set(state.results.map(r => r.queryId))]

  // Filter. Excluded papers always remain listed and are identified by their
  // red status treatment: the left panel is "all papers", not just the queue.
  let displayedPapers = state.results.filter(p => {
    if (filterTopicId && p.topicId !== filterTopicId) return false
    if (filterQueryId && p.queryId !== filterQueryId) return false
    return true
  })

  // Sort. Excluded papers always sink to the bottom regardless of the chosen
  // key, so the active work stays on top while the excluded set stays in view.
  displayedPapers = [...displayedPapers].sort((a, b) => {
    const aEx = a.status === 'excluded' ? 1 : 0
    const bEx = b.status === 'excluded' ? 1 : 0
    if (aEx !== bEx) return aEx - bEx
    if (sortKey === 'relevance')  return b.relevanceScore - a.relevanceScore
    if (sortKey === 'year_desc')  return b.year - a.year
    if (sortKey === 'year_asc')   return a.year - b.year
    if (sortKey === 'topic')      return a.topicId.localeCompare(b.topicId)
    if (sortKey === 'query')      return a.queryId.localeCompare(b.queryId)
    return 0
  })

  const SORT_OPTIONS: { value: SortKey; label: string }[] = [
    { value: 'relevance',  label: 'Relevance ↓' },
    { value: 'year_desc',  label: 'Year (newest)' },
    { value: 'year_asc',   label: 'Year (oldest)' },
    { value: 'topic',      label: 'Topic' },
    { value: 'query',      label: 'Query' },
  ]

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel: All Papers ── */}
      <div className="flex flex-col border-r border-zinc-200 overflow-hidden" style={{ width: '55%' }}>
        {/* Header */}
        <div className="h-[44px] bg-zinc-900 flex items-center px-4 gap-3 shrink-0">
          <span className="text-white text-[11px] font-bold tracking-wider">ALL PAPERS</span>
          <span className="text-zinc-400 text-[10px]">{displayedPapers.length} / {state.results.length}</span>
          {state.screening.duplicatesRemoved > 0 && (
            <span
              className="text-amber-300 text-[10px]"
              title="Records matched to one already retrieved, by DOI or title, and kept only once"
            >
              {state.screening.duplicatesRemoved} dup removed
            </span>
          )}
          {excludedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded text-red-300">
              {excludedCount} excluded
            </span>
          )}
          <button
            onClick={() => setShowProtocol(v => !v)}
            className="ml-auto text-zinc-300 text-[10px] hover:text-white"
          >
            {showProtocol ? '▴' : '▾'} Protocol ({state.criteria.length})
          </button>
        </div>

        {showProtocol && <ProtocolPanel onClose={() => setShowProtocol(false)} auto={auto} />}

        {/* Sort + Filter bar */}
        <div className="h-[34px] bg-zinc-50 border-b border-zinc-200 flex items-center px-3 gap-2 shrink-0">
          {/* Sort */}
          <span className="text-[9px] text-zinc-400 font-semibold shrink-0">Sort</span>
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="h-6 border border-zinc-300 rounded px-1.5 text-[10px] text-zinc-700 bg-white focus:outline-none focus:border-zinc-500"
          >
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <div className="w-px h-4 bg-zinc-200 mx-0.5 shrink-0" />

          {/* Filter by topic */}
          <span className="text-[9px] text-zinc-400 font-semibold shrink-0">Filter</span>
          <div className="flex items-center gap-1 flex-wrap">
            {resultTopicIds.map(tid => {
              const topic = state.topics.find(t => t.id === tid)
              const num = tid.replace(/\D/g, '') || tid
              return (
                <FilterChip
                  key={tid}
                  label={`T${num}`}
                  tooltip={topic?.title ?? tid}
                  active={filterTopicId === tid}
                  onClick={() => setFilterTopicId(filterTopicId === tid ? null : tid)}
                />
              )
            })}
            {resultQueryIds.map(qid => {
              const query = state.queries.find(q => q.id === qid)
              const num = qid.replace(/\D/g, '') || qid
              return (
                <FilterChip
                  key={qid}
                  label={`Q${num}`}
                  tooltip={query?.text ?? qid}
                  active={filterQueryId === qid}
                  onClick={() => setFilterQueryId(filterQueryId === qid ? null : qid)}
                />
              )
            })}
            {(filterTopicId || filterQueryId) && (
              <button
                onClick={() => { setFilterTopicId(null); setFilterQueryId(null) }}
                className="text-[9px] text-red-400 hover:text-red-600 px-1"
              >
                ✕ clear
              </button>
            )}
          </div>
        </div>

        {/* Paper list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {displayedPapers.map(paper => (
            <PaperCard
              key={paper.id}
              paper={paper}
              onViewDetails={handleViewDetails}
              onSnowball={setSnowballSeed}
            />
          ))}
          {displayedPapers.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <p className="text-[11px] text-zinc-400 italic">No papers match the current filter.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel: Review List ── */}
      <div className="flex flex-col overflow-hidden flex-1">
        {/* Header */}
        <div className="h-[44px] bg-zinc-50 border-b border-zinc-200 flex items-center px-4 gap-3 shrink-0">
          <span className="text-zinc-700 text-[11px] font-bold tracking-wide">REVIEW LIST</span>
          <span className="text-zinc-500 text-[10px]">{state.reviewList.length} papers</span>
          <div className="flex gap-2 ml-2 text-[10px] text-zinc-400">
            <span className="text-zinc-900 font-medium">{includedCount} included</span>
            <span>·</span>
            <span>{maybeCount} later</span>
          </div>
        </div>

        {/* Review items */}
        <div className="flex-1 overflow-y-auto">
          {state.reviewList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <p className="text-[13px] text-zinc-400 mb-1">No papers added yet</p>
              <p className="text-[11px] text-zinc-300">Click Add or Later on papers to the left</p>
            </div>
          ) : (
            state.reviewList.map((paper, idx) => (
              <ReviewListItem
                key={paper.id}
                paper={paper}
                index={idx}
                onNoteChange={handleNoteChange}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="h-12 border-t border-zinc-200 bg-white flex items-center px-4 justify-end shrink-0">
          <button
            onClick={() => dispatch({ type: 'ADVANCE_STEP' })}
            className="px-5 h-8 bg-zinc-900 text-white rounded text-[12px] font-semibold hover:bg-zinc-700 transition-colors"
          >
            Continue to Matrix Table →
          </button>
        </div>
      </div>

      {/* ── Citation snowballing ── */}
      {snowballSeed && (
        <CitationsModal
          seed={{
            id: snowballSeed.id,
            title: snowballSeed.title,
            year: snowballSeed.year,
            url: snowballSeed.source,
            topicId: snowballSeed.topicId,
          }}
          onClose={() => setSnowballSeed(null)}
        />
      )}

      {/* ── View Details Modal ── */}
      {detailPaper && (
        <DetailModal
          paper={detailPaper}
          onClose={() => setDetailPaper(null)}
          onAdd={() => dispatch({ type: 'ADD_TO_REVIEW', paperId: detailPaper.id, status: 'included' })}
          onLater={() => dispatch({ type: 'ADD_TO_REVIEW', paperId: detailPaper.id, status: 'maybe' })}
        />
      )}
    </div>
  )
}
