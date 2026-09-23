import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/AppContext'
import { QuestionButton } from '../components/shared/QuestionButton'
import { CustomizePromptModal } from '../components/shared/CustomizePromptModal'
import type { TopicCard, QueryCard, ResultCard, SearchFilters, SearchSource } from '../types'
import { duplicatesRemoved } from '../types'
import { API, apiFetch } from '../lib/api'
import { scorePaperRelevance } from '../lib/scorePaper'
import { journalEntry } from '../lib/decisionJournal'
import { newId } from '../lib/ids'
import { SystemsPanel } from '../components/systems/SystemsPanel'
import { LinkChips, type LinkChipItem } from '../components/shared/LinkChips'


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
    if (typeExplText) {
      dispatch({
        type: 'ADD_DECISION_JOURNAL_ENTRY',
        entry: journalEntry({
          kind: 'ai_explanation_view', step: 3,
          action: 'Reopened AI topic-type explanation',
          entityType: 'topic', entityId: topic.id, entityLabel: topic.title,
          details: typeExplText,
        }),
      })
      return
    }
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
      dispatch({
        type: 'ADD_DECISION_JOURNAL_ENTRY',
        entry: journalEntry({
          kind: 'ai_explanation_view',
          step: 3,
          action: 'Viewed AI topic-type explanation',
          entityType: 'topic',
          entityId: topic.id,
          entityLabel: topic.title,
          details: data.explanation,
        }),
      })
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
    if (reasonText) {
      dispatch({
        type: 'ADD_DECISION_JOURNAL_ENTRY',
        entry: journalEntry({
          kind: 'ai_explanation_view', step: 3,
          action: 'Reopened “Why this topic?” reasoning',
          entityType: 'topic', entityId: topic.id, entityLabel: topic.title,
          details: reasonText,
        }),
      })
      return
    }
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
      dispatch({
        type: 'ADD_DECISION_JOURNAL_ENTRY',
        entry: journalEntry({
          kind: 'ai_explanation_view',
          step: 3,
          action: 'Viewed “Why this topic?” reasoning',
          entityType: 'topic',
          entityId: topic.id,
          entityLabel: topic.title,
          details: data.reasoning,
        }),
      })
    } catch {
      setReasonText('Could not load reasoning.')
    } finally {
      setLoadingReason(false)
    }
  }

  const linkedSystems: LinkChipItem[] = (state.systemTopicLinks ?? [])
    .filter(link => link.topicId === topic.id)
    .flatMap(link => {
      const system = (state.systemItems ?? []).find(s => s.id === link.systemId)
      return system
        ? [{ id: system.id, label: system.name, strength: link.strength, reason: link.reason }]
        : []
    })

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

      {/* Systems that bear on this topic */}
      <LinkChips items={linkedSystems} heading="Related systems" tone="violet" />
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
        id: newId('t-manual'),
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
const PAGE_SIZE = 8

