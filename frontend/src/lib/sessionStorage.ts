import type { AppState, SessionMeta, SessionSnapshot } from '../types'
import { API, apiFetch } from './api'

const PREFIX = 'tpp'
const INDEX_KEY = `${PREFIX}:sessions`

export function sessionKey(id: string) {
  return `${PREFIX}:session:${id}`
}

export function generateSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function toSnapshot(state: AppState): SessionSnapshot {
  return {
    sessionId: state.sessionId,
    sessionTitle: state.sessionTitle,
    createdAt: state.createdAt,
    updatedAt: new Date().toISOString(),
    currentStep: state.currentStep,
    staleSteps: state.staleSteps,
    // Step 1
    profile: state.profile,
    chatMessages: state.chatMessages,
    // Step 2 — Matrix Schema
    systemMatrixEnabled: state.systemMatrixEnabled,
    matrixColumnSuggestions: state.matrixColumnSuggestions,
    systemMatrixColumnSuggestions: state.systemMatrixColumnSuggestions,
    columnDescriptions: state.columnDescriptions,
    systemColumnDescriptions: state.systemColumnDescriptions,
    systemItems: state.systemItems,
    // Step 3
    topics: state.topics,
    queries: state.queries,
    // Step 4
    results: state.results,
    reviewList: state.reviewList,
    searchFilters: state.searchFilters,
    criteria: state.criteria,
    screening: state.screening,
    // Step 5
    matrixColumns: state.matrixColumns,
    matrixRows: state.matrixRows,
    systemMatrixColumns: state.systemMatrixColumns,
    systemMatrixRows: state.systemMatrixRows,
    // Step 6
    themes: state.themes,
    activeThemeId: state.activeThemeId,
    // Step 7
    gaps: state.gaps,
    gapStatement: state.gapStatement,
    axisGaps: state.axisGaps,
    rqOptions: state.rqOptions,
    selectedRQId: state.selectedRQId,
    // Step 8
    studyDesignOptions: state.studyDesignOptions,
    selectedStudyDesignId: state.selectedStudyDesignId,
    finalTopicOptions: state.finalTopicOptions,
    topicFinalData: state.topicFinalData,
    selectedFinalTopicId: state.selectedFinalTopicId,
    decisionJournal: state.decisionJournal,
  }
}

function buildMeta(state: AppState, updatedAt: string): SessionMeta {
  const selectedTopic = state.topics.find(t => t.selected)
  return {
    id: state.sessionId,
    title: state.sessionTitle || 'Untitled Session',
    createdAt: state.createdAt,
    updatedAt,
    currentStep: state.currentStep,
    topicPreview: selectedTopic?.title || state.profile.domain || '',
  }
}

export function saveSession(state: AppState): void {
  const now = new Date().toISOString()
  const snapshot: SessionSnapshot = { ...toSnapshot(state), updatedAt: now }
  try {
    localStorage.setItem(sessionKey(state.sessionId), JSON.stringify(snapshot))

    const index = listSessions()
    const meta = buildMeta(state, now)
    const updated = [meta, ...index.filter(m => m.id !== state.sessionId)]
    localStorage.setItem(INDEX_KEY, JSON.stringify(updated))
  } catch (e) {
    console.warn('Failed to save session locally:', e)
  }
  // Write through to the durable backend store (fire-and-forget; localStorage
  // above is the offline fallback if this fails).
  pushSessionRemote(snapshot)
}

export function loadSession(id: string): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(sessionKey(id))
    return raw ? (JSON.parse(raw) as SessionSnapshot) : null
  } catch {
    return null
  }
}

export function listSessions(): SessionMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    return raw ? (JSON.parse(raw) as SessionMeta[]) : []
  } catch {
    return []
  }
}

export function deleteSession(id: string): void {
  try {
    localStorage.removeItem(sessionKey(id))
    const updated = listSessions().filter(m => m.id !== id)
    localStorage.setItem(INDEX_KEY, JSON.stringify(updated))
  } catch (e) {
    console.warn('Failed to delete session locally:', e)
  }
  apiFetch(`${API}/projects/${id}`, { method: 'DELETE' }).catch(() => {})
}

export function getMostRecentSessionId(): string | null {
  return listSessions()[0]?.id ?? null
}

export function clearAllSessions(): void {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX + ':'))
    keys.forEach(k => localStorage.removeItem(k))
  } catch (e) {
    console.warn('Failed to clear sessions:', e)
  }
}

// ── Backend (durable) store ───────────────────────────────────────────────────
// The backend is the source of truth for the project list and cross-device /
// post-cache-clear recovery. localStorage above is a synchronous offline cache.

function pushSessionRemote(snapshot: SessionSnapshot): void {
  void pushSessionNow(snapshot).catch(() => {})
}

/**
 * Push a snapshot to the durable store and report whether it landed.
 *
 * The fire-and-forget path above is right for autosave, but some actions need
 * the project to actually exist server-side before they can proceed — sharing
 * it for peer review, above all, since a session the user has not yet modified
 * has never been pushed at all.
 */
export async function pushSessionNow(snapshot: SessionSnapshot): Promise<void> {
  const res = await apiFetch(`${API}/projects/${snapshot.sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
  if (!res.ok) throw new Error(`Could not save this project to the server (HTTP ${res.status})`)
}

/** Fetch the project list from the backend, falling back to localStorage. */
export async function fetchSessionsRemote(): Promise<SessionMeta[]> {
  try {
    const res = await apiFetch(`${API}/projects`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as SessionMeta[]
  } catch {
    return listSessions()
  }
}

/** Fetch a full snapshot from the backend, falling back to localStorage. */
export async function fetchSessionRemote(id: string): Promise<SessionSnapshot | null> {
  try {
    const res = await apiFetch(`${API}/projects/${id}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as SessionSnapshot
  } catch {
    return loadSession(id)
  }
}

/**
 * One-shot migration: push any locally-stored sessions that the backend
 * doesn't yet have. Runs once on app mount so pre-existing localStorage work
 * is preserved when the backend store is first introduced.
 */
export async function migrateLocalSessionsToRemote(): Promise<void> {
  const local = listSessions()
  if (local.length === 0) return
  try {
    const res = await apiFetch(`${API}/projects`)
    if (!res.ok) return
    const remote = (await res.json()) as SessionMeta[]
    const remoteIds = new Set(remote.map(m => m.id))
    for (const meta of local) {
      if (remoteIds.has(meta.id)) continue
      const snap = loadSession(meta.id)
      if (snap) pushSessionRemote(snap)
    }
  } catch {
    // Backend unreachable — nothing to migrate; localStorage remains the cache.
  }
}
