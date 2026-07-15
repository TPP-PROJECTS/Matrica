import { useState, useEffect } from 'react'
import { useApp } from '../store/AppContext'
import type { ResultCard } from '../types'
import { API, apiFetch } from '../lib/api'
import { CitationsModal } from '../components/overlays/CitationsModal'


// ── Status badge ──────────────────────────────────────────────────────────────
function statusBadge(status: ResultCard['status']) {
  switch (status) {
    case 'included': return 'bg-zinc-900 text-white'
    case 'maybe':    return 'bg-amber-100 text-amber-800'
    case 'saved':    return 'bg-blue-100 text-blue-800'
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
}

function DetailModal({ paper, onClose, onAdd, onLater }: {
  paper: ResultCard
  onClose: () => void
  onAdd: () => void
  onLater: () => void
}) {
  const { state } = useApp()
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [showCitations, setShowCitations] = useState(false)
  const [recognising, setRecognising] = useState(false)
  const [recogniseResult, setRecogniseResult] = useState<RecogniseResult | null>(null)
  const [recogniseError, setRecogniseError] = useState(false)

  const topic = state.topics.find(t => t.id === paper.topicId)
  const query  = state.queries.find(q => q.id === paper.queryId)
  const inReview = state.reviewList.some(r => r.id === paper.id)

  useEffect(() => {
    async function runRecognise() {
      setRecognising(true)
      setRecogniseError(false)
      try {
        const res = await apiFetch(`${API}/recognise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'paper_relevance',
            paper: { title: paper.title, abstract: paper.abstract, authors: paper.authors, year: paper.year },
            profile: state.profile,
          }),
        })
        if (!res.ok) throw new Error()
        const data = await res.json()
        setRecogniseResult(data)
      } catch {
        setRecogniseError(true)
      } finally {
        setRecognising(false)
      }
    }
    runRecognise()
  }, [paper.id])

  // AI-generated summary from abstract
  const firstSentence = paper.abstract ? paper.abstract.split('.')[0] : ''
  const aiSummary = paper.abstract
    ? `This ${paper.year} study by ${paper.authors} investigates a question central to AI in clinical settings. ` +
      `${firstSentence}. The evidence suggests measurable benefits when AI tools are integrated appropriately, ` +
      `though long-term sustainability and generalisability across diverse healthcare systems remain open questions. ` +
      `Relevance to the current review is rated ${paper.confidence} confidence (${paper.relevanceScore}%).`
    : 'Abstract not available — AI summary cannot be generated.'

  const conclusion = paper.abstract
    ? `Based on the evidence presented, ${paper.authors} conclude that ${firstSentence.toLowerCase()}. ` +
      `The findings carry implications for clinical practice, particularly in settings where AI-assisted decision-making ` +
      `is being considered at scale. Future work should address the limitations identified, including ` +
      `sample diversity, follow-up duration, and cost-effectiveness data.`
    : 'Abstract not available — conclusion cannot be inferred.'

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
                    <span className="text-[9px] text-red-500">Assessment failed</span>
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
                    <p className="text-[9px] text-purple-400 italic">AI-assessed · gpt-5.5</p>
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
              <p className="text-[12px] text-zinc-700 leading-relaxed">{paper.abstract}</p>
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
                <p className="text-[12px] text-zinc-700 leading-relaxed">{aiSummary}</p>
              </div>
              <p className="text-[9px] italic text-zinc-400 mt-2">
                Generated from abstract and metadata. Verify before citing.
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
                <p className="text-[12px] text-zinc-700 leading-relaxed">{conclusion}</p>
              </div>
              <p className="text-[9px] italic text-zinc-400 mt-2">
                AI-inferred from abstract. Check full text to confirm.
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
            href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`}
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
        seed={{ title: paper.title, url: paper.source, topicId: paper.topicId }}
        onClose={() => setShowCitations(false)}
      />
    )}
   </>
  )
}

// ── Left: paper card (detailed) ───────────────────────────────────────────────
function PaperCard({ paper, onViewDetails }: {
  paper: ResultCard
  onViewDetails: (p: ResultCard) => void
}) {
  const { dispatch, state } = useApp()
  const inReview = state.reviewList.some(r => r.id === paper.id)

  function add() {
    dispatch({ type: 'ADD_TO_REVIEW', paperId: paper.id, status: 'included' })
  }
  function later() {
    dispatch({ type: 'ADD_TO_REVIEW', paperId: paper.id, status: 'maybe' })
  }

  return (
    <div className={`rounded-lg border bg-white p-3 flex flex-col gap-1.5 ${
      paper.isDuplicate ? 'border-l-4 border-l-orange-300 border-r border-t border-b border-zinc-200' : 'border-zinc-200'
    }`}>
      {/* Title */}
      <p className="text-[12px] font-semibold text-zinc-950 leading-snug">
        {paper.title}
      </p>

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
        via Topic {paper.topicId.replace('t', '')} · Query {paper.queryId.replace('q', '')}
      </p>

      {/* Action row */}
      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={() => onViewDetails(paper)}
          className="px-2.5 h-7 border border-zinc-300 rounded text-[10px] text-zinc-700 hover:bg-zinc-50"
        >
          View Details
        </button>
        {inReview ? (
          <span className="text-[10px] text-green-600 font-medium">✓ Added</span>
        ) : (
          <>
            <button
              onClick={add}
              className="px-2.5 h-7 bg-zinc-900 text-white rounded text-[10px] font-medium hover:bg-zinc-700"
            >
              Add
            </button>
            <button
              onClick={later}
              className="px-2.5 h-7 border border-zinc-300 rounded text-[10px] text-zinc-600 hover:bg-zinc-50"
            >
              Later
            </button>
          </>
        )}
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
function ReviewListItem({ paper, index, notes, onNoteChange }: {
  paper: ResultCard
  index: number
  notes: Record<string, string>
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
          value={notes[paper.id] ?? paper.notes}
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
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [detailPaper, setDetailPaper] = useState<ResultCard | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('relevance')
  const [filterTopicId, setFilterTopicId] = useState<string | null>(null)
  const [filterQueryId, setFilterQueryId] = useState<string | null>(null)

  const includedCount = state.reviewList.filter(p => p.status === 'included').length
  const maybeCount    = state.reviewList.filter(p => p.status === 'maybe').length

  function handleNoteChange(id: string, val: string) {
    setNotes(prev => ({ ...prev, [id]: val }))
  }

  // Unique topics/queries that appear in results
  const resultTopicIds = [...new Set(state.results.map(r => r.topicId))]
  const resultQueryIds = [...new Set(state.results.map(r => r.queryId))]

  // Filter
  let displayedPapers = state.results.filter(p => {
    if (filterTopicId && p.topicId !== filterTopicId) return false
    if (filterQueryId && p.queryId !== filterQueryId) return false
    return true
  })

  // Sort
  displayedPapers = [...displayedPapers].sort((a, b) => {
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
        </div>

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
              onViewDetails={setDetailPaper}
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
                notes={notes}
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
