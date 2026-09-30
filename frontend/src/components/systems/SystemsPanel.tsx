import { useEffect, useState } from 'react'
import { useApp } from '../../store/AppContext'
import type { SystemItem } from '../../types'
import { API, apiFetch } from '../../lib/api'
import { newId } from '../../lib/ids'
import { LinkChips, type LinkChipItem } from '../shared/LinkChips'

/**
 * System review, as a tab of the search step.
 *
 * The systems a review appraises are chosen the same way its topics are, and
 * for the same reason: what comes next is a set of database queries. Selecting
 * a system here adds it to the query generation alongside the topics, so the
 * evidence about a system is the published literature and its own documentation
 * — found by a search that is recorded like any other — rather than whatever a
 * language model recalls about it.
 */

const CATEGORY_LABELS: Record<string, string> = {
  clinical_system: 'Clinical System',
  ai_platform: 'AI Platform',
  decision_support: 'Decision Support',
  health_platform: 'Health Platform',
  research_tool: 'Research Tool',
  other: 'Other',
}

const CATEGORY_COLORS: Record<string, string> = {
  clinical_system: 'bg-blue-100 text-blue-700',
  ai_platform: 'bg-violet-100 text-violet-700',
  decision_support: 'bg-teal-100 text-teal-700',
  health_platform: 'bg-green-100 text-green-700',
  research_tool: 'bg-amber-100 text-amber-700',
  other: 'bg-zinc-100 text-zinc-600',
}

type ApiSystem = {
  id: string
  name: string
  description: string
  category: string
  url: string | null
  vendor: string
}

function SystemCard({ item }: { item: SystemItem }) {
  const { state, dispatch } = useApp()

  const linkedTopics: LinkChipItem[] = (state.systemTopicLinks ?? [])
    .filter(link => link.systemId === item.id)
    .flatMap(link => {
      const topic = state.topics.find(t => t.id === link.topicId)
      return topic
        ? [{ id: topic.id, label: topic.title, strength: link.strength, reason: link.reason }]
        : []
    })

  return (
    <div
      onClick={() => dispatch({ type: 'TOGGLE_SYSTEM_ITEM', itemId: item.id })}
      className={`relative rounded-lg cursor-pointer p-2 mb-2 flex flex-col gap-1.5 transition-colors ${
        item.selected
          ? 'border-2 border-violet-500 border-t-[5px] bg-violet-50/30'
          : 'border border-zinc-200 bg-white hover:bg-zinc-50'
      }`}
    >
      <div className={`absolute top-2 right-2 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
        item.selected ? 'bg-violet-500 border-violet-500' : 'border-zinc-300 bg-white'
      }`}>
        {item.selected && <span className="text-white text-[9px] leading-none">✓</span>}
      </div>

      <div className="pr-6">
        <p className="text-[11px] font-semibold text-zinc-900 leading-tight">{item.name}</p>
        {item.vendor && <p className="text-[9px] text-zinc-400 mt-0.5">{item.vendor}</p>}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`px-2 py-0.5 rounded-full text-[9px] font-semibold ${CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.other}`}>
          {CATEGORY_LABELS[item.category] ?? item.category}
        </span>
        <span className={`px-1.5 py-0.5 rounded text-[8px] font-semibold ${
          item.aiGenerated ? 'bg-purple-100 text-purple-600' : 'bg-zinc-100 text-zinc-500'
        }`}>
          {item.aiGenerated ? 'AI' : 'Manual'}
        </span>
      </div>

      {item.description && (
        <p className="text-[10px] text-zinc-500 leading-relaxed line-clamp-3">{item.description}</p>
      )}

      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="text-[9px] text-blue-500 hover:underline truncate"
        >
          ↗ {item.url.replace(/^https?:\/\//, '')}
        </a>
      )}

      {/* Topics this system bears on */}
      <LinkChips
        items={linkedTopics}
        heading="Related topics"
        tone="blue"
        emptyHint="No topic linked — use ↔ Map links above"
      />
    </div>
  )
}

function AddCustomSystem() {
  const { dispatch } = useApp()
  const [input, setInput] = useState('')

  function handleAdd() {
    const name = input.trim()
    if (!name) return
    dispatch({ type: 'ADD_CUSTOM_SYSTEM', name })
    setInput('')
  }

  return (
    <div className="flex gap-1.5 items-center">
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
        placeholder="Add a system by name"
        className="flex-1 h-7 bg-white border border-zinc-300 rounded px-2 text-[10px] text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-500"
      />
      <button
        onClick={handleAdd}
        disabled={!input.trim()}
        className="px-2.5 h-7 bg-zinc-800 text-white rounded text-[10px] font-medium hover:bg-zinc-700 disabled:opacity-40 transition-colors shrink-0"
      >
        + Add
      </button>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-zinc-200 bg-white p-2 mb-2 flex flex-col gap-2 animate-pulse">
          <div className="h-3 bg-zinc-200 rounded w-3/4" />
          <div className="h-2 bg-zinc-100 rounded w-1/2" />
          <div className="h-6 bg-zinc-100 rounded w-full" />
        </div>
      ))}
    </>
  )
}

