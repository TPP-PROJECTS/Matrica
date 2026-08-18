import type { AppState, SessionMeta, SessionSnapshot, VersionEntry } from '../types'
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
    // Step 5b — quality appraisal
    robToolId: state.robToolId,
    robAssessments: state.robAssessments,
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

/**
 * What actually happened to a save.
 *
 *   'saved'      — the work is durable (backend has it, local cache in step)
 *   'local-only' — backend unreachable; the browser copy is the only one, so
 *                  the work survives a reload but not a cleared cache
 *   'error'      — neither store accepted it; the work exists only in memory
 *
 * This used to be unconditional success: the local write was wrapped in a
 * try/catch that swallowed quota errors into a console warning, the backend
 * write was fire-and-forget, and the UI printed a green "Saved" either way. A
 * researcher could lose a full day's work with the indicator showing saved the
 * whole time.
 */
export type SaveOutcome = 'saved' | 'local-only' | 'error'

/** Persist to the local cache, evicting other sessions if we are out of room. */
function writeLocal(state: AppState, snapshot: SessionSnapshot, now: string): boolean {
  const attempt = (): void => {
    localStorage.setItem(sessionKey(state.sessionId), JSON.stringify(snapshot))
    const index = listSessions()
    const meta = buildMeta(state, now)
    localStorage.setItem(INDEX_KEY, JSON.stringify([meta, ...index.filter(m => m.id !== state.sessionId)]))
  }

  try {
    attempt()
    return true
  } catch {
    // Almost always the 5MB quota, and almost always because *other* sessions
    // are filling it. They are on the backend, so evicting the least recently
    // updated ones from the cache is lossless — and buys room for the session
    // the user is actually working in.
    const others = listSessions()
      .filter(m => m.id !== state.sessionId)
      .sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''))

    for (const stale of others) {
      try {
        localStorage.removeItem(sessionKey(stale.id))
        attempt()
        return true
      } catch {
        continue
      }
    }
    return false
  }
}

/**
 * Synchronous local-only write, for the last moment before the tab goes away.
 *
 * The normal save path is debounced and async, so closing the tab inside that
 * window would drop the most recent edits. `beforeunload` has no time for a
 * network round trip, but localStorage is synchronous and is enough to make the
 * work survive until the next load pushes it to the backend.
 */
export function flushSessionLocal(state: AppState): void {
  const now = new Date().toISOString()
  writeLocal(state, { ...toSnapshot(state), updatedAt: now }, now)
}

export async function saveSession(state: AppState): Promise<SaveOutcome> {
  const now = new Date().toISOString()
  const snapshot: SessionSnapshot = { ...toSnapshot(state), updatedAt: now }

  const localOk = writeLocal(state, snapshot, now)

  let remoteOk = true
  try {
    await pushSessionNow(snapshot)
  } catch {
    remoteOk = false
  }

  if (localOk) return remoteOk ? 'saved' : 'local-only'
  // Without a local copy a reload reads a stale snapshot, so even a successful
  // backend write does not make the browser tab safe to refresh.
  return 'error'
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

// ── Escape hatch ──────────────────────────────────────────────────────────────

/**
 * Hand the whole session to the user as a file.
 *
 * This is the recovery path when persistence has failed: whatever is wrong with
 * the quota or the backend, the work is still in memory and the user must be
 * able to get it out. It doubles as a plain "keep a copy" export.
 */
export function downloadSessionFile(state: AppState): void {
  const snapshot = toSnapshot(state)
  const safeTitle = (state.sessionTitle || 'session').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeTitle}-${snapshot.sessionId}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Parse a file produced by downloadSessionFile back into a snapshot. */
export async function readSessionFile(file: File): Promise<SessionSnapshot> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  const snap = parsed as Partial<SessionSnapshot>
  // Enough of a shape check to reject an unrelated JSON file with a clear
  // message, rather than loading it and failing somewhere deep in a screen.
  if (!snap || typeof snap.sessionId !== 'string' || typeof snap.profile !== 'object') {
    throw new Error('That file is not a session export from this tool.')
  }
  return snap as SessionSnapshot
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

// ── Version checkpoints ───────────────────────────────────────────────────────
//
// Checkpoints are stored server-side. A snapshot is the same size as the whole
// project, so keeping a history of them in localStorage would evict the working
// session — the very failure the save path above now has to recover from.

/** Take a checkpoint of the current state. Throws if the backend rejects it. */
export async function createVersion(
  state: AppState,
  label: string,
  trigger: VersionEntry['trigger'] = 'manual',
): Promise<VersionEntry> {
  const snapshot = toSnapshot(state)
  // A checkpoint of a project the backend has never seen would be an orphan,
  // so make sure the project itself is there first.
  await pushSessionNow(snapshot)

  const res = await apiFetch(`${API}/projects/${state.sessionId}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, trigger, snapshot }),
  })
  if (!res.ok) throw new Error(`Could not save a checkpoint (HTTP ${res.status})`)
  return (await res.json()) as VersionEntry
}

export async function listVersions(projectId: string): Promise<VersionEntry[]> {
  const res = await apiFetch(`${API}/projects/${projectId}/versions`)
  if (!res.ok) throw new Error(`Could not load checkpoints (HTTP ${res.status})`)
  return (await res.json()) as VersionEntry[]
}

export async function fetchVersion(projectId: string, versionId: string): Promise<SessionSnapshot> {
  const res = await apiFetch(`${API}/projects/${projectId}/versions/${versionId}`)
  if (!res.ok) throw new Error(`Could not load that checkpoint (HTTP ${res.status})`)
  return (await res.json()) as SessionSnapshot
}

export async function deleteVersion(projectId: string, versionId: string): Promise<void> {
  await apiFetch(`${API}/projects/${projectId}/versions/${versionId}`, { method: 'DELETE' })
}
