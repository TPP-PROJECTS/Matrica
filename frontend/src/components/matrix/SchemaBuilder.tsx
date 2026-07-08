import { useState } from 'react'
import { CustomizePromptModal } from '../shared/CustomizePromptModal'

type Accent = 'zinc' | 'violet'

const ACCENTS: Record<Accent, { btn: string; chip: string; ring: string; dot: string }> = {
  zinc: {
    btn: 'bg-purple-600 hover:bg-purple-700',
    chip: 'bg-zinc-100 border-zinc-300 text-zinc-800',
    ring: 'focus:border-purple-500',
    dot: 'bg-purple-500',
  },
  violet: {
    btn: 'bg-violet-600 hover:bg-violet-700',
    chip: 'bg-violet-50 border-violet-200 text-violet-800',
    ring: 'focus:border-violet-500',
    dot: 'bg-violet-500',
  },
}

interface Props {
  title: string
  available: string[]           // full recommendation pool (left list source)
  selected: string[]            // chosen columns (right list)
  descriptions?: Record<string, string>  // column name → what it captures
  newColumns?: string[]         // freshly regenerated columns → get a "New" badge
  loading?: boolean
  accent?: Accent
  promptKey: string             // for CustomizePromptModal
  promptTitle: string
  customPrompt?: string | null
  onChange: (selected: string[]) => void
  onRegenerate: (prompt?: string | null) => void
}

export function SchemaBuilder({
  title, available, selected, descriptions = {}, newColumns = [], loading = false, accent = 'zinc',
  promptKey, promptTitle, customPrompt = null, onChange, onRegenerate,
}: Props) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [showPrompt, setShowPrompt] = useState(false)
  const a = ACCENTS[accent]
  const newSet = new Set(newColumns)

  // Left list = recommendations that aren't already selected
  const avail = available.filter(c => !selected.includes(c))
  const allChecked = avail.length > 0 && avail.every(c => checked.has(c))

  function toggle(col: string) {
    setChecked(prev => {
      const next = new Set(prev)
      next.has(col) ? next.delete(col) : next.add(col)
      return next
    })
  }

  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(avail))
  }

  function moveChecked() {
    const moving = avail.filter(c => checked.has(c))
    if (moving.length === 0) return
    onChange([...selected, ...moving])
    setChecked(new Set())
  }

  function moveAll() {
    if (avail.length === 0) return
    onChange([...selected, ...avail])
    setChecked(new Set())
  }

  function remove(col: string) {
    onChange(selected.filter(c => c !== col))
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-bold text-zinc-900 flex-1">{title}</span>
        <button
          onClick={() => onRegenerate(customPrompt)}
          disabled={loading}
          className="px-2.5 h-7 border border-zinc-300 rounded text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading
            ? <><span className="w-2.5 h-2.5 border border-zinc-300 border-t-zinc-700 rounded-full animate-spin" /> Regenerating…</>
            : <>↻ Regenerate</>}
          {customPrompt && <span className={`w-1 h-1 rounded-full ${a.dot}`} />}
        </button>
        <button
          onClick={() => setShowPrompt(true)}
          disabled={loading}
          title="Customize AI prompt"
          className="px-2 h-7 border border-zinc-300 rounded text-[11px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
        >⚙</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Left — recommended */}
        <div className="border border-zinc-200 rounded-lg flex flex-col min-h-[220px] max-h-[340px]">
          <div className="flex items-center gap-2 px-3 h-8 border-b border-zinc-200 bg-zinc-50 shrink-0">
            <label className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide cursor-pointer">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={avail.length === 0} className="accent-zinc-700" />
              Recommended
            </label>
            <span className="text-[10px] text-zinc-400">{avail.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading && avail.length === 0 && (
              <div className="flex items-center justify-center h-32 text-[11px] text-zinc-400 gap-2">
                <span className="w-4 h-4 border-2 border-zinc-200 border-t-zinc-600 rounded-full animate-spin" /> Generating…
              </div>
            )}
            {!loading && avail.length === 0 && (
              <p className="text-[11px] text-zinc-400 text-center py-8">All recommendations added. Use Regenerate for more.</p>
            )}
            {avail.map(col => (
              <label
                key={col}
                className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-zinc-50 cursor-pointer text-[12px] text-zinc-700"
                title={descriptions[col] || undefined}
              >
                <input type="checkbox" checked={checked.has(col)} onChange={() => toggle(col)} className="accent-zinc-700 shrink-0 mt-0.5" />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span>{col}</span>
                    {newSet.has(col) && <span className="px-1 py-px rounded bg-emerald-100 text-emerald-700 text-[8px] font-bold uppercase tracking-wide shrink-0">New</span>}
                  </span>
                  {descriptions[col] && <span className="text-[10px] text-zinc-400 leading-snug line-clamp-2">{descriptions[col]}</span>}
                </span>
                <button
                  onClick={e => { e.preventDefault(); onChange([...selected, col]) }}
                  className="text-zinc-400 hover:text-zinc-800 text-[13px] mt-0.5"
                  title="Add"
                >→</button>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 px-2 h-9 border-t border-zinc-200 shrink-0">
            <button
              onClick={moveChecked}
              disabled={checked.size === 0}
              className={`px-3 h-6 rounded text-[11px] text-white ${a.btn} disabled:opacity-40`}
            >Add selected →</button>
            <button
              onClick={moveAll}
              disabled={avail.length === 0}
              className="px-2 h-6 rounded text-[11px] text-zinc-600 border border-zinc-300 hover:bg-zinc-50 disabled:opacity-40"
            >Add all</button>
          </div>
        </div>

        {/* Right — selected */}
        <div className="border border-zinc-200 rounded-lg flex flex-col min-h-[220px] max-h-[340px]">
          <div className="flex items-center gap-2 px-3 h-8 border-b border-zinc-200 bg-zinc-50 shrink-0">
            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Matrix columns</span>
            <span className="text-[10px] text-zinc-400">{selected.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {selected.length === 0 && (
              <p className="text-[11px] text-zinc-400 text-center py-8">No columns yet. Add from the left.</p>
            )}
            {selected.map((col, i) => (
              <div
                key={col}
                className={`flex items-start gap-2 px-2 py-1.5 rounded border ${a.chip} text-[12px]`}
                title={descriptions[col] || undefined}
              >
                <span className="text-[9px] text-zinc-400 w-4 shrink-0 mt-0.5">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block">{col}</span>
                  {descriptions[col] && <span className="text-[10px] text-zinc-500 leading-snug line-clamp-2">{descriptions[col]}</span>}
                </span>
                <button onClick={() => remove(col)} title="Remove" className="text-zinc-400 hover:text-red-500 text-[12px] mt-0.5">✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showPrompt && (
        <CustomizePromptModal
          promptKey={promptKey}
          title={promptTitle}
          initialCustomPrompt={customPrompt}
          onClose={() => setShowPrompt(false)}
          onGenerate={(prompt) => { setShowPrompt(false); onRegenerate(prompt) }}
        />
      )}
    </div>
  )
}
