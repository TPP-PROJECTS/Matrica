import { lazy, Suspense, useState, useRef, useEffect } from 'react'
import { useApp } from '../../store/AppContext'

const ExportModal = lazy(() => import('../overlays/ExportModal').then(module => ({ default: module.ExportModal })))
const PeerReviewPanel = lazy(() => import('../overlays/PeerReviewPanel').then(module => ({ default: module.PeerReviewPanel })))

export function TopBar() {
  const { state, dispatch, saveStatus, canUndo, canRedo, undo, redo } = useApp()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [showExport, setShowExport] = useState(false)
  const [showPeerReview, setShowPeerReview] = useState(false)
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

  // Keyboard shortcuts: Ctrl/Cmd+Z for undo, Ctrl/Cmd+Shift+Z for redo
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [undo, redo])

  return (
    <>
      <header className="h-12 bg-zinc-900 flex items-center px-4 gap-3 shrink-0 z-30 relative">
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

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 5.5H8.5a3 3 0 0 1 0 6H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4.5 3L2 5.5 4.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⌘⇧Z)"
            className="w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M11 5.5H4.5a3 3 0 0 0 0 6H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8.5 3L11 5.5 8.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <div className="w-px h-4 bg-zinc-700" />

        {/* Save status */}
        <span className="text-[10px] text-zinc-600 flex items-center gap-1">
          {saveStatus === 'saved' ? (
            <><span className="text-green-500">●</span> Saved</>
          ) : (
            <><span className="text-amber-400 animate-pulse">●</span> Saving…</>
          )}
        </span>

        {/* Export button */}
        <button
          onClick={() => setShowExport(true)}
          className="px-3 py-1 border border-zinc-600 rounded text-zinc-300 text-[11px] hover:border-zinc-400 hover:text-white transition-colors flex items-center gap-1.5"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M5.5 1v6M2.5 4.5l3 3 3-3M1 9h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Export
        </button>

        {/* Peer review button */}
        <button
          onClick={() => setShowPeerReview(true)}
          title="Invite a blind second reviewer and compare results"
          className="px-3 py-1 border border-zinc-600 rounded text-zinc-300 text-[11px] hover:border-zinc-400 hover:text-white transition-colors flex items-center gap-1.5"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="4" cy="3.5" r="2" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M1 10c0-1.7 1.3-3 3-3s3 1.3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <path d="M7.5 4.5l1.5 1.5 2-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Peer review
        </button>

        {/* History / Sessions button */}
        <button
          onClick={() => dispatch({ type: 'TOGGLE_HISTORY' })}
          className="px-3 py-1 border border-zinc-600 rounded text-white text-[11px] hover:border-zinc-400 transition-colors"
        >
          Sessions
        </button>

        {/* Analytics button */}
        <a
          href="#analytics"
          className="px-3 py-1 border border-zinc-600 rounded text-zinc-300 text-[11px] hover:border-zinc-400 hover:text-white transition-colors flex items-center gap-1.5"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1 9h9M2 9V5.5M4.5 9V3M7 9V6M9.5 9V1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          Analytics
        </a>

        {/* User avatar */}
        <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-white text-[10px] font-semibold shrink-0">
          JS
        </div>
      </header>

      {showExport && (
        <Suspense fallback={null}>
          <ExportModal onClose={() => setShowExport(false)} />
        </Suspense>
      )}
      {showPeerReview && (
        <Suspense fallback={null}>
          <PeerReviewPanel onClose={() => setShowPeerReview(false)} />
        </Suspense>
      )}
    </>
  )
}
