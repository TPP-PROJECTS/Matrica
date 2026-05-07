import type { AppState, SessionMeta, SessionSnapshot } from '../types'

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
    // Step 2
    systemItems: state.systemItems,
    // Step 3
    topics: state.topics,
    queries: state.queries,
    // Step 4
    results: state.results,
    reviewList: state.reviewList,
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
    rqOptions: state.rqOptions,
    selectedRQId: state.selectedRQId,
    // Step 8
    studyDesignOptions: state.studyDesignOptions,
    selectedStudyDesignId: state.selectedStudyDesignId,
    finalTopicOptions: state.finalTopicOptions,
    topicFinalData: state.topicFinalData,
    selectedFinalTopicId: state.selectedFinalTopicId,
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
  try {
    const now = new Date().toISOString()
    const snapshot: SessionSnapshot = { ...toSnapshot(state), updatedAt: now }
    localStorage.setItem(sessionKey(state.sessionId), JSON.stringify(snapshot))

    const index = listSessions()
    const meta = buildMeta(state, now)
    const updated = [meta, ...index.filter(m => m.id !== state.sessionId)]
    localStorage.setItem(INDEX_KEY, JSON.stringify(updated))
  } catch (e) {
    console.warn('Failed to save session:', e)
  }
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
    console.warn('Failed to delete session:', e)
  }
}

export function getMostRecentSessionId(): string | null {
  return listSessions()[0]?.id ?? null
}
