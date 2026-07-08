import { useApp } from '../../store/AppContext'
import type { StepState } from '../../types'

const STEPS = [
  { id: 1, label: 'Chat & Define Topic' },
  { id: 2, label: 'Matrix Schema' },
  { id: 3, label: 'System Review' },
  { id: 4, label: 'Explore & Search' },
  { id: 5, label: 'Select Paper' },
  { id: 6, label: 'Matrix' },
  { id: 7, label: 'Synthesis' },
  { id: 8, label: 'Gap & Statement' },
  { id: 9, label: 'Final Question' },
]

function badgeBorderColor(state: StepState) {
  switch (state) {
    case 'active': return 'border-white'
    case 'done':   return 'border-green-500'
    case 'stale':  return 'border-amber-500'
    case 'edit':   return 'border-red-600'
    default:       return 'border-zinc-700'
  }
}

function labelColor(state: StepState) {
  switch (state) {
    case 'active': return 'text-white font-bold'
    case 'done':   return 'text-zinc-500'
    case 'stale':  return 'text-amber-500'
    case 'edit':   return 'text-amber-500 font-semibold'
    default:       return 'text-zinc-700'
  }
}

function leftBorderColor(state: StepState) {
  switch (state) {
    case 'active': return 'border-l-[3px] border-l-white'
    case 'edit':   return 'border-l-[3px] border-l-red-600'
    default:       return 'border-l-[3px] border-l-transparent'
  }
}

function rowBg(state: StepState) {
  return state === 'active' ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
}

function RightIndicator({ state }: { state: StepState }) {
  if (state === 'done') return <span className="text-green-500 text-[11px]">✓</span>
  if (state === 'stale') return (
    <span className="px-1.5 py-0.5 bg-amber-500/20 border border-amber-500 rounded text-amber-500 text-[8px] flex items-center gap-0.5">
      ⚠
    </span>
  )
  if (state === 'edit') return <span className="text-amber-500 text-[11px]">✎</span>
  return null
}

export function LeftNav() {
  const { state, dispatch } = useApp()

  function handleStepClick(stepId: number) {
    const stepState = state.stepStates[stepId]
    if (stepState === 'locked') return
    if (stepState === 'done') {
      dispatch({ type: 'BACK_NAV_REQUEST', step: stepId })
    } else if (stepState === 'stale' || stepState === 'active') {
      dispatch({ type: 'SET_STEP', step: stepId })
    }
  }

  return (
    <nav className="w-[196px] bg-zinc-900 flex flex-col shrink-0 overflow-y-auto">
      <div className="px-3 pt-4 pb-2">
        <span className="text-zinc-600 text-[9px] font-semibold tracking-[0.1em] uppercase">Workflow</span>
      </div>

      {STEPS.map(step => {
        const stepState = state.stepStates[step.id]
        const isLocked = stepState === 'locked'

        return (
          <button
            key={step.id}
            onClick={() => handleStepClick(step.id)}
            disabled={isLocked}
            className={`
              flex items-center gap-3 px-2 py-0 h-[54px] w-full text-left
              ${leftBorderColor(stepState)} ${rowBg(stepState)}
              transition-colors disabled:cursor-not-allowed
            `}
          >
            {/* Number badge */}
            <div className={`
              w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center shrink-0
              bg-zinc-800 ${badgeBorderColor(stepState)}
            `}>
              <span className={`text-[9px] font-semibold ${labelColor(stepState)}`}>
                {step.id}
              </span>
            </div>

            {/* Label */}
            <span className={`text-[12px] truncate flex-1 ${labelColor(stepState)}`}>
              {step.label}
            </span>

            {/* Right indicator */}
            <RightIndicator state={stepState} />
          </button>
        )
      })}
    </nav>
  )
}
