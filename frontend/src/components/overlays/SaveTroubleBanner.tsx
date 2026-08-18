import { useRef, useState } from 'react'
import { useApp } from '../../store/AppContext'
import { downloadSessionFile, readSessionFile } from '../../lib/sessionStorage'

/**
 * Shown when persistence is not working.
 *
 * The point is not to apologise — it is to make sure the user can get their
 * work out of the tab before they close it. A systematic review represents
 * days of judgement calls that cannot be reconstructed, so the recovery action
 * is the loudest thing in the banner.
 *
 * Two distinct conditions, because the right response differs:
 *   'local-only' — the backend is unreachable. The browser copy is fine, so
 *                  this is a warning, not an emergency: don't clear the cache.
 *   'error'      — nothing accepted the write. Download now.
 */
export function SaveTroubleBanner() {
  const { state, dispatch, saveStatus } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  if (saveStatus !== 'error' && saveStatus !== 'local-only') return null
  if (saveStatus === 'local-only' && dismissed) return null

  const critical = saveStatus === 'error'

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportError(null)
    try {
      const snapshot = await readSessionFile(file)
      dispatch({ type: 'LOAD_SESSION', snapshot })
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not read that file.')
    }
  }

  return (
    <div
      role="alert"
      className={`px-4 py-2 border-b flex items-center gap-3 text-[11px] ${
        critical
          ? 'bg-red-50 border-red-200 text-red-900'
          : 'bg-amber-50 border-amber-200 text-amber-900'
      }`}
    >
      <span className={critical ? 'text-red-500' : 'text-amber-500'}>●</span>

      <div className="flex-1 leading-snug">
        {critical ? (
          <>
            <strong>This session is not being saved.</strong>{' '}
            Neither the browser store nor the server accepted the last write. Your work is
            still here, but it will be lost if you close or reload this tab.
          </>
        ) : (
          <>
            <strong>Saved in this browser only.</strong>{' '}
            The server is unreachable, so this session is not backed up. Avoid clearing your
            browser data until it reconnects.
          </>
        )}
        {importError && <span className="block text-red-700 mt-0.5">{importError}</span>}
      </div>

      <button
        onClick={() => downloadSessionFile(state)}
        className={`px-2.5 py-1 rounded text-[11px] font-semibold shrink-0 ${
          critical
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'border border-amber-400 text-amber-900 hover:bg-amber-100'
        }`}
      >
        Download session file
      </button>

      <button
        onClick={() => fileRef.current?.click()}
        className="px-2.5 py-1 rounded border border-current/30 text-[11px] shrink-0 hover:bg-black/5"
      >
        Restore from file
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={handleImport}
        className="hidden"
      />

      {!critical && (
        <button
          onClick={() => setDismissed(true)}
          title="Dismiss"
          className="text-current/50 hover:text-current shrink-0 text-[13px] leading-none"
        >
          ✕
        </button>
      )}
    </div>
  )
}
