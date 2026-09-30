import { useState, useRef, useEffect } from 'react'
import { useApp } from '../store/AppContext'
import { ChatMessage } from '../components/chat/ChatMessage'
import { CustomizePromptModal } from '../components/shared/CustomizePromptModal'
import type { ResearchProfile, TopicCard } from '../types'
import { API, apiFetch } from '../lib/api'

const QUICK_STARTERS = [
  'Healthcare / AI',
  'Education',
  'Mental Health',
  'Climate & Health',
  'Mental Health Tech',
]

const PROFILE_FIELDS: { key: keyof ResearchProfile; label: string; required?: boolean }[] = [
  { key: 'domain',     label: 'Domain',      required: true },
  { key: 'population', label: 'Population' },
  { key: 'focus',      label: 'Focus',       required: true },
  { key: 'method',     label: 'Method' },
  { key: 'reviewType', label: 'Review type' },
]

async function callChatAPI(
  history: { role: string; content: string }[],
  newMessage: string,
): Promise<{ reply: string; profile_updates: Partial<ResearchProfile> }> {
  const res = await apiFetch(`${API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: history, new_message: newMessage }),
  })
  if (!res.ok) throw new Error(`Chat API error: ${res.status}`)
  return res.json()
}

async function callGenerateTopicsAPI(profile: ResearchProfile, customSystemPrompt?: string | null): Promise<{ topics: TopicCard[] }> {
  const res = await apiFetch(`${API}/topics/generate-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...profile, custom_system_prompt: customSystemPrompt ?? null }),
  })
  if (!res.ok) throw new Error(`Topics API error: ${res.status}`)
  return res.json()
}

