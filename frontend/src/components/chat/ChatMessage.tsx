import type { ChatMessage as ChatMessageType, ProposedAction } from '../../types'
import { useApp } from '../../store/AppContext'
import { ActionConfirmCard } from './ActionConfirmCard'

interface Props {
  message: ChatMessageType
  onApply?: (action: ProposedAction) => void
  onSkip?: (action: ProposedAction) => void
}

export function ChatMessage({ message, onApply, onSkip }: Props) {
  const { dispatch } = useApp()

  if (message.type === 'student') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-zinc-900 text-white text-[13px] rounded-xl rounded-br-sm px-3 py-2">
          {message.content}
        </div>
      </div>
    )
  }

  if (message.type === 'action_confirm') {
    const actions = message.proposedActions ?? []
    if (actions.length === 0) return null
    return (
      <div className="space-y-1.5">
        {actions.map(action => (
          <ActionConfirmCard
            key={action.id}
            action={action}
            onApply={a => onApply?.(a)}
            onSkip={a => onSkip?.(a)}
          />
        ))}
      </div>
    )
  }

  if (message.type === 'proactive') {
    return (
      <div className="relative">
        <div className="bg-blue-50 border-2 border-blue-400 rounded-xl px-3 py-2 text-[13px] text-zinc-800">
          {message.isNew && (
            <span className="absolute -top-2 right-2 bg-blue-500 text-white text-[8px] font-bold px-2 py-0.5 rounded-full">
              NEW
            </span>
          )}
          <p>{message.content}</p>
          {message.actionButtons && (
            <div className="flex gap-2 mt-2">
              {message.actionButtons.map(btn => (
                <button
                  key={btn.action}
                  className="px-2 py-1 text-[11px] rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                >
                  {btn.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (message.type === 'command') {
    return (
      <div className="bg-amber-50 border border-amber-400 rounded-xl px-3 py-2 text-[13px] text-zinc-800">
        <p>{message.content}</p>
        {message.actionButtons && (
          <div className="flex gap-2 mt-2">
            {message.actionButtons.map(btn => (
              <button key={btn.action} className="px-3 py-1 text-[11px] rounded bg-zinc-900 text-white hover:bg-zinc-700 transition-colors">
                {btn.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (message.type === 'ask_about_this') {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-[13px]">
        {message.elementRef && (
          <p className="text-[11px] text-blue-600 italic mb-1">{message.elementRef}</p>
        )}
        <p className="text-zinc-800">{message.content}</p>
      </div>
    )
  }

  if (message.type === 'mirror') {
    return (
      <div className="relative bg-zinc-100 border border-zinc-200 rounded-xl px-3 py-2 pl-5 text-[13px] text-zinc-700 italic">
        <p>{message.content}</p>
        {message.isDismissable && (
          <button
            onClick={() => dispatch({ type: 'DISMISS_MESSAGE', messageId: message.id })}
            className="absolute top-1.5 right-2 text-zinc-400 hover:text-zinc-600 text-[11px]"
            aria-label="Dismiss"
          >
            ✕
          </button>
        )}
      </div>
    )
  }

  if (message.type === 'stuck') {
    return (
      <div className="bg-teal-50 border border-teal-400 rounded-xl px-3 py-2 text-[13px] text-zinc-800">
        <p>{message.content}</p>
        {message.actionButtons && (
          <div className="flex gap-2 mt-2">
            {message.actionButtons.map(btn => (
              <button key={btn.action} className="px-2 py-1 text-[11px] rounded border border-teal-500 text-teal-700 hover:bg-teal-100 transition-colors">
                {btn.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // default: assistant
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] bg-zinc-100 text-zinc-900 text-[13px] rounded-xl rounded-bl-sm px-3 py-2 whitespace-pre-wrap">
        {message.content}
      </div>
    </div>
  )
}
