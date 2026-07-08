import { useState, useEffect } from 'react'
import { useApp } from '../../store/AppContext'
import { listSessions, deleteSession, loadSession } from '../../lib/sessionStorage'
import type { SessionMeta } from '../../types'

const STEP_LABELS = [
  '', 'Chat & Define Topic', 'Matrix Schema', 'System Review', 'Explore & Search', 'Select Paper',
  'Matrix', 'Synthesis', 'Gap & Statement', 'Final Question',
]

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `${diffD}d ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

function stepDots(currentStep: number) {
  return Array.from({ length: 9 }, (_, i) => i + 1).map(s => (
    <div
      key={s}
      className={`w-1.5 h-1.5 rounded-full ${
        s < currentStep ? 'bg-green-500' :
        s === currentStep ? 'bg-blue-500' :
        'bg-zinc-200'
      }`}
    />
  ))
}

function SessionCard({
  meta,
  isActive,
  onLoad,
  onDelete,
}: {
  meta: SessionMeta
  isActive: boolean
  onLoad: () => void
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className={`rounded-lg border mb-2 transition-colors ${
      isActive
        ? 'border-2 border-blue-400 bg-blue-50'
        : 'border border-zinc-200 bg-white hover:bg-zinc-50'
    }`}>
      <button className="w-full text-left px-3 pt-2.5 pb-2" onClick={onLoad}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className={`text-[11px] font-semibold truncate ${isActive ? 'text-blue-700' : 'text-zinc-900'}`}>
              {meta.title}
            </p>
            {meta.topicPreview && (
              <p className="text-[9px] text-zinc-400 truncate mt-0.5">{meta.topicPreview}</p>
            )}
          </div>
          {isActive && (
            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 text-[8px] font-semibold rounded-full shrink-0">
              current
            </span>
          )}
        </div>

        {/* Step progress dots */}
        <div className="flex items-center gap-1 mt-2">
          {stepDots(meta.currentStep)}
          <span className="text-[9px] text-zinc-400 ml-1">
            Step {meta.currentStep} · {STEP_LABELS[meta.currentStep]}
          </span>
        </div>

        <p className="text-[9px] text-zinc-400 mt-1.5">
          Last saved {formatDate(meta.updatedAt)}
        </p>
      </button>

      {/* Actions */}
      <div className="px-3 pb-2 flex items-center gap-2 border-t border-zinc-100 pt-1.5">
        {!isActive && (
          <button
            onClick={onLoad}
            className="text-[10px] text-blue-600 hover:underline"
          >
            Open
          </button>
        )}
        {confirmDelete ? (
          <>
            <span className="text-[10px] text-red-600">Delete?</span>
            <button
              onClick={() => { onDelete(); setConfirmDelete(false) }}
              className="text-[10px] text-red-600 font-semibold hover:underline"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-[10px] text-zinc-400 hover:underline"
            >
              No
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-[10px] text-zinc-400 hover:text-red-500 ml-auto"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

export function VersionHistoryDrawer() {
  const { state, dispatch } = useApp()
  const [sessions, setSessions] = useState<SessionMeta[]>([])

  // Refresh list whenever drawer opens
  useEffect(() => {
    setSessions(listSessions())
  }, [state.showVersionHistory])

  function handleLoad(id: string) {
    const snap = loadSession(id)
    if (!snap) return
    dispatch({ type: 'LOAD_SESSION', snapshot: snap })
    // drawer closes via LOAD_SESSION resetting showVersionHistory in reducer
  }

  function handleDelete(id: string) {
    deleteSession(id)
    setSessions(listSessions())
  }

  function handleNew() {
    dispatch({ type: 'NEW_SESSION' })
    // drawer closes via NEW_SESSION resetting showVersionHistory in reducer
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30"
        onClick={() => dispatch({ type: 'TOGGLE_HISTORY' })}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-12 h-[calc(100%-3rem)] w-[320px] bg-white border-l-2 border-zinc-200 shadow-xl z-40 flex flex-col">
        {/* Header */}
        <div className="h-12 border-b border-zinc-200 flex items-center px-4 gap-3 shrink-0">
          <span className="text-[14px] font-bold text-zinc-900 flex-1">Sessions</span>
          <button
            onClick={handleNew}
            className="px-2.5 py-1 bg-blue-600 text-white text-[10px] font-medium rounded hover:bg-blue-700 transition-colors"
          >
            + New Session
          </button>
          <button
            onClick={() => dispatch({ type: 'TOGGLE_HISTORY' })}
            className="text-[11px] text-zinc-400 hover:text-zinc-700"
          >
            ✕
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {sessions.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-[11px] text-zinc-400">No saved sessions yet.</p>
              <p className="text-[10px] text-zinc-400 mt-1">Your work is auto-saved as you go.</p>
            </div>
          ) : (
            sessions.map(meta => (
              <SessionCard
                key={meta.id}
                meta={meta}
                isActive={meta.id === state.sessionId}
                onLoad={() => handleLoad(meta.id)}
                onDelete={() => handleDelete(meta.id)}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-100 px-4 py-2.5 shrink-0">
          <p className="text-[9px] text-zinc-400 text-center">
            Auto-saved to browser storage · {sessions.length} session{sessions.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
    </>
  )
}
