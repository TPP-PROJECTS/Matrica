import { useApp } from '../../store/AppContext'

const STEP_NAMES: Record<number, string> = {
  1: 'Chat & Define Topic',
  2: 'Matrix Schema',
  3: 'System Review',
  4: 'Explore & Search',
  5: 'Select Paper',
  6: 'Matrix',
  7: 'Synthesis',
  8: 'Gap & Statement',
  9: 'Final Question',
}

export function BackNavModal() {
  const { state, dispatch } = useApp()

  if (!state.pendingBackStep) return null

  const target = state.pendingBackStep
  const current = state.currentStep
  const targetName = STEP_NAMES[target] ?? `Step ${target}`

  // Steps that will be marked stale (between target and current, exclusive of target)
  const affectedSteps = Array.from(
    { length: current - target },
    (_, i) => target + i + 1
  )

  const ASSISTANT_NOTE = `Going back to Step ${target} will let you revise earlier decisions. The steps between ${target} and ${current} will be marked "outdated" so you know they need to be reviewed, but all your work is preserved and still visible.`

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
        onClick={() => dispatch({ type: 'BACK_NAV_CANCEL' })}
      >
        {/* Modal */}
        <div
          className="w-[560px] bg-white rounded-lg border-2 border-zinc-200 shadow-2xl overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* Top accent bar */}
          <div className="h-2 bg-zinc-900" />

          <div className="p-5">
            {/* Title */}
            <h2 className="text-[15px] font-bold text-zinc-900 mb-2">
              Going back to Step {target}: {targetName}
            </h2>

            {/* Explanation */}
            <p className="text-[11px] text-zinc-600 mb-3">
              You are on Step {current}. The following steps were built from current data and will be marked as outdated:
            </p>

            {/* Affected steps */}
            {affectedSteps.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-3">
                {affectedSteps.map(stepNum => (
                  <div
                    key={stepNum}
                    className="h-[30px] bg-amber-50 border border-amber-400 rounded flex items-center px-3 gap-2"
                    style={{ borderLeft: '3px solid #f59e0b' }}
                  >
                    <span className="text-[11px] font-semibold text-amber-800">Step {stepNum}</span>
                    <span className="text-[11px] text-amber-700">· {STEP_NAMES[stepNum]}</span>
                    <span className="ml-auto text-[10px] italic text-amber-600">Will need regeneration</span>
                  </div>
                ))}
              </div>
            )}

            {/* Reassurance */}
            <p className="text-[10px] italic text-zinc-500 mb-3">
              Your data is NOT deleted. It stays visible but marked outdated until you regenerate.
            </p>

            {/* Chatbot message */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <div className="flex gap-2">
                <span className="text-blue-500 text-[13px] shrink-0">✦</span>
                <p className="text-[11px] text-zinc-700 leading-relaxed">{ASSISTANT_NOTE}</p>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => dispatch({ type: 'BACK_NAV_CANCEL' })}
                className="px-4 h-[38px] border border-zinc-700 rounded text-[12px] text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                onClick={() => dispatch({ type: 'BACK_NAV_CONFIRM' })}
                className="px-4 h-[38px] bg-zinc-900 text-white rounded text-[12px] font-semibold hover:bg-zinc-700 transition-colors"
              >
                Yes, go back
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
