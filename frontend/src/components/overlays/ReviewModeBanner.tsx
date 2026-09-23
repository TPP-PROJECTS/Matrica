import { useApp } from '../../store/AppContext'

export function ReviewModeBanner() {
  const { dispatch } = useApp()

  return (
    <div className="w-full h-[34px] bg-sky-50 border-b border-sky-300 flex items-center px-4 gap-3 shrink-0">
      <span className="text-[11px] text-sky-900 flex-1">
        👁 <strong>Review mode</strong> — every step is open for reading. Editing is off, and outdated-step warnings are hidden.
      </span>
      <button
        onClick={() => dispatch({ type: 'SET_REVIEW_MODE', enabled: false })}
        className="px-3 h-6 bg-sky-700 text-white rounded text-[10px] font-semibold hover:bg-sky-600 transition-colors shrink-0"
      >
        Exit review mode
      </button>
    </div>
  )
}
