import { useState, useRef, useEffect } from 'react'
import { useApp } from '../../store/AppContext'

export function TopBar() {
  const { state, dispatch, saveStatus } = useApp()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    setDraft(state.sessionTitle || '')
    setEditing(true)
  }

  function commitEdit() {
    const trimmed = draft.trim()
    dispatch({ type: 'SET_SESSION_TITLE', title: trimmed })
    setEditing(false)
  }

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  return (
    <header className="h-12 bg-zinc-900 flex items-center px-4 gap-4 shrink-0 z-30 relative">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <span className="text-white text-sm font-bold tracking-tight">ResearchAI</span>
        <div className="w-px h-4 bg-zinc-700" />
      </div>

      {/* Session title — click to edit */}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === 'Enter') commitEdit()
            if (e.key === 'Escape') setEditing(false)
          }}
          placeholder="Session title…"
          className="bg-zinc-800 text-white text-[11px] px-2 py-0.5 rounded border border-zinc-600 outline-none max-w-[240px] min-w-[160px]"
        />
      ) : (
        <button
          onClick={startEdit}
          title="Click to rename"
          className="text-[11px] text-zinc-400 hover:text-zinc-200 truncate max-w-[200px] transition-colors"
        >
          {state.sessionTitle || 'Untitled Session'}
        </button>
      )}

      <div className="flex-1" />

      {/* Save status */}
      <span className="text-[10px] text-zinc-600 flex items-center gap-1">
        {saveStatus === 'saved' ? (
          <><span className="text-green-500">●</span> Saved</>
        ) : (
          <><span className="text-amber-400 animate-pulse">●</span> Saving…</>
        )}
      </span>

      {/* History / Sessions button */}
      <button
        onClick={() => dispatch({ type: 'TOGGLE_HISTORY' })}
        className="px-3 py-1 border border-zinc-600 rounded text-white text-[11px] hover:border-zinc-400 transition-colors"
      >
        Sessions
      </button>

      {/* User avatar */}
      <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-white text-[10px] font-semibold shrink-0">
        JS
      </div>
    </header>
  )
}
