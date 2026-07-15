import type { ProposedAction } from '../../types'

interface Props {
  action: ProposedAction
  onApply: (action: ProposedAction) => void
  onSkip: (action: ProposedAction) => void
}

const STATUS_ICONS = {
  pending: null,
  applied: '✓',
  skipped: '✕',
  failed: '!',
}

const STATUS_CLASSES = {
  pending: 'bg-white border-zinc-200',
  applied: 'bg-green-50 border-green-300',
  skipped: 'bg-zinc-50 border-zinc-200 opacity-60',
  failed: 'bg-red-50 border-red-300',
}

export function ActionConfirmCard({ action, onApply, onSkip }: Props) {
  const statusIcon = STATUS_ICONS[action.status]
  const cardClass = STATUS_CLASSES[action.status]

  const iconBg = action.status === 'failed' ? 'bg-red-500' : 'bg-zinc-900'

  return (
    <div className={`border rounded-lg px-3 py-2 text-[12px] transition-colors ${cardClass}`}>
      <div className="flex items-center gap-2">
        {/* Icon / status badge */}
        <div className={`shrink-0 w-6 h-6 rounded-md ${iconBg} flex items-center justify-center text-white text-[10px] font-bold`}>
          {statusIcon ?? '✦'}
        </div>

        {/* Label + detail */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-zinc-800 leading-tight truncate">{action.label}</p>
          {action.detail && (
            <p className="text-zinc-500 text-[11px] leading-tight truncate">{action.detail}</p>
          )}
        </div>

        {/* Buttons — shown when pending or failed (retry) */}
        {(action.status === 'pending' || action.status === 'failed') && (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => onSkip(action)}
              className="h-6 px-2 text-[11px] rounded border border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 transition-colors"
            >
              {action.status === 'failed' ? 'Dismiss' : 'Skip'}
            </button>
            <button
              onClick={() => onApply(action)}
              className="h-6 px-2 text-[11px] rounded bg-zinc-900 text-white hover:bg-zinc-700 transition-colors"
            >
              {action.status === 'failed' ? 'Retry' : 'Apply'}
            </button>
          </div>
        )}

        {/* Applied / skipped label */}
        {action.status === 'applied' && (
          <span className="shrink-0 text-[11px] font-semibold text-green-600">Applied</span>
        )}
        {action.status === 'skipped' && (
          <span className="shrink-0 text-[11px] text-zinc-400">Skipped</span>
        )}
      </div>

      {/* Failure reason */}
      {action.status === 'failed' && action.note && (
        <p className="text-[11px] text-red-600 mt-1.5 pl-8 leading-snug">{action.note}</p>
      )}
    </div>
  )
}
