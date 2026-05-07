import { useState, useEffect } from 'react'
import { useApp } from '../store/AppContext'
import type { SystemItem } from '../types'

const API = 'http://localhost:8000/api'

const CATEGORY_LABELS: Record<string, string> = {
  clinical_system:  'Clinical System',
  ai_platform:      'AI Platform',
  decision_support: 'Decision Support',
  health_platform:  'Health Platform',
  research_tool:    'Research Tool',
  other:            'Other',
}

const CATEGORY_COLORS: Record<string, string> = {
  clinical_system:  'bg-blue-100 text-blue-700',
  ai_platform:      'bg-violet-100 text-violet-700',
  decision_support: 'bg-teal-100 text-teal-700',
  health_platform:  'bg-green-100 text-green-700',
  research_tool:    'bg-amber-100 text-amber-700',
  other:            'bg-zinc-100 text-zinc-600',
}

// ── System card ───────────────────────────────────────────────────────────────
function SystemCard({ item }: { item: SystemItem }) {
  const { dispatch } = useApp()

  return (
    <div
      onClick={() => dispatch({ type: 'TOGGLE_SYSTEM_ITEM', itemId: item.id })}
      className={`relative rounded-lg border cursor-pointer p-3 flex flex-col gap-2 transition-colors ${
        item.selected
          ? 'border-2 border-blue-500 bg-blue-50/40'
          : 'border border-zinc-200 bg-white hover:bg-zinc-50'
      }`}
    >
      {/* Checkbox */}
      <div className={`absolute top-3 right-3 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
        item.selected ? 'bg-blue-500 border-blue-500' : 'border-zinc-300 bg-white'
      }`}>
        {item.selected && <span className="text-white text-[9px] leading-none">✓</span>}
      </div>

      {/* Header row */}
      <div className="flex items-start gap-2 pr-6">
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-zinc-900 leading-tight">{item.name}</p>
          {item.vendor && (
            <p className="text-[10px] text-zinc-400 mt-0.5">{item.vendor}</p>
          )}
        </div>
      </div>

      {/* Category badge */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-2 py-0.5 rounded-full text-[9px] font-semibold ${CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.other}`}>
          {CATEGORY_LABELS[item.category] ?? item.category}
        </span>
        {item.aiGenerated && (
          <span className="px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded text-[8px] font-semibold">AI</span>
        )}
        {!item.aiGenerated && (
          <span className="px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded text-[8px] font-semibold">Manual</span>
        )}
      </div>

      {/* Description */}
      {item.description && (
        <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-3">{item.description}</p>
      )}

      {/* URL */}
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="text-[10px] text-blue-500 hover:underline truncate"
        >
          ↗ {item.url.replace(/^https?:\/\//, '')}
        </a>
      )}
    </div>
  )
}

// ── Add custom system form ────────────────────────────────────────────────────
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
    <div className="flex gap-2 items-center">
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
        placeholder="Add a system by name (e.g. Epic, IBM Watson Health)"
        className="flex-1 h-9 bg-white border border-zinc-300 rounded-lg px-3 text-[12px] text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-500"
      />
      <button
        onClick={handleAdd}
        disabled={!input.trim()}
        className="px-4 h-9 bg-zinc-800 text-white rounded-lg text-[12px] font-medium hover:bg-zinc-700 disabled:opacity-40 transition-colors shrink-0"
      >
        + Add
      </button>
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-zinc-200 bg-white p-3 flex flex-col gap-2 animate-pulse">
          <div className="h-4 bg-zinc-200 rounded w-3/4" />
          <div className="h-3 bg-zinc-100 rounded w-1/2" />
          <div className="h-3 bg-zinc-100 rounded w-1/3" />
          <div className="h-8 bg-zinc-100 rounded w-full" />
          <div className="h-8 bg-zinc-100 rounded w-full" />
        </div>
      ))}
    </div>
  )
}

// ── Main Screen2 ──────────────────────────────────────────────────────────────
export function Screen2() {
  const { state, dispatch } = useApp()
  const systemItems: SystemItem[] = state.systemItems ?? []
  const [isLoading, setIsLoading] = useState(systemItems.length === 0)
  const [error, setError] = useState(false)

  const selectedTopics = state.topics.filter(t => t.selected)
  const selectedCount = systemItems.filter(s => s.selected).length

  useEffect(() => {
    if (systemItems.length > 0) return
    fetchRecommendations()
  }, [])

  async function fetchRecommendations() {
    setIsLoading(true)
    setError(false)
    try {
      const res = await fetch(`${API}/systems/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: state.profile.domain,
          population: state.profile.population,
          focus: state.profile.focus,
          method: state.profile.method,
          reviewType: state.profile.reviewType,
          topics: selectedTopics.map(t => ({ title: t.title, description: t.description })),
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      const items = (data.systems as { id: string; name: string; description: string; category: string; url: string | null; vendor: string }[]).map(s => ({
        ...s,
        aiGenerated: true,
        selected: true,
      }))
      dispatch({ type: 'SET_SYSTEM_ITEMS', items })
    } catch {
      setError(true)
    } finally {
      setIsLoading(false)
    }
  }

  function handleSkip() {
    dispatch({ type: 'ADVANCE_STEP' })
  }

  function handleContinue() {
    dispatch({ type: 'ADVANCE_STEP' })
  }

  const aiItems = systemItems.filter(s => s.aiGenerated)
  const customItems = systemItems.filter(s => !s.aiGenerated)

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="h-[44px] bg-zinc-50 border-b border-zinc-200 flex items-center px-4 gap-3 shrink-0">
        <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center text-white text-[11px] shrink-0">
          ✦
        </div>
        <div className="flex flex-col">
          <span className="text-[13px] font-bold text-zinc-900 leading-tight">System Review</span>
          <span className="text-[10px] text-zinc-500 leading-tight">
            AI-recommended systems related to your topic — select those to include in your review
          </span>
        </div>
        <div className="flex-1" />
        {!isLoading && !error && (
          <button
            onClick={fetchRecommendations}
            className="flex items-center gap-1.5 px-3 h-7 border border-zinc-300 rounded text-[11px] text-zinc-600 hover:bg-zinc-100 transition-colors"
          >
            ↺ Refresh
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

        {isLoading ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
              <span className="text-[12px] text-zinc-500">Searching for relevant systems…</span>
            </div>
            <LoadingSkeleton />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <p className="text-[13px] text-zinc-500">Could not load recommendations.</p>
            <button
              onClick={fetchRecommendations}
              className="px-4 h-8 bg-zinc-900 text-white rounded text-[12px] font-medium hover:bg-zinc-700"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {/* AI recommended section */}
            {aiItems.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">AI Recommended</span>
                  <span className="px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded text-[8px] font-semibold">
                    {aiItems.filter(s => s.selected).length} / {aiItems.length} selected
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                  {aiItems.map(item => (
                    <SystemCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Custom systems section */}
            {customItems.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Added by You</span>
                </div>
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                  {customItems.map(item => (
                    <SystemCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Add custom system */}
        {!isLoading && (
          <div className="pt-1">
            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest mb-2">Add your own system</p>
            <AddCustomSystem />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="h-[52px] border-t border-zinc-200 bg-white flex items-center justify-between px-4 shrink-0">
        <button
          onClick={handleSkip}
          className="px-4 h-9 border border-zinc-300 rounded text-[12px] text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 transition-colors"
        >
          Skip this step
        </button>

        <div className="flex items-center gap-3">
          {selectedCount > 0 && (
            <span className="text-[11px] text-zinc-500">
              {selectedCount} system{selectedCount !== 1 ? 's' : ''} selected
            </span>
          )}
          <button
            onClick={handleContinue}
            disabled={isLoading}
            className="px-5 h-9 bg-zinc-900 text-white rounded text-[12px] font-semibold hover:bg-zinc-700 disabled:opacity-50 transition-colors"
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  )
}
