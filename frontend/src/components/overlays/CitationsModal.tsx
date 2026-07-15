import { useState, useEffect } from 'react'
import { useApp } from '../../store/AppContext'
import { API, apiFetch } from '../../lib/api'
import type { ResultCard } from '../../types'

interface CitationPaper {
  title: string
  authors: string
  year: number | null
  url: string
  openAccessUrl: string | null
  abstract: string
}

interface Props {
  seed: { title: string; url: string; topicId: string }
  onClose: () => void
}

type Direction = 'backward' | 'forward'

const DIRECTION_LABELS: Record<Direction, { label: string; hint: string }> = {
  backward: { label: 'References', hint: 'Papers this study cites' },
  forward:  { label: 'Cited by',   hint: 'Papers that cite this study' },
}

export function CitationsModal({ seed, onClose }: Props) {
  const { state, dispatch } = useApp()
  const [direction, setDirection] = useState<Direction>('backward')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [papers, setPapers] = useState<CitationPaper[]>([])
  const [added, setAdded] = useState<Set<string>>(new Set())

  const existingTitles = new Set(state.results.map(r => r.title.toLowerCase().trim()))

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true); setError(false); setPapers([])
      try {
        const res = await apiFetch(`${API}/search/citations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: seed.url, direction, limit: 20 }),
        })
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (!cancelled) setPapers(data.papers ?? [])
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [direction, seed.url])

  function handleAdd(p: CitationPaper) {
    const card: ResultCard = {
      id: `cite-${direction}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: p.title,
      authors: p.authors,
      year: p.year ?? 0,
      source: p.url,
      relevanceScore: 0,
      abstract: p.abstract ?? '',
      topicId: seed.topicId,
      queryId: 'snowball',
      confidence: 'none',
      isDuplicate: false,
      status: null,
      notes: '',
    }
    dispatch({ type: 'ADD_SEARCH_RESULTS', results: [card] })
    setAdded(prev => new Set(prev).add(p.title.toLowerCase().trim()))
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[560px] flex flex-col"
        style={{ maxHeight: '82vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-zinc-200 shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 mr-4">
              <h2 className="text-[14px] font-bold text-zinc-950">Citation snowballing</h2>
              <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-1">{seed.title}</p>
            </div>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-[18px] leading-none shrink-0">✕</button>
          </div>

          {/* Direction toggle */}
          <div className="flex gap-1 mt-3 bg-zinc-100 p-0.5 rounded-lg w-fit">
            {(Object.keys(DIRECTION_LABELS) as Direction[]).map(d => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  direction === d ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
                }`}
              >
                {DIRECTION_LABELS[d].label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-zinc-400 mt-1.5">{DIRECTION_LABELS[direction].hint} · via OpenAlex</p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && (
            <div className="flex items-center justify-center py-12 gap-2">
              <span className="w-4 h-4 border-2 border-zinc-200 border-t-zinc-600 rounded-full animate-spin" />
              <span className="text-[12px] text-zinc-500">Fetching citations…</span>
            </div>
          )}
          {error && !loading && (
            <p className="text-[12px] text-red-500 text-center py-12">
              Could not fetch citations for this paper. It may not be indexed in OpenAlex.
            </p>
          )}
          {!loading && !error && papers.length === 0 && (
            <p className="text-[12px] text-zinc-400 text-center py-12">No {DIRECTION_LABELS[direction].label.toLowerCase()} found.</p>
          )}
          {!loading && !error && papers.map((p, i) => {
            const key = p.title.toLowerCase().trim()
            const isAdded = added.has(key) || existingTitles.has(key)
            return (
              <div key={i} className="flex items-start gap-3 py-2.5 border-b border-zinc-100 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-zinc-800 leading-snug">{p.title || 'Untitled'}</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5">{p.authors || 'Unknown'} · {p.year || '—'}</p>
                </div>
                <button
                  onClick={() => handleAdd(p)}
                  disabled={isAdded}
                  className={`shrink-0 px-2.5 py-1 text-[10px] font-semibold rounded transition-colors ${
                    isAdded
                      ? 'bg-green-50 text-green-600 cursor-default'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isAdded ? '✓ Added' : '+ Add'}
                </button>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-zinc-100 shrink-0 flex items-center justify-between">
          <span className="text-[10px] text-zinc-400">
            {papers.length > 0 ? `${papers.length} result${papers.length !== 1 ? 's' : ''}` : ''}
          </span>
          <button onClick={onClose} className="text-[11px] text-zinc-500 hover:text-zinc-800 px-3 py-1">Done</button>
        </div>
      </div>
    </div>
  )
}
