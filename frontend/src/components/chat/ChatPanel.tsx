import { useState, useRef, useEffect } from 'react'
import { useApp } from '../../store/AppContext'
import { ChatMessage } from './ChatMessage'
import { buildResearchContext } from '../../lib/buildResearchContext'
import { resolveAction } from '../../lib/resolveAction'
import type { ProposedAction } from '../../types'
import { API } from '../../lib/api'


interface AssistantApiResponse {
  reply: string
  actions: Array<{
    type: string
    label: string
    detail?: string
    payload: Record<string, unknown>
  }>
}

async function callAssistantAPI(
  history: { role: string; content: string }[],
  newMessage: string,
  researchContext: object,
): Promise<AssistantApiResponse> {
  const res = await fetch(`${API}/chat/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: history,
      new_message: newMessage,
      research_context: researchContext,
    }),
  })
  if (!res.ok) throw new Error(`Assistant API error: ${res.status}`)
  return res.json()
}

export function ChatPanel() {
  const { state, dispatch } = useApp()
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Keep a ref to latest state for use inside callbacks
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.chatMessages])

  async function handleSend() {
    const text = input.trim()
    if (!text || isThinking) return

    setInput('')
    setError(null)
    setIsThinking(true)

    // Add user message to state
    dispatch({ type: 'SEND_MESSAGE', content: text })

    // Build history from existing chat messages (exclude proactive/UI messages)
    const history = state.chatMessages
      .filter(m => m.type === 'student' || m.type === 'assistant')
      .map(m => ({
        role: m.type === 'student' ? 'user' : 'assistant',
        content: m.content,
      }))

    // Build research context from current AppState
    const researchContext = buildResearchContext(state)

    try {
      const data = await callAssistantAPI(history, text, researchContext)
      const { reply, actions: rawActions } = data

      // Build ProposedAction list
      const proposedActions: ProposedAction[] = rawActions.map((a, i) => ({
        id: `pa-${Date.now()}-${i}`,
        type: a.type,
        label: a.label,
        detail: a.detail,
        payload: a.payload,
        status: 'pending' as const,
      }))

      const assistantMsgId = `assistant-${Date.now()}`
      const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

      if (proposedActions.length > 0) {
        // Insert reply as normal assistant message, then action_confirm card
        dispatch({
          type: 'ADD_CHAT_MESSAGE',
          message: {
            id: assistantMsgId,
            type: 'assistant',
            content: reply,
            timestamp: now,
          },
        })
        dispatch({
          type: 'ADD_CHAT_MESSAGE',
          message: {
            id: `actions-${Date.now()}`,
            type: 'action_confirm',
            content: '',
            timestamp: now,
            proposedActions,
          },
        })
      } else {
        // No actions — plain assistant reply
        dispatch({
          type: 'ADD_CHAT_MESSAGE',
          message: {
            id: assistantMsgId,
            type: 'assistant',
            content: reply,
            timestamp: now,
          },
        })
      }
    } catch (e) {
      setError('Failed to reach assistant. Make sure the backend is running.')
    } finally {
      setIsThinking(false)
    }
  }

  function handleApply(messageId: string, action: ProposedAction) {
    // Resolve the AI action to one or more AppActions and dispatch them
    const appActions = resolveAction(action, stateRef.current)
    appActions.forEach(a => dispatch(a))

    // Mark action as applied
    dispatch({ type: 'UPDATE_ACTION_STATUS', messageId, actionId: action.id, status: 'applied' })
  }

  function handleSkip(messageId: string, action: ProposedAction) {
    dispatch({ type: 'UPDATE_ACTION_STATUS', messageId, actionId: action.id, status: 'skipped' })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-7 bg-zinc-900 flex items-center px-3 gap-2 shrink-0">
        <span className="text-white text-[10px] font-bold">✦ Research Assistant</span>
        <div className={`w-1.5 h-1.5 rounded-full ml-auto ${isThinking ? 'bg-blue-400 animate-pulse' : 'bg-zinc-600'}`} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-white">
        {state.chatMessages.map(msg => (
          <ChatMessage
            key={msg.id}
            message={msg}
            onApply={action => handleApply(msg.id, action)}
            onSkip={action => handleSkip(msg.id, action)}
          />
        ))}

        {isThinking && (
          <div className="flex gap-1 items-center px-3 py-2 bg-zinc-100 rounded-xl w-14">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:300ms]" />
          </div>
        )}

        {error && (
          <div className="px-2 py-1.5 bg-red-50 border border-red-200 rounded text-[9px] text-red-500">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-2 pb-2 pt-1 bg-white border-t border-zinc-200 flex gap-1.5 shrink-0">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Ask anything or request a change..."
          disabled={isThinking}
          className="flex-1 h-[34px] bg-zinc-100 border border-zinc-300 rounded-md px-2 text-[12px] text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={isThinking || !input.trim()}
          className="w-[30px] h-[30px] bg-zinc-900 rounded-md flex items-center justify-center text-white hover:bg-zinc-700 transition-colors shrink-0 self-center disabled:opacity-40"
          aria-label="Send"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 10V2M2 6l4-4 4 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
