import { useState, useEffect } from 'react'
import { API, apiFetch } from '../../lib/api'


interface Segment {
  type: 'text' | 'locked'
  content: string
}

function segmentPrompt(prompt: string): Segment[] {
  // Find the response-format instruction line followed by a JSON block.
  // Pattern: a line starting with Respond/Return ... JSON ... then either { on same or next line
  const idx = prompt.search(/\n(?:Respond|Return)\b[^\n]*\{/)
  if (idx !== -1) {
    return [
      { type: 'text', content: prompt.slice(0, idx) },
      { type: 'locked', content: prompt.slice(idx) },
    ]
  }
  return [{ type: 'text', content: prompt }]
}

function assemblePrompt(segments: Segment[], edits: Record<number, string>): string {
  return segments
    .map((seg, i) => (seg.type === 'text' && edits[i] !== undefined ? edits[i] : seg.content))
    .join('')
}

interface Props {
  promptKey: string
  title: string
  onClose: () => void
  onGenerate: (customPrompt: string | null) => void
  initialCustomPrompt?: string | null
}

export function CustomizePromptModal({ promptKey, title, onClose, onGenerate, initialCustomPrompt }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [segments, setSegments] = useState<Segment[]>([])
  const [edits, setEdits] = useState<Record<number, string>>({})

  useEffect(() => {
    async function fetchPrompt() {
      try {
        const res = await apiFetch(`${API}/prompts/${promptKey}`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        const prompt: string = data.system_prompt
        setDefaultPrompt(prompt)
        const segs = segmentPrompt(prompt)
        setSegments(segs)

        if (initialCustomPrompt && initialCustomPrompt !== prompt) {
          // Re-segment the custom prompt so editable parts reflect user's prior edits
          const customSegs = segmentPrompt(initialCustomPrompt)
          const initEdits: Record<number, string> = {}
          segs.forEach((seg, i) => {
            if (seg.type === 'text') {
              initEdits[i] = customSegs[i]?.content ?? seg.content
            }
          })
          setEdits(initEdits)
        } else {
          // Pre-fill edits with defaults
          const initEdits: Record<number, string> = {}
          segs.forEach((seg, i) => {
            if (seg.type === 'text') initEdits[i] = seg.content
          })
          setEdits(initEdits)
        }
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    fetchPrompt()
  }, [promptKey, initialCustomPrompt])

  function handleReset() {
    const initEdits: Record<number, string> = {}
    segments.forEach((seg, i) => {
      if (seg.type === 'text') initEdits[i] = seg.content
    })
    setEdits(initEdits)
  }

  function handleGenerate() {
    const assembled = assemblePrompt(segments, edits)
    // If unchanged from default, pass null so backend uses its own default
    onGenerate(assembled === defaultPrompt ? null : assembled)
  }

  const isModified = segments.some(
    (seg, i) => seg.type === 'text' && edits[i] !== undefined && edits[i] !== seg.content
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl flex flex-col w-[680px] max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-zinc-200 shrink-0">
          <span className="text-[13px] font-bold text-zinc-900 flex-1">Customize AI Prompt — {title}</span>
          {isModified && (
            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-semibold">Modified</span>
          )}
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-[18px] leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center justify-center h-32">
              <span className="w-5 h-5 border-2 border-zinc-300 border-t-zinc-700 rounded-full animate-spin" />
            </div>
          )}
          {error && (
            <p className="text-[12px] text-red-500 text-center py-8">Failed to load prompt. Make sure the backend is running.</p>
          )}
          {!loading && !error && (
            <div className="space-y-3">
              <p className="text-[11px] text-zinc-500">
                Edit the instruction text below. Sections marked <span className="font-semibold text-zinc-700">Response Format</span> define the expected JSON structure and cannot be modified.
              </p>
              {segments.map((seg, i) =>
                seg.type === 'text' ? (
                  <div key={i}>
                    <textarea
                      value={edits[i] ?? seg.content}
                      onChange={e => setEdits(prev => ({ ...prev, [i]: e.target.value }))}
                      rows={Math.min(Math.max(seg.content.split('\n').length + 1, 4), 18)}
                      className="w-full border border-zinc-300 rounded-lg px-3 py-2.5 text-[12px] font-mono text-zinc-800 resize-y focus:outline-none focus:border-zinc-500 bg-white leading-relaxed"
                    />
                  </div>
                ) : (
                  <div key={i} className="rounded-lg border border-zinc-200 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 border-b border-zinc-200">
                      <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Response Format — locked</span>
                      <span className="text-[9px] text-zinc-400">This section defines the expected JSON structure and cannot be edited</span>
                    </div>
                    <pre className="px-3 py-2.5 text-[11px] font-mono text-zinc-500 whitespace-pre-wrap leading-relaxed bg-zinc-50 select-none">
                      {seg.content}
                    </pre>
                  </div>
                )
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-200 shrink-0">
          <button
            onClick={handleReset}
            disabled={!isModified}
            className="px-3 h-8 border border-zinc-300 rounded text-[11px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Reset to Default
          </button>
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 h-8 border border-zinc-300 rounded text-[11px] text-zinc-600 hover:bg-zinc-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading || error}
            className="px-4 h-8 bg-zinc-900 text-white rounded text-[11px] font-semibold hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isModified ? 'Generate with Custom Prompt' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}
