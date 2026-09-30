import { useEffect, useState, useSyncExternalStore } from 'react'
import { cancelAiRequests, getAiActivity, subscribeAiActivity } from '../../lib/aiActivity'

// Short calls finish before the overlay would appear, so nothing flashes.
const SHOW_DELAY_MS = 300
// Batch runs (autofilling rows, screening papers) fire one call after another;
// holding the overlay across the gap stops it blinking between them.
const HIDE_DELAY_MS = 400

/**
 * A large, centred indicator shown whenever an AI request the user started is
 * in flight, so they can always tell the app is working rather than stuck. It
 * blocks clicks underneath to prevent double submissions, offers Stop (which
 * also covers the in-screen Stop buttons it hides), and can be sent to the
 * background for long runs — it then shrinks to a pill until the work is done.
 * Work the app starts by itself only ever gets the pill.
 */
export function AiLoadingOverlay() {
  const { requests } = useSyncExternalStore(subscribeAiActivity, getAiActivity)
  const busy = requests.length > 0

  const [visible, setVisible] = useState(false)
  const [busySince, setBusySince] = useState<number | null>(null)
  const [backgrounded, setBackgrounded] = useState(false)
  // When the work the user is waiting on began — separate from busySince, so a
  // task started during background scoring does not open with the clock at 8s.
  const [foregroundSince, setForegroundSince] = useState<number | null>(null)
  const firstForeground = requests.find(r => !r.background)
  if (firstForeground && foregroundSince === null) setForegroundSince(firstForeground.startedAt)
  if (!firstForeground && foregroundSince !== null) setForegroundSince(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setTimeout(() => {
      if (busy) {
        setBusySince(s => s ?? Date.now())
        setVisible(true)
      } else {
        setVisible(false)
        setBusySince(null)
        setForegroundSince(null)
        setBackgrounded(false)
      }
    }, busy ? SHOW_DELAY_MS : HIDE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [busy])

  useEffect(() => {
    if (!visible) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [visible])

  if (!visible) return null

  const foreground = requests.filter(r => !r.background)
  // The newest request is what the user most likely just asked for.
  const shown = foreground.length > 0 ? foreground : requests
  const label = shown.length > 0 ? shown[shown.length - 1].label : 'Finishing up'
  const since = foreground.length > 0 ? foregroundSince : busySince
  const elapsed = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0

  if (backgrounded || foreground.length === 0) {
    const canExpand = foreground.length > 0
    return (
      <button
        onClick={() => setBackgrounded(false)}
        disabled={!canExpand}
        className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2.5 pl-3 pr-4 py-2 rounded-full bg-zinc-900 text-white shadow-lg enabled:hover:bg-zinc-800 transition-colors"
        title={canExpand ? 'Show progress' : undefined}
        aria-live="polite"
      >
        <span className="w-4 h-4 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
        <span className="text-[12px] font-medium">{label}…</span>
        {shown.length > 1 && <span className="text-[11px] text-zinc-400 tabular-nums">×{shown.length}</span>}
        <span className="text-[11px] text-zinc-400 tabular-nums">{elapsed}s</span>
      </button>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-white/55 backdrop-blur-[2px] animate-in fade-in duration-200"
      role="alertdialog"
      aria-busy="true"
      aria-live="polite"
      aria-label={label}
    >
      <div className="w-[340px] max-w-[calc(100vw-32px)] bg-white rounded-2xl border border-zinc-200 shadow-2xl px-8 py-9 flex flex-col items-center text-center">
        <div className="relative w-16 h-16 mb-6">
          <span className="absolute inset-0 rounded-full border-4 border-zinc-100" />
          <span className="absolute inset-0 rounded-full border-4 border-transparent border-t-zinc-900 animate-spin" />
          <span className="absolute inset-[22px] rounded-full bg-zinc-900 animate-pulse" />
        </div>

        <p className="text-[16px] font-semibold text-zinc-900 leading-snug">{label}…</p>
        <p className="mt-1.5 text-[12px] text-zinc-500">
          AI is working on it
          {foreground.length > 1 && <> · {foreground.length} requests</>}
          {' · '}
          <span className="tabular-nums">{elapsed}s</span>
        </p>
        {elapsed >= 20 && (
          <p className="mt-3 text-[11.5px] text-zinc-400 leading-relaxed">
            Longer tasks can take a minute or two.
          </p>
        )}

        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={cancelAiRequests}
            className="px-4 h-8 rounded-md border border-zinc-300 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50 hover:border-zinc-400 transition-colors"
          >
            Stop
          </button>
          <button
            onClick={() => setBackgrounded(true)}
            className="text-[12px] text-zinc-500 hover:text-zinc-900 underline underline-offset-2 transition-colors"
          >
            Continue in background
          </button>
        </div>
      </div>
    </div>
  )
}
