import { aiLabelFor, beginAiRequest } from './aiActivity'

export const API =(import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8001/api'

// ── Session ID singleton ──────────────────────────────────────────────────────
// Set by AppContext on mount and whenever the session changes.

let _sessionId = ''

export function setAnalyticsSession(id: string): void {
  _sessionId = id
}

// ── Instrumented fetch ────────────────────────────────────────────────────────
// Drop-in replacement for fetch() that injects the session ID header.

export async function apiFetch(
  url: string,
  init: RequestInit & { aiBackground?: boolean } = {},
): Promise<Response> {
  const { aiBackground, ...rest } = init
  const headers = new Headers(rest.headers)
  if (_sessionId) headers.set('X-Session-Id', _sessionId)
  const label = aiLabelFor(url, API)
  if (!label) return fetch(url, { ...rest, headers })
  // None of the AI endpoints stream: the response only starts once the model
  // has finished, so the wait is over when the headers arrive.
  const { signal, end } = beginAiRequest(label, { background: aiBackground, signal: rest.signal })
  try {
    return await fetch(url, { ...rest, headers, signal })
  } finally {
    end()
  }
}

// ── Fire-and-forget event tracker ─────────────────────────────────────────────
// Sends an explicit lifecycle event (step_change, heartbeat, session_start)
// to the analytics endpoint. Never throws.

export function trackEvent(
  eventType: string,
  data: Record<string, unknown> = {},
): void {
  if (!_sessionId) return
  apiFetch(`${API}/analytics/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: _sessionId, event_type: eventType, ...data }),
  }).catch(() => {})
}