function QueryCardItem({ query }: { query: QueryCard }) {
  const { dispatch, state } = useApp()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState(query.text)
  const [searching, setSearching] = useState(false)
  // Cumulative across pages, so "load more" reads as one growing search rather
  // than a series of unrelated ones.
  const [retrieved, setRetrieved] = useState(0)
  const [totalAvailable, setTotalAvailable] = useState<number | null>(null)
  const [nextPage, setNextPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [sourceWarning, setSourceWarning] = useState<string | null>(null)
  const [searchedSources, setSearchedSources] = useState<string[]>(['OpenAlex', 'PubMed'])
  const [editJustification, setEditJustification] = useState('')

  // A query belongs either to a topic or to a system under review; the card
  // shows whichever it is by name rather than by raw id.
  const subjectSystem = (state.systemItems ?? []).find(s => s.id === query.topicId)
  const subjectTopic = state.topics.find(t => t.id === query.topicId)
  const subjectIsSystem = Boolean(subjectSystem)
  const subjectLabel = subjectSystem?.name ?? subjectTopic?.title ?? query.topicId

  /**
   * Whether this query also searches the open web.
   *
   * On by default for a system, off by default for a topic. A commercial
   * platform's evidence is largely grey literature — its documentation, a
   * vendor white paper, a regulator's clearance, a health service's
   * implementation report — none of which a bibliographic database indexes, so
   * a literature-only search for a system routinely returns nothing and the
   * system reads as unstudied when it is only unindexed. A topic does not have
   * that problem, and grey literature is a deliberate choice there.
   */
  const [includeWeb, setIncludeWeb] = useState(subjectIsSystem)
  const webAlreadySelected = state.searchSources.includes('web')
  const searchSources = includeWeb && !webAlreadySelected
    ? [...state.searchSources, 'web']
    : state.searchSources

  /**
   * What the search is about, in plain language.
   *
   * The Boolean string below is written for a bibliographic database. Run
   * verbatim as a web search it finds the journal articles it was written to
   * find — the one thing the grey-literature source must not return — so the
   * subject is sent alongside it and the web source searches that instead.
   */
  const webSubject = subjectSystem
    ? [
        subjectSystem.name,
        subjectSystem.vendor ? `by ${subjectSystem.vendor}` : '',
        subjectSystem.description,
      ].filter(Boolean).join(' — ')
    : subjectTopic
      ? [subjectTopic.title, subjectTopic.description].filter(Boolean).join('. ')
      : ''

  function saveQueryEdit() {
    const next = text.trim()
    if (!next || next === query.text) return
    dispatch({
      type: 'SET_QUERIES',
      queries: state.queries.map(q => q.id === query.id ? { ...q, text: next, stale: true } : q),
    })
    dispatch({
      type: 'ADD_DECISION_JOURNAL_ENTRY',
      entry: journalEntry({
        kind: 'justification',
        step: 3,
        action: 'Edited search query',
        entityType: 'query',
        entityId: query.id,
        entityLabel: `Query ${query.queryN}`,
        previousValue: query.text,
        newValue: next,
        justification: editJustification.trim() || undefined,
      }),
    })
    setEditJustification('')
  }

  function duplicateQuery() {
    const nextNumber = Math.max(0, ...state.queries.map(item => item.queryN)) + 1
    dispatch({
      type: 'SET_QUERIES',
      queries: [
        ...state.queries,
        {
          ...query,
          id: `query-manual-${state.sessionId}-${nextNumber}`,
          queryN: nextNumber,
          text,
          resultCount: 0,
          stale: false,
        },
      ],
    })
  }

  function deleteQuery() {
    dispatch({ type: 'SET_QUERIES', queries: state.queries.filter(item => item.id !== query.id) })
  }

  async function runSearch(page: number) {
    if (searching) return
    setSearching(true)
    setSearchError(null)
    setSourceWarning(null)
    try {
      const res = await apiFetch(`${API}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: text,
          limit: PAGE_SIZE,
          page,
          filters: state.searchFilters,
          sources: searchSources,
          subject: webSubject,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `Search failed (HTTP ${res.status})`)
      }
      const data = await res.json()
      setSearchedSources(data.sources_searched ?? [])
      // Record the strategy as executed, for the PRISMA search-strategy appendix.
      dispatch({
        type: 'RECORD_QUERY_RUN',
        queryId: query.id,
        runAt: new Date().toISOString(),
        filters: state.searchFilters,
        sourceQueries: (data.source_queries ?? []).map(
          (sq: { source: string; query_as_run: string; hits: number }) => ({
            source: sq.source, queryAsRun: sq.query_as_run, hits: sq.hits,
          }),
        ),
      })
      if (data.source_errors?.length) setSourceWarning(data.source_errors.join(' · '))
      const papers = data.papers as {
        title: string; authors: string; year: number | null
        url: string; openAccessUrl: string | null; abstract: string
        // Which source answered. Only "web" changes how the record is counted.
        source?: string
      }[]

      // Map to ResultCard format and accumulate into store. A record found on
      // the open web is not a database record: PRISMA counts it on the
      // websites/organisations pathway, so it carries its own origin and is
      // kept out of the database figures below.
      const mapped: ResultCard[] = papers.map(p => ({
        id: newId(`search-${query.id}`),
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
        status: null,
        notes: '',
        origin: p.source === 'web' ? ('web' as const) : ('search' as const),
        scoreStatus: 'pending',
      }))
      const fromDatabases = mapped.filter(p => p.origin === 'search').length

      dispatch({
        type: 'ADD_SEARCH_RESULTS',
        results: mapped,
        // Only the first page carries the database total; later pages report the
        // same figure and would just overwrite it with itself.
        identifiedFor: page === 1
          ? { queryId: query.id, count: data.total_available ?? papers.length }
          : undefined,
        // Every page reports what the *databases* pulled in; the PRISMA
        // duplicate figure is derived from this against the unique database
        // papers held, so counting web pages here would invent duplicates.
        retrievedFor: { queryId: query.id, page, count: fromDatabases },
      })
      setRetrieved(prev => (page === 1 ? papers.length : prev + papers.length))
      if (page === 1) setTotalAvailable(data.total_available ?? null)
      setHasMore(Boolean(data.has_more))
      setNextPage(page + 1)

      // Assess relevance in the background; cards update as scores arrive.
      mapped.forEach(paper => { void scorePaperRelevance(paper, state.profile, dispatch) })
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Search failed.')
    } finally {
      setSearching(false)
    }
  }

  function handleSearch(e: React.MouseEvent) {
    e.stopPropagation()
    saveQueryEdit()
    void runSearch(1)
  }

  function handleLoadMore(e: React.MouseEvent) {
    e.stopPropagation()
    void runSearch(nextPage)
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2 mb-2 flex flex-col gap-1.5">
      {/* Query header */}
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-bold text-zinc-400">Query {query.queryN}</span>
        <span
          title={subjectLabel}
          className={`px-1.5 py-0.5 border rounded text-[9px] truncate flex-1 ${
            subjectIsSystem
              ? 'bg-violet-50 border-violet-200 text-violet-600'
              : 'bg-zinc-100 border-zinc-200 text-zinc-500'
          }`}
        >
          {subjectIsSystem ? '⚙ ' : ''}{subjectLabel}
        </span>
        {query.stale && (
          <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded border border-amber-300">stale</span>
        )}
        {retrieved > 0 && !searchError && (
          <span
            className="text-[9px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded border border-teal-200"
            title={totalAvailable !== null ? `${totalAvailable.toLocaleString()} records match this query across OpenAlex and PubMed` : undefined}
          >
            {retrieved}{totalAvailable !== null ? ` / ${totalAvailable.toLocaleString()}` : ''} retrieved
          </span>
        )}
        {searchError && (
          <span title={searchError} className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded border border-red-200">error</span>
        )}
        {sourceWarning && !searchError && (
          <span title={sourceWarning} className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200">
            partial source failure
          </span>
        )}
      </div>

      {/* Query text */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        className="w-full bg-zinc-50 border border-zinc-300 rounded text-[10px] text-zinc-800 p-1.5 resize-none focus:outline-none focus:border-zinc-500 font-mono"
      />
      {text.trim() !== query.text.trim() && (
        <div className="flex items-center gap-2">
          <input
            value={editJustification}
            onChange={e => setEditJustification(e.target.value)}
            placeholder="Why did you change this query? (optional)"
            className="flex-1 h-7 border border-blue-200 bg-blue-50/40 rounded px-2 text-[10px] text-zinc-700 outline-none focus:border-blue-400"
          />
          <button
            onClick={saveQueryEdit}
            className="px-2.5 h-7 bg-blue-600 text-white rounded text-[10px] font-semibold hover:bg-blue-700"
          >
            Save edit
          </button>
        </div>
      )}

      {/* Where this query searches beyond the databases */}
      <label
        title={webAlreadySelected
          ? 'Web & documentation is on for every query in the database picker above'
          : 'Also search the open web for documentation, white papers, regulatory filings and reports. These are grey literature — not peer-reviewed — and are counted separately from database records.'}
        className={`flex items-center gap-1.5 text-[9px] ${webAlreadySelected ? 'text-zinc-400' : 'text-zinc-500 cursor-pointer'}`}
      >
        <input
          type="checkbox"
          checked={includeWeb || webAlreadySelected}
          disabled={webAlreadySelected}
          onChange={e => setIncludeWeb(e.target.checked)}
          className="w-3 h-3 accent-amber-600"
        />
        <span>
          + web &amp; documentation
          <span className="text-zinc-400"> (grey literature)</span>
        </span>
        {subjectIsSystem && !webAlreadySelected && (
          <span className="text-amber-600" title="A system's evidence is often only on its own site, so this is on by default for system queries">
            · on by default for systems
          </span>
        )}
      </label>

      {/* Actions row */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => { textareaRef.current?.focus(); textareaRef.current?.select() }}
          className="text-[10px] text-zinc-400 hover:text-zinc-700"
        >
          Edit
        </button>
        <button onClick={duplicateQuery} className="text-[10px] text-zinc-400 hover:text-zinc-700">
          Duplicate
        </button>
        <button onClick={deleteQuery} className="text-[10px] text-red-400 hover:text-red-600">
          Delete
        </button>
        <div className="flex-1" />
        <span className="text-[9px] text-zinc-400" title={sourceWarning || 'Literature databases searched for the latest request'}>
          Searches {searchedSources.length ? searchedSources.join(' · ') : 'not completed'}
        </span>
        {hasMore && !searching && (
          <button
            onClick={handleLoadMore}
            title="Fetch the next page of results for this query"
            className="px-2.5 h-[26px] border border-zinc-300 rounded text-[10px] font-semibold text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            Load more
          </button>
        )}
        <button
          onClick={handleSearch}
          disabled={searching || !text.trim()}
          className="flex items-center gap-1.5 px-3 h-[26px] bg-zinc-900 text-white rounded text-[10px] font-semibold hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {searching
            ? <span className="w-3 h-3 border-2 border-zinc-500 border-t-white rounded-full animate-spin" />
            : <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="5" cy="5" r="3.5" stroke="white" strokeWidth="1.5"/><path d="M8 8l2 2" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
          }
          {searching ? 'Searching…' : retrieved > 0 ? 'Search again' : 'Search'}
        </button>
      </div>
    </div>
  )
}

// ── Search filter bar ─────────────────────────────────────────────────────────
// Narrowing applied at the database, before anything reaches screening. Kept in
// the store so it survives reloads and is reported alongside the search record.

const LANGUAGES: { code: string; label: string }[] = [
  { code: '',   label: 'Any language' },
  { code: 'en', label: 'English' },
  { code: 'zh', label: 'Chinese' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'es', label: 'Spanish' },
  { code: 'ja', label: 'Japanese' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
]

/**
 * Which databases every search runs against.
 *
 * PRISMA 2020 requires reporting the databases searched, and this tool shipped
 * with two, both biomedical-leaning — a review in education or engineering was
 * searching a corpus that could not answer it and had no way to say so. The
 * list comes from the backend rather than being written here, so a database
 * added there appears without a frontend change.
 */
function SourcePicker() {
  const { state, dispatch } = useApp()
  const [sources, setSources] = useState<SearchSource[]>([])
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch(`${API}/search/sources`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((data: SearchSource[]) => { if (!cancelled) setSources(data) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [])

  const selected = new Set(state.searchSources)
  const chosen = sources.filter(s => selected.has(s.key))
  const label = chosen.length > 0
    ? chosen.map(s => s.name).join(' · ')
    : state.searchSources.join(' · ')

  function toggle(key: string) {
    const next = selected.has(key)
      ? state.searchSources.filter(k => k !== key)
      : [...state.searchSources, key]
    dispatch({ type: 'SET_SEARCH_SOURCES', sources: next })
  }

  // The limits in force, so the picker can say where each one will not hold.
  const limitsInForce = new Set<string>()
  if (state.searchFilters.openAccessOnly) limitsInForce.add('open access only')
  if (state.searchFilters.language) limitsInForce.add('language')

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        title="Choose which literature databases every search runs against"
        className="h-5 flex items-center gap-1 border border-zinc-300 rounded px-1.5 text-[10px] text-zinc-700 bg-white hover:border-zinc-500"
      >
        <span className="text-zinc-400">Databases</span>
        <span className="font-medium max-w-[220px] truncate">{label || 'none'}</span>
        <span className="text-zinc-400">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 top-6 left-0 w-[320px] bg-white border border-zinc-200 rounded-lg shadow-xl p-2">
            {failed && <p className="text-[10px] text-red-500 px-1 py-2">Could not reach the backend for the database list.</p>}
            {sources.map(source => {
              const unapplied = source.unsupportedLimits.filter(l => limitsInForce.has(l))
              const isLast = selected.has(source.key) && state.searchSources.length === 1
              return (
                <label
                  key={source.key}
                  title={isLast ? 'At least one database must stay selected' : undefined}
                  className={`flex items-start gap-2 px-1.5 py-1.5 rounded ${isLast ? 'opacity-60' : 'hover:bg-zinc-50 cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(source.key)}
                    disabled={isLast}
                    onChange={() => toggle(source.key)}
                    className="mt-0.5 w-3 h-3 accent-zinc-900"
                  />
                  <span className="min-w-0">
                    <span className="text-[11px] font-medium text-zinc-800">{source.name}</span>
                    <span className="block text-[9px] text-zinc-400 leading-tight">{source.blurb}</span>
                    {unapplied.length > 0 && (
                      <span className="block text-[9px] text-amber-700 leading-tight">
                        Cannot apply your {unapplied.join(' or ')} limit — records that miss it may come back from here.
                      </span>
                    )}
                    {source.greyLiterature ? (
                      <span className="block text-[9px] text-amber-700 leading-tight">
                        Not peer-reviewed literature. What it finds is screened like anything else, but is
                        reported on PRISMA's websites/organisations pathway rather than counted as database records.
                      </span>
                    ) : source.comparableHits === false && (
                      <span className="block text-[9px] text-amber-700 leading-tight">
                        Ranks by relevance on each term, so its hit count is not a record count and is left out of the identification total. The papers it finds are still screened.
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
            <p className="text-[9px] text-zinc-400 px-1.5 pt-1.5 border-t border-zinc-100 mt-1">
              Every database searched is recorded per query and reported in the search-strategy appendix.
              For databases with no free API — Scopus, Web of Science, Embase — search there and use ⬆ Import on the next step.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function SearchFilterBar() {
  const { state, dispatch } = useApp()
  const f = state.searchFilters

  function update(patch: Partial<SearchFilters>) {
    dispatch({ type: 'SET_SEARCH_FILTERS', filters: { ...f, ...patch } })
  }

  function parseYear(raw: string): number | null {
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n >= 1000 && n <= 9999 ? n : null
  }

  const active =
    f.yearFrom !== null || f.yearTo !== null ||
    f.openAccessOnly || f.excludePreprints || f.language !== ''

  return (
    <div className="border-b border-zinc-200 bg-zinc-50 px-2 py-1.5 flex items-center gap-2 flex-wrap shrink-0">
      <SourcePicker />

      <span
        className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide"
        title="Limits are applied by each database before papers are returned. A database that cannot express one is marked in the database picker."
      >
        Search limits
      </span>

      <div className="flex items-center gap-1">
        <span className="text-[9px] text-zinc-500">Publication year</span>
        <input
          type="number"
          value={f.yearFrom ?? ''}
          onChange={e => update({ yearFrom: parseYear(e.target.value) })}
          placeholder="From"
          aria-label="Earliest publication year"
          title="Earliest publication year to include"
          className="w-[58px] h-5 border border-zinc-300 rounded px-1 text-[10px] text-zinc-700 bg-white focus:outline-none focus:border-zinc-500"
        />
        <span className="text-[10px] text-zinc-400">–</span>
        <input
          type="number"
          value={f.yearTo ?? ''}
          onChange={e => update({ yearTo: parseYear(e.target.value) })}
          placeholder="To"
          aria-label="Latest publication year"
          title="Latest publication year to include"
          className="w-[58px] h-5 border border-zinc-300 rounded px-1 text-[10px] text-zinc-700 bg-white focus:outline-none focus:border-zinc-500"
        />
      </div>

      <select
        value={f.language}
        onChange={e => update({ language: e.target.value })}
        className="h-5 border border-zinc-300 rounded px-1 text-[10px] text-zinc-700 bg-white focus:outline-none focus:border-zinc-500"
      >
        {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>

      <label className="flex items-center gap-1 text-[10px] text-zinc-600 cursor-pointer" title="Only papers with a free full-text version">
        <input
          type="checkbox"
          checked={f.openAccessOnly}
          onChange={e => update({ openAccessOnly: e.target.checked })}
          className="w-3 h-3 accent-zinc-900"
        />
        Open access
      </label>

      <label className="flex items-center gap-1 text-[10px] text-zinc-600 cursor-pointer" title="Drop preprints, which have not been peer-reviewed">
        <input
          type="checkbox"
          checked={f.excludePreprints}
          onChange={e => update({ excludePreprints: e.target.checked })}
          className="w-3 h-3 accent-zinc-900"
        />
        No preprints
      </label>

      {active && (
        <button
          onClick={() => update({ yearFrom: null, yearTo: null, openAccessOnly: false, excludePreprints: false, language: '' })}
          className="text-[9px] text-red-400 hover:text-red-600"
        >
          ✕ clear
        </button>
      )}
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
  onRescore,
}: {
  result: ResultCard
  selected: boolean
  anySelected: boolean
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onRescore: (paper: ResultCard) => void
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
        {/* Relevance: the bar once assessed, otherwise the assessment's state.
            A failed assessment says so and offers a retry — previously it was
            indistinguishable from a paper scored 0%. */}
        {result.scoreStatus === 'failed' ? (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[9px] text-red-500">assessment failed</span>
            <button
              onClick={() => onRescore(result)}
              className="text-[9px] text-blue-500 hover:text-blue-700 underline"
            >
              retry
            </button>
          </div>
        ) : result.scoreStatus === 'pending' ? (
          <div className="flex items-center gap-1 mt-1">
            <span className="w-2 h-2 border border-zinc-300 border-t-purple-500 rounded-full animate-spin" />
            <span className="text-[9px] text-zinc-400">assessing…</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 mt-1">
            <div className="flex-1 h-1 bg-zinc-100 rounded overflow-hidden">
              <div className={`h-full rounded ${barColor}`} style={{ width: `${score}%` }} />
            </div>
            <span className="text-[9px] text-zinc-400 shrink-0">{score}%</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Screen3 ──────────────────────────────────────────────────────────────
export function Screen3() {
  const { state, dispatch } = useApp()
  const [leftTab, setLeftTab] = useState<'topics' | 'systems'>('topics')
  const [isLinking, setIsLinking] = useState(false)
  // One automatic mapping pass per mount, once both sides exist. Re-running it
  // is a button, not a side effect: the links are the user's to keep once drawn.
  const autoLinkedRef = useRef(false)
  const [showAddTopic, setShowAddTopic] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [queriesGenerated, setQueriesGenerated] = useState(state.queries.length > 0)
  const [selectedResultIds, setSelectedResultIds] = useState<Set<string>>(new Set())
  const [showRegenModal, setShowRegenModal] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [customRegenPrompt, setCustomRegenPrompt] = useState<string | null>(null)
  const [customConfirmPrompt, setCustomConfirmPrompt] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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
  function rescore(paper: ResultCard) {
    dispatch({ type: 'SET_RESULT_SCORE_STATUS', paperId: paper.id, status: 'pending' })
    void scorePaperRelevance(paper, state.profile, dispatch)
  }

  const selectedTopics = state.topics.filter(t => t.selected)
  const selectedSystems = (state.systemItems ?? []).filter(s => s.selected)
  // A selected system is a search subject like a topic is: the queries it
  // generates are what put the system's evaluations, documentation and vendor
  // pages into the same screened pool as everything else.
  const systemTopics = selectedSystems.map(s => ({
    id: s.id,
    title: s.name,
    description: [
      s.vendor ? `${s.name} (${s.vendor}).` : `${s.name}.`,
      s.description,
      'Find published evaluations, validation studies, implementation reports and official documentation of this system.',
    ].filter(Boolean).join(' '),
    tags: ['system', s.category].filter(Boolean),
  }))
  const searchSubjectIds = [...selectedTopics.map(t => t.id), ...selectedSystems.map(s => s.id)]
  const linkCount = (state.systemTopicLinks ?? []).length
  const visibleQueries = state.queries.filter(q => searchSubjectIds.includes(q.topicId))
  // Derived rather than counted, so re-running a search cannot inflate it.
  const dupCount = duplicatesRemoved(state.screening, state.results.filter(r => (r.origin ?? 'search') === 'search').length)

  function addManualQuery() {
    const subjectId = searchSubjectIds[0]
    if (!subjectId) {
      setActionError('Select at least one topic or system before adding a query.')
      return
    }
    const queryN = Math.max(0, ...state.queries.map(query => query.queryN)) + 1
    dispatch({
      type: 'SET_QUERIES',
      queries: [
        ...state.queries,
        {
          id: `query-manual-${state.sessionId}-${queryN}`,
          queryN,
          topicId: subjectId,
          text: '',
          qualityScore: 0,
          priority: 'med',
          databases: [],
          resultCount: 0,
          stale: false,
        },
      ],
    })
    setActionError(null)
    setQueriesGenerated(true)
  }

  async function handleRegenerate(prompt?: string | null) {
    if (isRegenerating) return
    setIsRegenerating(true)
    setActionError(null)
    try {
      const res = await apiFetch(`${API}/topics/generate-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...state.profile, custom_system_prompt: prompt ?? null }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `Topic generation failed (HTTP ${res.status})`)
      }
      const data = await res.json()
      if (!data.topics?.length) throw new Error('Topic generation returned no topics.')
      dispatch({ type: 'SET_TOPICS', topics: data.topics })
      setQueriesGenerated(false)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Topic generation failed.')
    } finally {
      setIsRegenerating(false)
    }
  }

  /**
   * Work out which systems bear on which topics.
   *
   * Both lists are sent, not just the selected ones: the point of the mapping
   * is to help decide what to select, which it cannot do if it only describes
   * what is already selected.
   */
  async function handleLinkTopicsSystems() {
    if (isLinking) return
    const systems = state.systemItems ?? []
    if (state.topics.length === 0 || systems.length === 0) {
      setActionError('Add at least one topic and one system before mapping them.')
      return
    }
    setIsLinking(true)
    setActionError(null)
    try {
      const res = await apiFetch(`${API}/systems/link-topics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topics: state.topics.map(t => ({ id: t.id, title: t.title, description: t.description, tags: t.tags })),
          systems: systems.map(sys => ({
            id: sys.id, name: sys.name, description: sys.description,
            category: sys.category, vendor: sys.vendor,
          })),
          domain: state.profile.domain,
          population: state.profile.population,
          focus: state.profile.focus,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `Topic–system mapping failed (HTTP ${res.status})`)
      }
      const data = await res.json()
      dispatch({ type: 'SET_SYSTEM_TOPIC_LINKS', links: data.links ?? [] })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Topic–system mapping failed.')
    } finally {
      setIsLinking(false)
    }
  }

  useEffect(() => {
    if (autoLinkedRef.current) return
    if ((state.systemTopicLinks ?? []).length > 0) return
    if (state.topics.length === 0 || (state.systemItems ?? []).length === 0) return
    autoLinkedRef.current = true
    // Kicked off after the render rather than during it, and deliberately not
    // cancelled on cleanup: the ref makes it once-only, so cancelling would
    // mean it never ran at all under React's double-invoked dev effects.
    setTimeout(() => { void handleLinkTopicsSystems() }, 0)
    // Keyed on the two lists becoming non-empty; a failure does not retry on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.topics.length, (state.systemItems ?? []).length])

  async function handleConfirm(prompt?: string | null) {
    if (isConfirming || searchSubjectIds.length === 0) return
    setIsConfirming(true)
    setActionError(null)
    try {
      const res = await apiFetch(`${API}/queries/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topics: [
            ...selectedTopics.map(t => ({ id: t.id, title: t.title, description: t.description, tags: t.tags })),
            ...systemTopics,
          ],
          profile: state.profile,
          custom_system_prompt: prompt ?? null,
          // A query for PubMed's MeSH syntax is not the query for a
          // relevance-ranked index, so the librarian is told what it writes for.
          sources: state.searchSources,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail || `Query generation failed (HTTP ${res.status})`)
      }
      const data = await res.json()
      if (!data.queries?.length) throw new Error('Query generation returned no queries.')
      dispatch({ type: 'SET_QUERIES', queries: data.queries })
      setQueriesGenerated(true)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Query generation failed.')
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {actionError && (
        <div className="h-8 shrink-0 flex items-center gap-2 px-3 bg-red-50 border-b border-red-200 text-[10px] text-red-700">
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-500 hover:text-red-800">Dismiss</button>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">

        {/* Left — Topics / Systems */}
        <div className="flex-1 flex flex-col border-r border-zinc-200 overflow-hidden">
          {/* Tab bar — the systems under review are chosen here, alongside the
              topics, because both feed the same query generation below. */}
          <div data-review-allow className="h-[30px] bg-zinc-900 flex items-stretch shrink-0">
            <button
              onClick={() => setLeftTab('topics')}
              className={`px-3 text-[10px] font-bold tracking-wider border-b-2 transition-colors ${
                leftTab === 'topics' ? 'text-white border-blue-500' : 'text-zinc-500 border-transparent hover:text-zinc-200'
              }`}
            >
              TOPICS
              <span className="ml-1.5 font-normal text-[9px] text-zinc-400">{selectedTopics.length}/{state.topics.length}</span>
            </button>
            <button
              onClick={() => setLeftTab('systems')}
              title="Systems reviewed alongside the literature — selecting one adds it to the searches below"
              className={`px-3 text-[10px] font-bold tracking-wider border-b-2 transition-colors ${
                leftTab === 'systems' ? 'text-white border-violet-500' : 'text-zinc-500 border-transparent hover:text-zinc-200'
              }`}
            >
              SYSTEMS
              <span className="ml-1.5 font-normal text-[9px] text-zinc-400">
                {selectedSystems.length}/{(state.systemItems ?? []).length}
              </span>
            </button>
            <div className="flex-1" />
          </div>

          {/* Action row for the active tab */}
          <div className="h-[28px] bg-zinc-800 flex items-center px-2 gap-2 shrink-0">
            {leftTab === 'topics' ? (
              <>
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
              </>
            ) : (
              <span className="text-[9px] text-zinc-400 truncate">
                Selected systems are searched like topics — their evaluations and documentation land in the same paper pool.
              </span>
            )}
            <div className="flex-1" />
            {/* Which systems bear on which topics — drawn as chips on both tabs */}
            <button
              onClick={handleLinkTopicsSystems}
              disabled={isLinking || state.topics.length === 0 || (state.systemItems ?? []).length === 0}
              title="Work out which systems bear on which topics, and show the links on both tabs"
              className="flex items-center gap-1 px-2 h-[20px] rounded bg-zinc-700 text-zinc-200 text-[9px] hover:bg-zinc-600 disabled:opacity-40 transition-colors"
            >
              {isLinking
                ? <span className="w-2.5 h-2.5 border border-zinc-400 border-t-white rounded-full animate-spin" />
                : <span>↔</span>}
              {isLinking ? 'Mapping…' : linkCount > 0 ? `Links (${linkCount})` : 'Map links'}
            </button>
            <button
              onClick={() => handleConfirm(customConfirmPrompt)}
              disabled={isConfirming || searchSubjectIds.length === 0}
              title="Generate the database queries for every selected topic and system"
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
              disabled={isConfirming || searchSubjectIds.length === 0}
              title="Customize AI prompt"
              className="flex items-center justify-center w-[18px] h-[18px] rounded bg-blue-600 text-blue-200 text-[9px] hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              ⚙
            </button>
          </div>

          {leftTab === 'topics' ? (
            <div className="flex-1 overflow-y-auto p-2">
              {showAddTopic && <AddTopicForm onClose={() => setShowAddTopic(false)} />}
              {state.topics.map(topic => (
                <TopicCardItem key={topic.id} topic={topic} />
              ))}
            </div>
          ) : (
            <div className="flex-1 min-h-0">
              <SystemsPanel />
            </div>
          )}
        </div>

        {/* Centre — Query Editor */}
        <div className="flex-1 flex flex-col border-r border-zinc-200 overflow-hidden">
          <div className="h-[30px] bg-zinc-900 flex items-center px-3 gap-2 shrink-0">
            <span className="text-white text-[10px] font-bold tracking-wider flex-1">QUERIES</span>
            <button onClick={addManualQuery} className="text-zinc-300 text-[9px] hover:text-white">+ Add</button>
            <button
              onClick={() => handleConfirm(customConfirmPrompt)}
              disabled={isConfirming || selectedTopics.length === 0}
              className="text-zinc-300 text-[9px] hover:text-white disabled:opacity-40"
            >
              ↺ Regen All
            </button>
          </div>
          <SearchFilterBar />
          <div className="flex-1 overflow-y-auto p-2">
            {visibleQueries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <p className="text-[11px] text-zinc-400 italic">
                  {searchSubjectIds.length === 0
                    ? 'Select topics or systems on the left to generate queries.'
                    : 'Click Confirm on the left to generate search queries.'}
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
            {dupCount > 0 && (
              <span
                className="text-amber-300 text-[9px]"
                title="Papers already retrieved by an earlier query, matched by DOI or title and kept only once"
              >
                {dupCount} dup removed
              </span>
            )}
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
                  onRescore={rescore}
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
