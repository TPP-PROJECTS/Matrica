import { useApp } from '../../store/AppContext'
import { ChatPanel } from '../chat/ChatPanel'

const SESSION_CARDS = [
  { key: 'topic',   label: 'Current Topic' },
  { key: 'papers',  label: 'Papers Selected' },
  { key: 'queries', label: 'Queries Confirmed' },
  { key: 'topics',  label: 'Topics Selected' },
]

export function RightPanel() {
  const { state } = useApp()

  const selectedTopicsCount = state.topics.filter(t => t.selected).length
  const includedPapers = state.reviewList.filter(r => r.status === 'included').length
  const confirmedQueries = state.queries.filter(q => !q.stale).length

  const sessionValues: Record<string, string> = {
    topic:   state.profile.domain || '—',
    papers:  includedPapers > 0 ? `${includedPapers} included` : '—',
    queries: confirmedQueries > 0 ? `${confirmedQueries} confirmed` : '—',
    topics:  selectedTopicsCount > 0 ? `${selectedTopicsCount} selected` : '—',
  }

  return (
    <aside className="w-[260px] h-full flex flex-col border-l border-zinc-200 shrink-0 bg-zinc-50 overflow-hidden">
      {/* Session Context — natural height, won't shrink */}
      <div className="shrink-0 p-3 border-b border-zinc-200">
        <div className="mb-2">
          <span className="text-zinc-400 text-[9px] font-semibold tracking-[0.1em] uppercase">Session</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {SESSION_CARDS.map(card => (
            <div
              key={card.key}
              className="h-[46px] bg-white border border-zinc-200 rounded px-2 flex flex-col justify-center"
            >
              <span className="text-[8px] font-semibold text-zinc-400 uppercase tracking-[0.08em]">
                {card.label}
              </span>
              <span className={`text-[12px] font-medium truncate ${sessionValues[card.key] === '—' ? 'text-zinc-400' : 'text-zinc-950'}`}>
                {sessionValues[card.key]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Chat — fills remaining height */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <ChatPanel />
      </div>
    </aside>
  )
}
