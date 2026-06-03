import { useEffect, useState, useCallback } from 'react'
import { API } from '../lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Overview {
  total_sessions: number
  completed_sessions: number
  completion_rate_pct: number
  active_last_hour: number
  total_api_calls: number
  error_calls: number
  error_rate_pct: number
  avg_step_reached: number
}

interface FunnelRow {
  step: number
  sessions_stopped_here: number
  sessions_reached: number
  reached_pct: number
}

interface StepTiming {
  step: number
  transitions: number
  avg_seconds: number
  min_seconds: number
  max_seconds: number
  back_navs: number
}

interface Session {
  id: string
  started_at: number
  last_seen_at: number
  max_step: number
  current_step: number
  domain: string | null
  user_agent: string | null
  event_count: number
  error_count: number
  api_calls: number
  heartbeats: number
}

interface StuckSession extends Session {
  idle_minutes: number
}

interface RegenerationRow {
  session_id: string
  endpoint: string
  call_count: number
  first_call: number
  last_call: number
}

interface SessionEvent {
  id: number
  session_id: string
  ts: number
  step: number | null
  event_type: string
  endpoint: string | null
  method: string | null
  status_code: number | null
  duration_ms: number | null
  detail: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<number, string> = {
  1: 'Chat & Define',
  2: 'System Review',
  3: 'Explore & Search',
  4: 'Select Papers',
  5: 'Matrix',
  6: 'Synthesis',
  7: 'Gap & Statement',
  8: 'Final Question',
}

function tsToTime(ts: number) {
  return new Date(ts * 1000).toLocaleString()
}

function ago(ts: number) {
  const diff = Math.floor((Date.now() / 1000) - ts)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function fmtDuration(sec: number) {
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
}

function endpointLabel(ep: string) {
  return ep.replace('/api/', '').replace(/-/g, ' ')
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'text-white' }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div className="bg-zinc-800 rounded-lg p-4 flex flex-col gap-1">
      <span className="text-zinc-400 text-[11px] uppercase tracking-wide">{label}</span>
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
      {sub && <span className="text-zinc-500 text-[11px]">{sub}</span>}
    </div>
  )
}

// ── Session detail drawer ─────────────────────────────────────────────────────

