import { useApp } from '../../store/AppContext'

const STEP_NAMES: Record<number, string> = {
  1: 'Chat & Define Topic',
  2: 'Explore & Search',
  3: 'Review List',
  4: 'Matrix',
  5: 'Synthesis',
  6: 'Gap & Statement',
  7: 'Final Question',
}

export function EditModeBanner() {
  const { state, dispatch } = useApp()

  const staleStepLabels = state.staleSteps.map(s => `Step ${s}`).join(', ')

  return (
    <div className="w-full h-[50px] bg-amber-50 border-y border-amber-400 flex items-center px-4 gap-3 shrink-0">
      <p className="text-[11px] text-amber-800 flex-1">
        ⚠ <strong>Edit Mode</strong> — Step {state.currentStep}: {STEP_NAMES[state.currentStep]}.
        {staleStepLabels && (
          <span> Steps {staleStepLabels} are marked outdated.</span>
        )}
      </p>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={() => dispatch({ type: 'SET_STEP', step: state.currentStep })}
          className="px-3 h-8 border border-zinc-700 text-zinc-700 rounded text-[11px] hover:bg-zinc-100 transition-colors"
        >
          Cancel Edit
        </button>
        <button
          onClick={() => dispatch({ type: 'ADVANCE_STEP' })}
          className="px-3 h-8 bg-zinc-900 text-white rounded text-[11px] font-semibold hover:bg-zinc-700 transition-colors"
        >
          Confirm &amp; Update Downstream →
        </button>
      </div>
    </div>
  )
}
