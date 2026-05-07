import { useApp } from '../../store/AppContext'

export function ConsistencyAlertBanner() {
  const { state, dispatch } = useApp()

  if (!state.consistencyAlert) return null

  const { claim, data } = state.consistencyAlert

  return (
    <div className="w-full h-10 bg-red-50 border-2 border-red-400 flex items-center px-4 gap-3 shrink-0">
      <p className="text-[11px] text-red-800 flex-1 truncate">
        ⚠ SYSTEM ALERT: <strong>{claim}</strong> contradicts <strong>{data}</strong>
      </p>
      <button className="px-2 py-1 bg-red-500 text-white text-[10px] rounded shrink-0 hover:bg-red-600 transition-colors">
        Review conflict
      </button>
      <button
        onClick={() => dispatch({ type: 'DISMISS_CONSISTENCY_ALERT' })}
        className="text-[10px] text-zinc-600 hover:text-zinc-900 shrink-0"
      >
        Dismiss
      </button>
    </div>
  )
}
