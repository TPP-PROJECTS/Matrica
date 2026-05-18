import { useState } from 'react'
import { useApp } from '../../store/AppContext'
import { ChatPanel } from '../chat/ChatPanel'
import { clearAllSessions } from '../../lib/sessionStorage'
import type { ResearchProfile } from '../../types'

const PROFILE_FIELDS: { key: keyof ResearchProfile; label: string; placeholder: string }[] = [
  { key: 'domain',     label: 'Research Domain', placeholder: 'e.g. Healthcare / AI' },
  { key: 'population', label: 'Population',       placeholder: 'e.g. Emergency clinicians' },
  { key: 'focus',      label: 'Focus',            placeholder: 'e.g. Diagnostic accuracy' },
  { key: 'method',     label: 'Method',           placeholder: 'e.g. Systematic review' },
  { key: 'reviewType', label: 'Review Type',      placeholder: 'e.g. Scoping review' },
]

const SESSION_STATS = [
  { key: 'systems',  label: 'Systems Selected' },
  { key: 'topics',   label: 'Topics Selected' },
  { key: 'queries',  label: 'Queries Confirmed' },
  { key: 'papers',   label: 'Papers Included' },
]

function ProfileField({ fieldDef }: { fieldDef: typeof PROFILE_FIELDS[number] }) {
  const { state, dispatch } = useApp()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const value = state.profile[fieldDef.key]

  function startEdit() {
    setDraft(value)
    setEditing(true)
  }

  function commit() {
    dispatch({ type: 'UPDATE_PROFILE', field: fieldDef.key, value: draft.trim() })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="min-h-[46px] bg-white border-2 border-blue-400 rounded px-2 py-1.5 flex flex-col justify-center">
        <span className="text-[8px] font-semibold text-blue-500 uppercase tracking-[0.08em]">
          {fieldDef.label}
        </span>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          placeholder={fieldDef.placeholder}
          className="text-[12px] font-medium text-zinc-900 bg-transparent outline-none leading-tight w-full placeholder:text-zinc-300"
        />
      </div>
    )
  }

  return (
    <button
      onClick={startEdit}
      title="Click to edit"
      className="min-h-[46px] bg-white border border-zinc-200 rounded px-2 py-1.5 flex flex-col justify-center w-full text-left hover:border-zinc-400 hover:bg-zinc-50 transition-colors group"
    >
      <span className="text-[8px] font-semibold text-zinc-400 uppercase tracking-[0.08em] group-hover:text-zinc-500">
        {fieldDef.label}
      </span>
      <span className={`text-[12px] font-medium leading-tight break-words ${!value ? 'text-zinc-300 italic' : 'text-zinc-950'}`}>
        {value || fieldDef.placeholder}
      </span>
    </button>
  )
}

export function RightPanel() {
  const { state, dispatch } = useApp()

  const selectedTopicsCount = state.topics.filter(t => t.selected).length
  const includedPapers = state.reviewList.filter(r => r.status === 'included').length
  const confirmedQueries = state.queries.filter(q => !q.stale).length
  const selectedSystems = state.systemItems.filter(s => s.selected).length

  const sessionValues: Record<string, string | null> = {
    systems: selectedSystems > 0 ? `${selectedSystems} selected` : null,
    topics:  selectedTopicsCount > 0 ? `${selectedTopicsCount} selected` : null,
    queries: confirmedQueries > 0 ? `${confirmedQueries} confirmed` : null,
    papers:  includedPapers > 0 ? `${includedPapers} included` : null,
  }

  const activeSessionStats = SESSION_STATS.filter(s => sessionValues[s.key] !== null)

  function handleResetAll() {
    if (!confirm('Reset all data and start over? This cannot be undone.')) return
    clearAllSessions()
    dispatch({ type: 'NEW_SESSION' })
  }

  return (
    <aside className="w-[300px] h-full flex flex-col border-l border-zinc-200 shrink-0 bg-zinc-50 overflow-hidden">
      {/* Profile + Session merged section */}
      <div className="shrink-0 p-3 border-b border-zinc-200 overflow-y-auto max-h-[60%]">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-zinc-400 text-[9px] font-semibold tracking-[0.1em] uppercase">Profile</span>
          <span className="text-zinc-300 text-[8px]">click to edit</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {PROFILE_FIELDS.map(field => (
            <ProfileField key={field.key} fieldDef={field} />
          ))}

          {activeSessionStats.length > 0 && (
            <>
              <div className="mt-2 mb-0.5">
                <span className="text-zinc-400 text-[9px] font-semibold tracking-[0.1em] uppercase">Session</span>
              </div>
              {activeSessionStats.map(stat => (
                <div
                  key={stat.key}
                  className="h-[46px] bg-white border border-zinc-200 rounded px-2 flex flex-col justify-center"
                >
                  <span className="text-[8px] font-semibold text-zinc-400 uppercase tracking-[0.08em]">
                    {stat.label}
                  </span>
                  <span className="text-[12px] font-medium truncate text-zinc-950">
                    {sessionValues[stat.key]}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        <button
          onClick={handleResetAll}
          className="mt-3 w-full text-[11px] text-zinc-400 hover:text-red-500 hover:bg-red-50 border border-zinc-200 hover:border-red-200 rounded px-2 py-1.5 transition-colors text-center"
        >
          Reset All
        </button>
      </div>

      {/* Chat — fills remaining height */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <ChatPanel />
      </div>
    </aside>
  )
}
