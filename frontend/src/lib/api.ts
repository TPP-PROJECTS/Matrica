export const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8001/api'

// ── Session ID singleton ──────────────────────────────────────────────────────
// Set by AppContext on mount and whenever the session changes.

let _sessionId = ''

export function setAnalyticsSession(id: string): void {
  _sessionId = id
}

// ── Instrumented fetch ────────────────────────────────────────────────────────
// Drop-in replacement for fetch() that injects the session ID header.

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (_sessionId) headers.set('X-Session-Id', _sessionId)
  return fetch(url, { ...init, headers })
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
