import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../../store/AppContext'
import { createVersion, deleteVersion, fetchVersion, listVersions } from '../../lib/sessionStorage'
import type { VersionEntry } from '../../types'

/**
 * Checkpoints of the current project.
 *
 * This is the history that undo cannot reach. Undo holds the last thirty
 * actions of the live session and is gone on reload; a checkpoint survives, and
 * is the thing a researcher wants when a re-extraction or a supervisor's
 * restructure turns out to have been the wrong call.
 *
 * Restoring is destructive to the present state, so it takes a second click —
 * and it offers to checkpoint what is about to be replaced, which is the only
 * way back if the restore was itself a mistake.
 */
function relativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}h ago`
  const diffDays = Math.floor(diffMin / (60 * 24))
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

export function CheckpointList() {
  const { state, dispatch } = useApp()
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null)

  // State is only set once the request settles, never synchronously in the
  // effect body — a synchronous setState there cascades an extra render.
  const refresh = useCallback(async () => {
    try {
      setVersions(await listVersions(state.sessionId))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load checkpoints.')
    } finally {
      setLoading(false)
    }
  }, [state.sessionId])

  useEffect(() => {
    let cancelled = false
    listVersions(state.sessionId)
      .then(list => { if (!cancelled) { setVersions(list); setError(null) } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load checkpoints.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [state.sessionId])

  async function handleCreate() {
    setBusy(true)
    setError(null)
    try {
      await createVersion(state, label.trim())
      setLabel('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save a checkpoint.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRestore(version: VersionEntry) {
    setBusy(true)
    setError(null)
    try {
      // Take the present state with us before replacing it. Without this, an
      // accidental restore is unrecoverable — exactly the situation this
      // feature exists to prevent.
      await createVersion(state, `Before restoring "${version.label || relativeTime(version.createdAt)}"`, 'manual')
      const snapshot = await fetchVersion(state.sessionId, version.id)
      dispatch({ type: 'LOAD_SESSION', snapshot })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore that checkpoint.')
    } finally {
      setBusy(false)
      setConfirmRestore(null)
    }
  }

  async function handleDelete(id: string) {
    await deleteVersion(state.sessionId, id)
    setVersions(prev => prev.filter(v => v.id !== id))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Take a checkpoint */}
      <div className="px-3 py-2.5 border-b border-zinc-100 shrink-0">
        <div className="flex gap-1.5">
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !busy) void handleCreate() }}
            placeholder="Name this point (optional)"
            className="flex-1 h-7 border border-zinc-200 rounded px-2 text-[11px] outline-none focus:border-blue-400"
          />
          <button
            onClick={() => void handleCreate()}
            disabled={busy}
            className="px-2.5 h-7 bg-blue-600 text-white text-[10px] font-medium rounded hover:bg-blue-700 disabled:opacity-50 shrink-0"
          >
            Checkpoint
          </button>
        </div>
        <p className="text-[9px] text-zinc-400 mt-1.5 leading-snug">
          A checkpoint keeps this project exactly as it is now, so you can come back to it
          after changes that undo will not reach.
        </p>
      </div>

      {error && (
        <p className="text-[10px] text-red-600 px-3 py-2 border-b border-red-100 bg-red-50">{error}</p>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading && <p className="text-[11px] text-zinc-400 text-center py-6">Loading…</p>}

        {!loading && versions.length === 0 && !error && (
          <div className="text-center py-8">
            <p className="text-[11px] text-zinc-400">No checkpoints yet.</p>
            <p className="text-[10px] text-zinc-400 mt-1">
              Take one before any change you might want to walk back.
            </p>
          </div>
        )}

        {versions.map(version => (
          <div key={version.id} className="border border-zinc-200 rounded-lg p-2.5 mb-2">
            <div className="flex items-baseline gap-2">
              <p className="text-[11px] font-semibold text-zinc-900 flex-1 leading-snug">
                {version.label || `Step ${version.step} — ${version.stepName}`}
              </p>
              <span className="text-[9px] text-zinc-400 shrink-0">{relativeTime(version.createdAt)}</span>
            </div>
            <p className="text-[9px] text-zinc-400 mt-0.5">
              Step {version.step} · {version.stepName}
              {version.trigger === 'step_complete' && ' · automatic'}
            </p>

            <div className="flex items-center gap-2 mt-2">
              {confirmRestore === version.id ? (
                <>
                  <span className="text-[10px] text-amber-700">Replace current work?</span>
                  <button
                    onClick={() => void handleRestore(version)}
                    disabled={busy}
                    className="text-[10px] text-amber-700 font-semibold hover:underline disabled:opacity-50"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => setConfirmRestore(null)}
                    className="text-[10px] text-zinc-400 hover:underline"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmRestore(version.id)}
                  className="text-[10px] text-blue-600 hover:underline"
                >
                  Restore
                </button>
              )}
              <button
                onClick={() => void handleDelete(version.id)}
                className="text-[10px] text-zinc-400 hover:text-red-500 ml-auto"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