export function SystemsPanel() {
  const { state, dispatch } = useApp()
  const systemItems: SystemItem[] = state.systemItems ?? []
  const [isLoading, setIsLoading] = useState(false)
  const [addingMore, setAddingMore] = useState(false)
  const [error, setError] = useState(false)

  const selectedTopics = state.topics.filter(t => t.selected)

  useEffect(() => {
    if (systemItems.length > 0) return
    void fetchRecommendations()
    // Initial load only; the buttons below call the same functions by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function requestBody(excludeSystems?: string[]) {
    return JSON.stringify({
      domain: state.profile.domain,
      population: state.profile.population,
      focus: state.profile.focus,
      method: state.profile.method,
      reviewType: state.profile.reviewType,
      topics: selectedTopics.map(t => ({ title: t.title, description: t.description })),
      ...(excludeSystems ? { exclude_systems: excludeSystems } : {}),
    })
  }

  async function fetchRecommendations() {
    setIsLoading(true)
    setError(false)
    try {
      const res = await apiFetch(`${API}/systems/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody(),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      const items = (data.systems as ApiSystem[]).map(s => ({ ...s, aiGenerated: true, selected: true }))
      dispatch({ type: 'SET_SYSTEM_ITEMS', items })
    } catch {
      setError(true)
    } finally {
      setIsLoading(false)
    }
  }

  // Keep what the user selected (and anything they added by hand), tell the
  // model which systems it already gave us, and replace the untouched
  // suggestions with fresh ones.
  async function addMore() {
    setAddingMore(true)
    setError(false)
    try {
      const kept = systemItems.filter(s => s.selected || !s.aiGenerated)
      const res = await apiFetch(`${API}/systems/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody(systemItems.filter(s => s.selected).map(s => s.name)),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      const keptNames = new Set(kept.map(k => k.name.toLowerCase().trim()))
      const newItems = (data.systems as ApiSystem[])
        .filter(s => !keptNames.has(s.name.toLowerCase().trim()))
        .map(s => ({ ...s, id: newId('sys-more'), aiGenerated: true, selected: false }))
      dispatch({ type: 'SET_SYSTEM_ITEMS', items: [...kept, ...newItems] })
    } catch {
      setError(true)
    } finally {
      setAddingMore(false)
    }
  }

  const aiItems = systemItems.filter(s => s.aiGenerated)
  const customItems = systemItems.filter(s => !s.aiGenerated)

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-zinc-500">Searching for relevant systems…</span>
            </div>
            <LoadingSkeleton />
          </>
        ) : error && systemItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <p className="text-[11px] text-zinc-500">Could not load recommendations.</p>
            <button
              onClick={fetchRecommendations}
              className="px-3 h-7 bg-zinc-900 text-white rounded text-[11px] font-medium hover:bg-zinc-700"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {error && (
              <p className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700">
                Could not reach the recommendation service. What is listed below is unchanged.
              </p>
            )}
            {aiItems.length > 0 && (
              <>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">AI Recommended</span>
                  <span className="px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded text-[8px] font-semibold">
                    {aiItems.filter(s => s.selected).length} / {aiItems.length} selected
                  </span>
                </div>
                {aiItems.map(item => <SystemCard key={item.id} item={item} />)}
              </>
            )}

            {customItems.length > 0 && (
              <>
                <div className="flex items-center gap-2 mb-1.5 mt-3">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Added by You</span>
                </div>
                {customItems.map(item => <SystemCard key={item.id} item={item} />)}
              </>
            )}

            {systemItems.length === 0 && (
              <p className="text-[11px] text-zinc-400 italic text-center mt-8 px-3">
                No systems yet. Generate recommendations or add one by name below.
              </p>
            )}
          </>
        )}
      </div>

      {/* Bottom toolbar: refresh suggestions, add your own */}
      <div className="border-t border-zinc-200 bg-zinc-50 px-2 py-2 shrink-0 space-y-2">
        <div className="flex gap-1.5">
          <button
            onClick={systemItems.length === 0 ? fetchRecommendations : addMore}
            disabled={isLoading || addingMore}
            className="flex items-center gap-1.5 px-2 h-7 border border-zinc-300 rounded text-[10px] text-zinc-600 bg-white hover:bg-zinc-100 disabled:opacity-50 transition-colors"
          >
            <span>↺</span>
            {systemItems.length === 0 ? 'Generate systems' : addingMore ? 'Adding…' : 'Generate more'}
          </button>
        </div>
        <AddCustomSystem />
      </div>
    </div>
  )
}
