import { useState } from 'react'
import { useApp } from '../store/AppContext'
import { QuestionButton } from '../components/shared/QuestionButton'
import { CustomizePromptModal } from '../components/shared/CustomizePromptModal'
import type { TopicCard, QueryCard } from '../types'
import { API, apiFetch } from '../lib/api'


function topicTypePill(type: TopicCard['type']) {
  switch (type) {
    case 'population': return 'bg-blue-100 text-blue-600'
    case 'design':     return 'bg-green-100 text-green-700'
    case 'risk':       return 'bg-red-100 text-red-700'
    case 'review':     return 'bg-purple-100 text-purple-700'
  }
}

// ── Left: Topic card ──────────────────────────────────────────────────────────
function TopicCardItem({ topic }: { topic: TopicCard }) {
  const { state, dispatch } = useApp()
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(topic.title)
  const [editDesc, setEditDesc] = useState(topic.description)

  // Type-label explanation (purple ?)
  const [typeExplOpen, setTypeExplOpen] = useState(false)
  const [typeExplText, setTypeExplText] = useState<string | null>(null)
  const [loadingTypeExpl, setLoadingTypeExpl] = useState(false)

  // "Why this topic?" profile reasoning
  const [reasonOpen, setReasonOpen] = useState(false)
  const [reasonText, setReasonText] = useState<string | null>(null)
  const [loadingReason, setLoadingReason] = useState(false)

  async function handleExplainType() {
    if (typeExplOpen) { setTypeExplOpen(false); return }
    setTypeExplOpen(true)
    if (typeExplText) return
    setLoadingTypeExpl(true)
    try {
      const res = await apiFetch(`${API}/topics/explain-type`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: topic.title, description: topic.description, type: topic.type }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTypeExplText(data.explanation)
    } catch {
      setTypeExplText('Could not load explanation.')
    } finally {
      setLoadingTypeExpl(false)
    }
  }

  async function handleReason(e: React.MouseEvent) {
    e.stopPropagation()
    if (reasonOpen) { setReasonOpen(false); return }
    setReasonOpen(true)
    if (reasonText) return
    setLoadingReason(true)
    try {
      const res = await apiFetch(`${API}/topics/reason`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: topic.title,
          description: topic.description,
          tags: topic.tags,
          rationale: topic.rationale,
          profile: state.profile,
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setReasonText(data.reasoning)
    } catch {
      setReasonText('Could not load reasoning.')
    } finally {
      setLoadingReason(false)
    }
  }

  function saveEdit() {
    dispatch({ type: 'UPDATE_TOPIC', topicId: topic.id, field: 'title', value: editTitle })
    dispatch({ type: 'UPDATE_TOPIC', topicId: topic.id, field: 'description', value: editDesc })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="rounded-lg border-2 border-blue-400 bg-white p-2 mb-2 flex flex-col gap-1.5">
        <input
          className="w-full border border-zinc-300 rounded px-2 py-1 text-[12px] font-semibold text-zinc-900 focus:outline-none focus:border-blue-400"
          value={editTitle}
          onChange={e => setEditTitle(e.target.value)}
          placeholder="Topic title"
          autoFocus
        />
        <textarea
          className="w-full border border-zinc-300 rounded px-2 py-1 text-[11px] text-zinc-600 resize-none focus:outline-none focus:border-blue-400"
          rows={3}
          value={editDesc}
          onChange={e => setEditDesc(e.target.value)}
          placeholder="Description"
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => { setEditTitle(topic.title); setEditDesc(topic.description); setEditing(false) }}
            className="px-2 py-0.5 text-[10px] border border-zinc-300 rounded text-zinc-600 hover:bg-zinc-50"
          >Cancel</button>
          <button
            onClick={saveEdit}
            className="px-2 py-0.5 text-[10px] bg-blue-500 text-white rounded hover:bg-blue-600"
          >Save</button>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={() => dispatch({ type: 'TOGGLE_TOPIC', topicId: topic.id })}
      className={`relative rounded-lg cursor-pointer flex flex-col p-2 mb-2 border transition-colors group ${
        topic.selected ? 'border-2 border-blue-500 border-t-[5px]' : 'border border-zinc-200'
      }`}
    >
      {/* Checkbox top-right */}
      <div className={`absolute top-2 right-2 w-4 h-4 rounded border flex items-center justify-center ${
        topic.selected ? 'bg-blue-500 border-blue-500' : 'border-zinc-300'
      }`}>
        {topic.selected && <span className="text-white text-[9px] leading-none">✓</span>}
      </div>

      {/* Edit button (hover) */}
      <button
        onClick={e => { e.stopPropagation(); setEditing(true) }}
        className="absolute top-2 right-7 text-[9px] text-zinc-400 hover:text-zinc-700 hidden group-hover:block"
        title="Edit topic"
      >✎</button>

      {/* Type badge + ? + full title on one line */}
      <div className="flex items-start gap-1.5 mb-1.5 pr-10">
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-semibold ${topicTypePill(topic.type)}`}>
          {topic.type}
        </span>
        <QuestionButton onClick={handleExplainType} />
        <span className="text-[11px] font-semibold text-zinc-800 leading-tight">
          {topic.title}
        </span>
      </div>

      {/* Type explanation popover */}
      {typeExplOpen && (
        <div className="mb-1.5 bg-violet-50 border border-violet-200 rounded p-2">
          {loadingTypeExpl ? (
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
              <span className="text-[10px] text-violet-500">Explaining…</span>
            </div>
          ) : (
            <p className="text-[10px] text-violet-800 leading-relaxed">{typeExplText}</p>
          )}
        </div>
      )}

      {/* Description */}
      <p className="text-[11px] text-zinc-500 line-clamp-3 mb-1 flex-1">
        {topic.description}
      </p>

      {/* Tags */}
      <div className="flex flex-wrap gap-1 mb-1">
        {topic.tags.map(tag => (
          <span key={tag} className="px-1.5 py-0.5 bg-zinc-200 rounded text-[9px] text-zinc-600">
            {tag}
          </span>
        ))}
      </div>

      {/* Why this topic? */}
      <button onClick={handleReason} className="text-[10px] text-blue-500 text-left">
        Why this topic? {reasonOpen ? '▴' : '▾'}
      </button>

      {reasonOpen && (
        <div className="mt-1.5 bg-blue-50 border border-blue-200 rounded p-2">
          {loadingReason ? (
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
              <span className="text-[10px] text-blue-500">Analysing…</span>
            </div>
          ) : (
            <p className="text-[10px] text-blue-800 leading-relaxed">{reasonText}</p>
          )}
        </div>
      )}

      {/* Profile alignment */}
      {topic.profileMatch && (
        <div className="mt-1">
          {topic.profileMatch === 'profile_match'
            ? <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full text-[9px]">profile match ✓</span>
            : <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[9px]">inferred</span>
          }
        </div>
      )}
    </div>
  )
}

// ── Add Topic form ────────────────────────────────────────────────────────────
function AddTopicForm({ onClose }: { onClose: () => void }) {
  const { dispatch } = useApp()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<TopicCard['type']>('population')

  function submit() {
    if (!title.trim()) return
    dispatch({
      type: 'ADD_TOPIC',
      topic: {
        id: `t-manual-${Date.now()}`,
        type,
        title: title.trim(),
        description: description.trim(),
        tags: ['manual'],
        rationale: 'Manually added by user.',
        profileMatch: null,
        selected: true,
        confidence: 'none',
      },
    })
    onClose()
  }

  return (
    <div className="rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/40 p-2 mb-2 flex flex-col gap-1.5">
      <p className="text-[10px] font-bold text-blue-600">New Topic</p>
      <select
        value={type}
        onChange={e => setType(e.target.value as TopicCard['type'])}
        className="w-full border border-zinc-300 rounded px-2 py-0.5 text-[10px] text-zinc-700 bg-white focus:outline-none focus:border-blue-400"
      >
        <option value="population">Population</option>
        <option value="design">Design</option>
        <option value="risk">Risk</option>
        <option value="review">Review</option>
      </select>
      <input
        className="w-full border border-zinc-300 rounded px-2 py-1 text-[12px] font-semibold text-zinc-900 focus:outline-none focus:border-blue-400"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Topic title"
        autoFocus
      />
      <textarea
        className="w-full border border-zinc-300 rounded px-2 py-1 text-[11px] text-zinc-600 resize-none focus:outline-none focus:border-blue-400"
        rows={2}
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)"
      />
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="px-2 py-0.5 text-[10px] border border-zinc-300 rounded text-zinc-600 hover:bg-zinc-50">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!title.trim()}
          className="px-2 py-0.5 text-[10px] bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40"
        >
          Add Topic
        </button>
      </div>
    </div>
  )
}

// ── Centre: Query card ────────────────────────────────────────────────────────
function QueryCardItem({ query }: { query: QueryCard }) {
  const { dispatch, state } = useApp()
  const [text, setText] = useState(query.text)
  const [searching, setSearching] = useState(false)
  const [resultCount, setResultCount] = useState<number | null>(null)
  const [searchError, setSearchError] = useState(false)

  async function handleSearch(e: React.MouseEvent) {
    e.stopPropagation()
    if (searching) return
    setSearching(true)
    setSearchError(false)
    try {
      const res = await apiFetch(`${API}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, limit: 8 }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      const papers = data.papers as { title: string; authors: string; year: number | null; url: string; openAccessUrl: string | null; abstract: string }[]

      // Map to ResultCard format and accumulate into store
      const mapped = papers.map((p, i) => ({
        id: `search-${query.id}-${Date.now()}-${i}`,
        title: p.title,
        authors: p.authors,
        year: p.year ?? 0,
        source: p.url,
        relevanceScore: 0,
        abstract: p.abstract ?? '',
        topicId: query.topicId,
        queryId: query.id,
        confidence: 'none' as const,
        isDuplicate: false,
        status: null as null,
        notes: '',
      }))

      dispatch({ type: 'ADD_SEARCH_RESULTS', results: mapped })
      setResultCount(papers.length)

      // Fire recognise for each paper in background — update relevance score as results arrive
      mapped.forEach(paper => {
        apiFetch(`${API}/recognise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'paper_relevance',
            paper: { title: paper.title, abstract: paper.abstract, authors: paper.authors, year: paper.year },
            profile: state.profile,
          }),
        })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (!data) return
            const confidence = data.score >= 75 ? 'high' : data.score >= 45 ? 'medium' : data.score >= 15 ? 'low' : 'none'
            dispatch({ type: 'UPDATE_RESULT_RELEVANCE', paperId: paper.id, score: data.score, confidence })
          })
          .catch(() => { /* silent — card stays at 0 */ })
      })
    } catch {
      setSearchError(true)
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2 mb-2 flex flex-col gap-1.5">
      {/* Query header */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-bold text-zinc-400">Query {query.queryN}</span>
        <span className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-200 rounded text-[9px] text-zinc-500 truncate flex-1">
          {query.topicId}
        </span>
        {query.stale && (
          <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded border border-amber-300">stale</span>
        )}
        {resultCount !== null && !searchError && (
          <span className="text-[9px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded border border-teal-200">
            +{resultCount} added
          </span>
        )}
        {searchError && (
          <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded border border-red-200">error</span>
        )}
      </div>

      {/* Query text */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        className="w-full bg-zinc-50 border border-zinc-300 rounded text-[10px] text-zinc-800 p-1.5 resize-none focus:outline-none focus:border-zinc-500 font-mono"
      />

      {/* Actions row */}
      <div className="flex items-center gap-2">
        <button className="text-[10px] text-zinc-400 hover:text-zinc-700">Edit</button>
        <button className="text-[10px] text-zinc-400 hover:text-zinc-700">Duplicate</button>
        <button className="text-[10px] text-red-400 hover:text-red-600">Delete</button>
        <div className="flex-1" />
        <button
          onClick={handleSearch}
          disabled={searching}
          className="flex items-center gap-1.5 px-3 h-[26px] bg-zinc-900 text-white rounded text-[10px] font-semibold hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {searching
            ? <span className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />
            : <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="5" cy="5" r="3.5" stroke="white" strokeWidth="1.5"/><path d="M8 8l2 2" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
          }
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>
    </div>
  )
}

// ── Right: Result card ────────────────────────────────────────────────────────
function ResultCardItem({
  result,
  selected,
  anySelected,
  onToggle,
  onDelete,
}: {
  result: { id: string; title: string; authors: string; year: number; source?: string; relevanceScore?: number; confidence?: string }
  selected: boolean
  anySelected: boolean
  onToggle: (id: string) => void
  onDelete: (id: string) => void
}) {
  const title = result.source
    ? <a href={result.source} target="_blank" rel="noopener noreferrer" className="hover:underline text-blue-800">{result.title}</a>
    : <span>{result.title}</span>

  const score = result.relevanceScore ?? 0
  const conf = result.confidence ?? 'none'
  const barColor = conf === 'high' ? 'bg-green-500' : conf === 'medium' ? 'bg-amber-500' : conf === 'low' ? 'bg-orange-400' : 'bg-zinc-300'

  return (
    <div className={`group border-b border-zinc-100 px-2 py-2 flex gap-2 items-start transition-colors ${selected ? 'bg-red-50' : 'hover:bg-zinc-50'}`}>
      {/* Checkbox — always visible when any selected, else on hover */}
      <div
        onClick={() => onToggle(result.id)}
        className={`shrink-0 mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center cursor-pointer transition-opacity ${
          anySelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        } ${selected ? 'bg-red-500 border-red-500' : 'border-zinc-300 bg-white hover:border-red-400'}`}
      >
        {selected && <span className="text-white text-[8px] leading-none">✓</span>}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1">
          <p className="text-[11px] font-semibold text-zinc-950 leading-tight line-clamp-2 flex-1">{title}</p>
          <button
            onClick={() => onDelete(result.id)}
            className="shrink-0 text-zinc-300 hover:text-red-500 text-[11px] leading-none opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
            title="Delete"
          >×</button>
        </div>
        <p className="text-[10px] text-zinc-400 mt-0.5">
          {result.authors}{result.year ? ` · ${result.year}` : ''}
        </p>
        {score > 0 && (
          <div className="flex items-center gap-1.5 mt-1">
            <div className="flex-1 h-1 bg-zinc-100 rounded overflow-hidden">
              <div className={`h-full rounded ${barColor}`} style={{ width: `${score}%` }} />
            </div>
            <span className="text-[9px] text-zinc-400 shrink-0">{score}%</span>
          </div>
        )}
        {score === 0 && conf === 'none' && (
          <div className="flex items-center gap-1 mt-1">
            <span className="w-2 h-2 border border-zinc-300 border-t-purple-500 rounded-full animate-spin" />
            <span className="text-[9px] text-zinc-400">assessing…</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Screen3 ──────────────────────────────────────────────────────────────
export function Screen3() {
  const { state, dispatch } = useApp()
  const [showAddTopic, setShowAddTopic] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [queriesGenerated, setQueriesGenerated] = useState(state.queries.length > 0)
  const [selectedResultIds, setSelectedResultIds] = useState<Set<string>>(new Set())
  const [showRegenModal, setShowRegenModal] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [customRegenPrompt, setCustomRegenPrompt] = useState<string | null>(null)
  const [customConfirmPrompt, setCustomConfirmPrompt] = useState<string | null>(null)

  function toggleResult(id: string) {
    setSelectedResultIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function deleteSelected() {
    dispatch({ type: 'REMOVE_RESULTS', paperIds: Array.from(selectedResultIds) })
    setSelectedResultIds(new Set())
  }
  function deleteSingle(id: string) {
    dispatch({ type: 'REMOVE_RESULTS', paperIds: [id] })
    setSelectedResultIds(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  const selectedTopics = state.topics.filter(t => t.selected)
  const selectedTopicIds = selectedTopics.map(t => t.id)
  const visibleQueries = state.queries.filter(q => selectedTopicIds.includes(q.topicId))

  async function handleRegenerate(prompt?: string | null) {
    if (isRegenerating) return
    setIsRegenerating(true)
    try {
      const res = await apiFetch(`${API}/topics/generate-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...state.profile, custom_system_prompt: prompt ?? null }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      dispatch({ type: 'SET_TOPICS', topics: data.topics })
      setQueriesGenerated(false)
    } catch {
      // silently fail
    } finally {
      setIsRegenerating(false)
    }
  }

  async function handleConfirm(prompt?: string | null) {
    if (isConfirming || selectedTopics.length === 0) return
    setIsConfirming(true)
    try {
      const res = await apiFetch(`${API}/queries/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topics: selectedTopics.map(t => ({ id: t.id, title: t.title, description: t.description, tags: t.tags })),
          profile: state.profile,
          custom_system_prompt: prompt ?? null,
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      dispatch({ type: 'SET_QUERIES', queries: data.queries })
      setQueriesGenerated(true)
    } catch {
      // silently fail
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 overflow-hidden">

        {/* Left — Topic Selection */}
        <div className="flex-1 flex flex-col border-r border-zinc-200 overflow-hidden">
          <div className="h-[30px] bg-zinc-900 flex items-center px-3 gap-2 shrink-0">
            <span className="text-white text-[10px] font-bold tracking-wider flex-1">TOPICS</span>
            <button onClick={() => setShowAddTopic(v => !v)} className="text-zinc-400 text-[9px] hover:text-white">
              + Add
            </button>
            <button
              onClick={() => handleRegenerate(customRegenPrompt)}
              disabled={isRegenerating}
              className="flex items-center gap-1 px-2 h-[20px] rounded bg-zinc-700 text-zinc-200 text-[9px] hover:bg-zinc-600 disabled:opacity-50 transition-colors"
            >
              {isRegenerating
                ? <span className="w-2.5 h-2.5 border border-zinc-400 border-t-white rounded-full animate-spin" />
                : <span>↺</span>}
              {customRegenPrompt && <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />}
              Regenerate
            </button>
            <button
              onClick={() => setShowRegenModal(true)}
              disabled={isRegenerating}
              title="Customize AI prompt"
              className="flex items-center justify-center w-[18px] h-[18px] rounded bg-zinc-700 text-zinc-400 text-[9px] hover:bg-zinc-600 hover:text-zinc-200 disabled:opacity-50 transition-colors"
            >
              ⚙
            </button>
            <button
              onClick={() => handleConfirm(customConfirmPrompt)}
              disabled={isConfirming || selectedTopics.length === 0}
              className={`flex items-center gap-1 px-2 h-[20px] rounded text-[9px] font-semibold transition-colors ${
                queriesGenerated ? 'bg-teal-600 text-white hover:bg-teal-500' : 'bg-blue-500 text-white hover:bg-blue-400'
              } disabled:opacity-50`}
            >
              {isConfirming
                ? <span className="w-2.5 h-2.5 border border-blue-300 border-t-white rounded-full animate-spin" />
                : <span>{queriesGenerated ? '✓' : '→'}</span>}
              {customConfirmPrompt && <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />}
              {queriesGenerated ? 'Confirmed' : 'Confirm'}
            </button>
            <button
              onClick={() => setShowConfirmModal(true)}
              disabled={isConfirming || selectedTopics.length === 0}
              title="Customize AI prompt"
              className="flex items-center justify-center w-[18px] h-[18px] rounded bg-blue-600 text-blue-200 text-[9px] hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              ⚙
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {showAddTopic && <AddTopicForm onClose={() => setShowAddTopic(false)} />}
            {state.topics.map(topic => (
              <TopicCardItem key={topic.id} topic={topic} />
            ))}
          </div>
        </div>

        {/* Centre — Query Editor */}
        <div className="flex-1 flex flex-col border-r border-zinc-200 overflow-hidden">
          <div className="h-[30px] bg-zinc-900 flex items-center px-3 gap-2 shrink-0">
            <span className="text-white text-[10px] font-bold tracking-wider flex-1">QUERIES</span>
            <button className="text-zinc-300 text-[9px] hover:text-white">+ Add</button>
            <button className="text-zinc-300 text-[9px] hover:text-white">↺ Regen All</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {visibleQueries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <p className="text-[11px] text-zinc-400 italic">
                  {selectedTopics.length === 0
                    ? 'Select topics on the left to generate queries.'
                    : 'Click Confirm in the Topics panel to generate search queries.'}
                </p>
              </div>
            ) : (
              visibleQueries.map(query => (
                <QueryCardItem key={query.id} query={query} />
              ))
            )}
          </div>
        </div>

        {/* Right — Results */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="h-[30px] bg-zinc-900 flex items-center px-3 gap-2 shrink-0">
            <span className="text-white text-[10px] font-bold flex-1">Search Results</span>
            <span className="text-zinc-300 text-[9px]">{state.results.length} found</span>
            {selectedResultIds.size > 0 && (
              <button
                onClick={deleteSelected}
                className="flex items-center gap-1 px-2 h-5 rounded bg-red-600 text-white text-[9px] font-semibold hover:bg-red-500"
              >
                Delete ({selectedResultIds.size})
              </button>
            )}
            {state.results.length > 0 && (
              <button
                onClick={() => { dispatch({ type: 'CLEAR_RESULTS' }); setSelectedResultIds(new Set()) }}
                className="text-zinc-400 text-[9px] hover:text-white"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {state.results.length === 0 ? (
              <div className="flex items-center justify-center h-full text-center px-4">
                <p className="text-[11px] text-zinc-400 italic">Click Search on any query to find papers.</p>
              </div>
            ) : (
              state.results.map(result => (
                <ResultCardItem
                  key={result.id}
                  result={result}
                  selected={selectedResultIds.has(result.id)}
                  anySelected={selectedResultIds.size > 0}
                  onToggle={toggleResult}
                  onDelete={deleteSingle}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="h-[52px] border-t border-zinc-200 bg-white flex items-center justify-end px-4 shrink-0">
        <button
          onClick={() => dispatch({ type: 'ADVANCE_STEP' })}
          className="px-5 h-9 bg-zinc-900 text-white rounded text-[12px] font-semibold hover:bg-zinc-700 transition-colors"
        >
          Confirm Topics &amp; Queries →
        </button>
      </div>

      {showRegenModal && (
        <CustomizePromptModal
          promptKey="topics-generate"
          title="Regenerate Topics"
          initialCustomPrompt={customRegenPrompt}
          onClose={() => setShowRegenModal(false)}
          onGenerate={(prompt) => {
            setCustomRegenPrompt(prompt)
            setShowRegenModal(false)
            handleRegenerate(prompt)
          }}
        />
      )}
      {showConfirmModal && (
        <CustomizePromptModal
          promptKey="queries-generate"
          title="Generate Queries"
          initialCustomPrompt={customConfirmPrompt}
          onClose={() => setShowConfirmModal(false)}
          onGenerate={(prompt) => {
            setCustomConfirmPrompt(prompt)
            setShowConfirmModal(false)
            handleConfirm(prompt)
          }}
        />
      )}
    </div>
  )
}