function SessionDetail({ session, onClose }: { session: Session; onClose: () => void }) {
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/analytics/sessions/${session.id}`)
      .then(r => r.json())
      .then(d => setEvents(d.events ?? []))
      .finally(() => setLoading(false))
  }, [session.id])

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-[540px] bg-zinc-900 flex flex-col h-full shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700">
          <div>
            <div className="text-white text-sm font-semibold truncate max-w-[380px]">{session.id}</div>
            <div className="text-zinc-400 text-[11px] mt-0.5">
              {session.domain || 'No domain'} · Started {tsToTime(session.started_at)}
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-lg leading-none">×</button>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-4 gap-px border-b border-zinc-700 bg-zinc-700">
          {[
            { label: 'Max step', value: `Step ${session.max_step}` },
            { label: 'Events', value: session.event_count },
            { label: 'API calls', value: session.api_calls },
            { label: 'Errors', value: session.error_count, red: session.error_count > 0 },
          ].map(({ label, value, red }) => (
            <div key={label} className="bg-zinc-800 px-3 py-2 text-center">
              <div className={`text-sm font-bold ${red ? 'text-red-400' : 'text-white'}`}>{value}</div>
              <div className="text-zinc-500 text-[10px]">{label}</div>
            </div>
          ))}
        </div>

        {/* Event log */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-zinc-500 text-sm text-center mt-8">Loading…</div>
          ) : events.length === 0 ? (
            <div className="text-zinc-500 text-sm text-center mt-8">No events</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-700">
                <tr>
                  {['Time', 'Type', 'Endpoint', 'Step', 'Status', 'ms'].map(h => (
                    <th key={h} className="text-left text-zinc-500 px-3 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map(ev => (
                  <tr key={ev.id} className="border-b border-zinc-800 hover:bg-zinc-800/50">
                    <td className="px-3 py-1.5 text-zinc-500 whitespace-nowrap">{ago(ev.ts)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        ev.event_type === 'api_call'    ? 'bg-blue-900/50 text-blue-300' :
                        ev.event_type === 'step_change' ? 'bg-green-900/50 text-green-300' :
                        ev.event_type === 'heartbeat'   ? 'bg-zinc-700 text-zinc-400' :
                        'bg-purple-900/50 text-purple-300'
                      }`}>
                        {ev.event_type}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-zinc-300 max-w-[140px] truncate" title={ev.endpoint ?? ''}>
                      {ev.endpoint ? endpointLabel(ev.endpoint) : (
                        ev.detail ? (() => {
                          try {
                            const d = JSON.parse(ev.detail)
                            return d.from_step != null ? `step ${d.from_step} → ${d.to_step}` : ev.event_type
                          } catch { return ev.event_type }
                        })() : '—'
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-400">{ev.step ?? '—'}</td>
                    <td className="px-3 py-1.5">
                      {ev.status_code ? (
                        <span className={ev.status_code >= 400 ? 'text-red-400' : 'text-green-400'}>
                          {ev.status_code}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-500">
                      {ev.duration_ms != null ? Math.round(ev.duration_ms) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export function AnalyticsDashboard() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [funnel, setFunnel] = useState<FunnelRow[]>([])
  const [timings, setTimings] = useState<StepTiming[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [stuck, setStuck] = useState<StuckSession[]>([])
  const [regen, setRegen] = useState<RegenerationRow[]>([])
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(Date.now())

  const fetchAll = useCallback(async () => {
    try {
      const [ov, fn, ti, se, st, re] = await Promise.all([
        fetch(`${API}/analytics/overview`).then(r => r.json()),
        fetch(`${API}/analytics/funnel`).then(r => r.json()),
        fetch(`${API}/analytics/step-timings`).then(r => r.json()),
        fetch(`${API}/analytics/sessions`).then(r => r.json()),
        fetch(`${API}/analytics/stuck`).then(r => r.json()),
        fetch(`${API}/analytics/regeneration`).then(r => r.json()),
      ])
      setOverview(ov)
      setFunnel(fn)
      setTimings(ti)
      setSessions(se)
      setStuck(st)
      setRegen(re)
      setLastRefresh(Date.now())
    } catch (e) {
      console.error('Analytics fetch failed', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 30_000)
    return () => clearInterval(interval)
  }, [fetchAll])

  const maxReached = funnel[0]?.sessions_reached ?? 1

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans">
      {/* Top bar */}
      <header className="h-12 bg-zinc-900 border-b border-zinc-800 flex items-center px-6 gap-4 sticky top-0 z-10">
        <span className="text-white font-bold text-sm tracking-tight">ResearchAI</span>
        <div className="w-px h-4 bg-zinc-700" />
        <span className="text-zinc-400 text-sm">Analytics</span>
        <div className="flex-1" />
        <span className="text-zinc-600 text-[11px]">
          Last refreshed {new Date(lastRefresh).toLocaleTimeString()} · auto-refresh 30s
        </span>
        <button
          onClick={fetchAll}
          className="px-3 py-1 border border-zinc-700 rounded text-zinc-400 text-[11px] hover:border-zinc-500 hover:text-white transition-colors"
        >
          Refresh
        </button>
        <a
          href="#"
          className="px-3 py-1 border border-zinc-600 rounded text-zinc-300 text-[11px] hover:border-zinc-400 hover:text-white transition-colors"
        >
          ← Back to app
        </a>
      </header>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-zinc-500">Loading analytics…</div>
      ) : (
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-10">

          {/* Overview stats */}
          <section>
            <h2 className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Overview</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Total sessions" value={overview?.total_sessions ?? 0} />
              <StatCard
                label="Completed"
                value={`${overview?.completed_sessions ?? 0}`}
                sub={`${overview?.completion_rate_pct ?? 0}% completion rate`}
                color="text-green-400"
              />
              <StatCard
                label="Avg step reached"
                value={overview?.avg_step_reached ?? 0}
                sub="out of 8 steps"
              />
              <StatCard
                label="Active (1h)"
                value={overview?.active_last_hour ?? 0}
                sub={`${overview?.error_rate_pct ?? 0}% API error rate`}
                color={overview && overview.error_rate_pct > 10 ? 'text-red-400' : 'text-white'}
              />
            </div>
          </section>

          {/* Funnel + Step timings side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Funnel */}
            <section>
              <h2 className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Step funnel</h2>
              <div className="bg-zinc-800 rounded-lg p-4 space-y-2">
                {funnel.length === 0 ? (
                  <p className="text-zinc-500 text-sm">No data yet</p>
                ) : (
                  Array.from({ length: 8 }, (_, i) => i + 1).map(step => {
                    const row = funnel.find(f => f.step === step)
                    const reached = row?.sessions_reached ?? 0
                    const stopped = row?.sessions_stopped_here ?? 0
                    const pct = maxReached > 0 ? (reached / maxReached) * 100 : 0
                    return (
                      <div key={step} className="flex items-center gap-3">
                        <span className="text-zinc-500 text-[11px] w-4 shrink-0">{step}</span>
                        <span className="text-zinc-300 text-[11px] w-32 shrink-0 truncate">
                          {STEP_LABELS[step]}
                        </span>
                        <div className="flex-1 bg-zinc-700 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-zinc-300 text-[11px] w-6 text-right shrink-0">{reached}</span>
                        {stopped > 0 && (
                          <span className="text-red-400 text-[10px] w-14 shrink-0">−{stopped} left</span>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </section>

            {/* Step timings */}
            <section>
              <h2 className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Time per step</h2>
              <div className="bg-zinc-800 rounded-lg overflow-hidden">
                {timings.length === 0 ? (
                  <p className="text-zinc-500 text-sm p-4">No transitions recorded yet</p>
                ) : (
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-zinc-700">
                        {['Step', 'Avg', 'Min', 'Max', 'Back-navs'].map(h => (
                          <th key={h} className="text-left text-zinc-500 px-3 py-2 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {timings.map(t => (
                        <tr key={t.step} className="border-b border-zinc-700/50 hover:bg-zinc-700/30">
                          <td className="px-3 py-2 text-zinc-300">
                            {t.step} · {STEP_LABELS[t.step] ?? `Step ${t.step}`}
                          </td>
                          <td className="px-3 py-2 text-white font-medium">{fmtDuration(t.avg_seconds)}</td>
                          <td className="px-3 py-2 text-zinc-400">{fmtDuration(t.min_seconds)}</td>
                          <td className="px-3 py-2 text-zinc-400">{fmtDuration(t.max_seconds)}</td>
                          <td className="px-3 py-2">
                            {t.back_navs > 0
                              ? <span className="text-amber-400">{t.back_navs}×</span>
                              : <span className="text-zinc-600">—</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </div>

          {/* Stuck sessions */}
          {stuck.length > 0 && (
            <section>
              <h2 className="text-xs text-zinc-500 uppercase tracking-widest mb-3">
                Stuck sessions
                <span className="ml-2 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded text-[10px] normal-case">
                  {stuck.length} idle &gt;15 min
                </span>
              </h2>
              <div className="bg-zinc-800 rounded-lg overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-zinc-700">
                      {['Session', 'Domain', 'Stuck at', 'Idle', 'API calls'].map(h => (
                        <th key={h} className="text-left text-zinc-500 px-3 py-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stuck.map(s => (
                      <tr
                        key={s.id}
                        className="border-b border-zinc-700/50 hover:bg-zinc-700/30 cursor-pointer"
                        onClick={() => setSelectedSession(s)}
                      >
                        <td className="px-3 py-2 text-zinc-300 font-mono">{s.id.slice(0, 18)}…</td>
                        <td className="px-3 py-2 text-zinc-400">{s.domain || '—'}</td>
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 bg-amber-900/40 text-amber-300 rounded">
                            Step {s.max_step} · {STEP_LABELS[s.max_step]}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-amber-400">{s.idle_minutes}m</td>
                        <td className="px-3 py-2 text-zinc-400">{s.api_calls}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Regeneration (repeated AI calls) */}
          {regen.length > 0 && (
            <section>
              <h2 className="text-xs text-zinc-500 uppercase tracking-widest mb-3">
                Repeated generation
                <span className="ml-2 text-zinc-500 text-[10px] normal-case font-normal">
                  same AI endpoint called ≥ 3 times — indicates dissatisfaction
                </span>
              </h2>
              <div className="bg-zinc-800 rounded-lg overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-zinc-700">
                      {['Session', 'Endpoint', 'Calls', 'First', 'Last'].map(h => (
                        <th key={h} className="text-left text-zinc-500 px-3 py-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {regen.map((r, i) => (
                      <tr key={i} className="border-b border-zinc-700/50 hover:bg-zinc-700/30">
                        <td className="px-3 py-2 text-zinc-300 font-mono">{r.session_id.slice(0, 18)}…</td>
                        <td className="px-3 py-2 text-zinc-300">{endpointLabel(r.endpoint)}</td>
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 bg-red-900/40 text-red-300 rounded font-bold">
                            {r.call_count}×
                          </span>
                        </td>
                        <td className="px-3 py-2 text-zinc-500">{ago(r.first_call)}</td>
                        <td className="px-3 py-2 text-zinc-500">{ago(r.last_call)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* All sessions */}
          <section>
            <h2 className="text-xs text-zinc-500 uppercase tracking-widest mb-3">
              All sessions ({sessions.length})
            </h2>
            <div className="bg-zinc-800 rounded-lg overflow-hidden">
              {sessions.length === 0 ? (
                <p className="text-zinc-500 text-sm p-4">No sessions recorded yet. Use the app to generate data.</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-zinc-700">
                      {['Session', 'Domain', 'Max step', 'Events', 'Errors', 'Last seen'].map(h => (
                        <th key={h} className="text-left text-zinc-500 px-3 py-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map(s => (
                      <tr
                        key={s.id}
                        className="border-b border-zinc-700/50 hover:bg-zinc-700/30 cursor-pointer"
                        onClick={() => setSelectedSession(s)}
                      >
                        <td className="px-3 py-2 text-zinc-300 font-mono">{s.id.slice(0, 20)}…</td>
                        <td className="px-3 py-2 text-zinc-400">{s.domain || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            s.max_step === 8 ? 'bg-green-900/40 text-green-300' :
                            s.max_step >= 5 ? 'bg-blue-900/40 text-blue-300' :
                            'bg-zinc-700 text-zinc-400'
                          }`}>
                            {s.max_step === 8 ? '✓ Complete' : `Step ${s.max_step}`}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-zinc-400">{s.event_count}</td>
                        <td className="px-3 py-2">
                          {s.error_count > 0
                            ? <span className="text-red-400">{s.error_count}</span>
                            : <span className="text-zinc-600">—</span>
                          }
                        </td>
                        <td className="px-3 py-2 text-zinc-500">{ago(s.last_seen_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

        </div>
      )}

      {/* Session detail drawer */}
      {selectedSession && (
        <SessionDetail session={selectedSession} onClose={() => setSelectedSession(null)} />
      )}
    </div>
  )
}