export function Screen1() {
  const { state, dispatch } = useApp()
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [showChips, setShowChips] = useState(true)
  const [showPromptModal, setShowPromptModal] = useState(false)
  const [customPrompt, setCustomPrompt] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageSequenceRef = useRef(0)

  function nextMessageId() {
    messageSequenceRef.current += 1
    return `msg-${state.sessionId}-${messageSequenceRef.current}`
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.chatMessages])

  async function handleSend(text?: string) {
    const content = (text ?? input).trim()
    if (!content || isTyping) return
    setInput('')
    setShowChips(false)
    setIsTyping(true)

    dispatch({ type: 'SEND_MESSAGE', content })

    // Build history from existing messages for context
    const history = state.chatMessages
      .filter(m => m.type === 'student' || m.type === 'assistant')
      .map(m => ({
        role: m.type === 'student' ? 'user' : 'assistant',
        content: m.content,
      }))

    try {
      const data = await callChatAPI(history, content)

      dispatch({
        type: 'ADD_CHAT_MESSAGE',
        message: {
          id: nextMessageId(),
          type: 'assistant',
          content: data.reply,
          timestamp: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        },
      })

      const updates = data.profile_updates
      const fields: (keyof ResearchProfile)[] = ['domain', 'population', 'focus', 'method', 'reviewType']
      for (const field of fields) {
        const value = updates[field]
        if (value) {
          dispatch({ type: 'UPDATE_PROFILE', field, value })
        }
      }
    } catch {
      dispatch({
        type: 'ADD_CHAT_MESSAGE',
        message: {
          id: nextMessageId(),
          type: 'assistant',
          content: 'Sorry, I had trouble connecting. Please check that the backend is running.',
          timestamp: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        },
      })
    } finally {
      setIsTyping(false)
    }
  }

  const canGenerate = !!state.profile.domain.trim() && !!state.profile.focus.trim()

  async function handleGenerateTopics(prompt?: string | null) {
    if (!canGenerate || isGenerating) return
    setIsGenerating(true)
    try {
      const data = await callGenerateTopicsAPI(state.profile, prompt)
      dispatch({ type: 'SET_TOPICS', topics: data.topics })
      dispatch({ type: 'ADVANCE_STEP' })
    } catch {
      // keep on screen1 if API fails, user can retry
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="flex h-full">
      {/* Chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header bar */}
        <div className="h-12 bg-zinc-50 border-b border-zinc-200 flex items-center px-4 gap-3 shrink-0">
          <div className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center text-white text-[13px] shrink-0">
            ✦
          </div>
          <div className="flex flex-col">
            <span className="text-[14px] font-bold text-zinc-900 leading-tight">Research Assistant</span>
            <span className="text-[11px] text-zinc-500 leading-tight">
              I'll help you build your research topic through conversation
            </span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {state.chatMessages.map(msg => (
            <ChatMessage key={msg.id} message={msg} />
          ))}

          {/* Quick-starter chips */}
          {showChips && (
            <div className="flex flex-wrap gap-2 pt-1">
              {QUICK_STARTERS.map(chip => (
                <button
                  key={chip}
                  onClick={() => handleSend(chip)}
                  className="px-3 py-1 bg-zinc-100 border border-zinc-300 rounded-full text-[11px] text-zinc-700 hover:bg-zinc-200 transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
          )}

          {/* Typing indicator */}
          {isTyping && (
            <div className="flex gap-1 items-center px-3 py-2 bg-zinc-100 rounded-xl w-14">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:300ms]" />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="h-[60px] border-t border-zinc-200 bg-white flex items-center px-4 gap-2 shrink-0">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Tell me about your research interest..."
            disabled={isTyping}
            className="flex-1 h-9 bg-zinc-50 border border-zinc-300 rounded-lg px-3 text-[13px] text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-500 disabled:opacity-50"
          />
          <button
            onClick={() => handleSend()}
            disabled={isTyping}
            className="w-9 h-9 bg-zinc-900 rounded-lg flex items-center justify-center text-white hover:bg-zinc-700 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Send"
          >
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
              <path d="M6 10V2M2 6l4-4 4 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Research Profile panel */}
      <aside className="w-[220px] shrink-0 bg-zinc-50 border-l border-zinc-200 flex flex-col">
        {/* Header */}
        <div className="px-3 pt-4 pb-2 shrink-0">
          <div className="text-[9px] text-zinc-400 font-semibold uppercase tracking-widest">
            Research Profile
          </div>
          <div className="text-[8px] italic text-zinc-400 mt-0.5">Fills as you chat →</div>
        </div>

        {/* Field cards */}
        <div className="flex flex-col gap-1.5 px-2 flex-1 overflow-y-auto">
          {PROFILE_FIELDS.map(field => {
            const value = state.profile[field.key]
            return (
              <div
                key={field.key}
                className={`h-[52px] bg-white rounded px-2 flex flex-col justify-center border ${field.required && !value ? 'border-zinc-400 border-dashed' : 'border-zinc-200'}`}
              >
                <span className="text-[8px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                  {field.label}
                  {field.required && <span className="text-zinc-400">*</span>}
                </span>
                <span className={`text-[11px] truncate mt-0.5 ${value ? 'text-zinc-900 font-medium' : 'text-zinc-300 italic'}`}>
                  {value || 'Not yet defined'}
                </span>
              </div>
            )
          })}
        </div>

        {/* Completeness indicator */}
        <div className="px-2 pt-3 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] text-zinc-400 uppercase tracking-wide">Profile</span>
            <span className="text-[9px] text-zinc-500 font-medium">{state.profileCompleteness}%</span>
          </div>
          <div className="h-1 bg-zinc-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-zinc-700 rounded-full transition-all duration-500"
              style={{ width: `${state.profileCompleteness}%` }}
            />
          </div>
        </div>

        {/* Next step — generates the topics and moves on to the matrix schema */}
        <div className="px-2 pb-4 pt-3 shrink-0">
          <div className={`flex rounded overflow-hidden border ${canGenerate && !isGenerating ? 'border-zinc-700' : 'border-zinc-200'}`}>
            <button
              disabled={!canGenerate || isGenerating}
              onClick={() => handleGenerateTopics(customPrompt)}
              className={`flex-1 h-[38px] text-[12px] font-semibold transition-colors flex items-center justify-center gap-2 ${
                canGenerate && !isGenerating
                  ? 'bg-zinc-900 text-white hover:bg-zinc-700 cursor-pointer'
                  : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
              }`}
            >
              {isGenerating ? (
                <>
                  Generating…
                </>
              ) : (
                <>
                  {customPrompt && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                  Next step →
                </>
              )}
            </button>
            <button
              disabled={!canGenerate || isGenerating}
              onClick={() => setShowPromptModal(true)}
              title="Customize AI prompt"
              className={`w-8 h-[38px] border-l flex items-center justify-center text-[11px] transition-colors ${
                canGenerate && !isGenerating
                  ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-600 border-zinc-700 cursor-pointer'
                  : 'bg-zinc-200 text-zinc-300 border-zinc-200 cursor-not-allowed'
              }`}
            >
              ⚙
            </button>
          </div>
          {!canGenerate && !isGenerating && (
            <p className="text-[8px] italic text-zinc-400 text-center mt-1.5">
              (requires Domain + Focus)
            </p>
          )}
        </div>

        {showPromptModal && (
          <CustomizePromptModal
            promptKey="topics-generate"
            title="Generate Topics"
            initialCustomPrompt={customPrompt}
            onClose={() => setShowPromptModal(false)}
            onGenerate={(prompt) => {
              setCustomPrompt(prompt)
              setShowPromptModal(false)
              handleGenerateTopics(prompt)
            }}
          />
        )}
      </aside>
    </div>
  )
}
