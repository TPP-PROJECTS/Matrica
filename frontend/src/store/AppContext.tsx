import { createContext, useContext, useReducer, useEffect, useRef, useState, type ReactNode } from 'react'
import { buildResearchContext } from '../lib/buildResearchContext'
import type { AppState, AppAction, ResearchProfile, StepState, SystemItem, SystemMatrixRow, SessionSnapshot } from '../types'
import {
  MOCK_TOPICS, MOCK_MATRIX_ROWS, MOCK_MATRIX_COLUMNS,
  MOCK_SYSTEM_MATRIX_COLUMNS, MOCK_SYSTEM_MATRIX_ROWS,
  MOCK_THEMES, MOCK_GAPS, MOCK_GAP_STATEMENT, MOCK_RQ_OPTIONS, MOCK_STUDY_DESIGNS,
  MOCK_PAPER_SECTIONS, MOCK_TOPIC_FINAL_DATA, INITIAL_CHAT_MESSAGES, MOCK_VERSION_HISTORY,
} from '../data/mockData'
import {
  generateSessionId, saveSession, loadSession, getMostRecentSessionId,
} from '../lib/sessionStorage'


const initialStepStates: Record<number, StepState> = {
  1: 'active', 2: 'locked', 3: 'locked', 4: 'locked', 5: 'locked', 6: 'locked', 7: 'locked', 8: 'locked',
}

function freshState(): AppState {
  const now = new Date().toISOString()
  return {
    sessionId: generateSessionId(),
    sessionTitle: '',
    createdAt: now,
    currentStep: 1,
    stepStates: initialStepStates,
    profile: { domain: '', population: '', focus: '', method: '', reviewType: '' },
    profileCompleteness: 0,
    topics: MOCK_TOPICS,
    systemItems: [],
    queries: [],
    results: [],
    reviewList: [],
    matrixRows: MOCK_MATRIX_ROWS,
    matrixColumns: MOCK_MATRIX_COLUMNS,
    systemMatrixRows: MOCK_SYSTEM_MATRIX_ROWS,
    systemMatrixColumns: MOCK_SYSTEM_MATRIX_COLUMNS,
    themes: MOCK_THEMES,
    activeThemeId: MOCK_THEMES[0]?.id ?? '',
    gaps: MOCK_GAPS,
    gapStatement: MOCK_GAP_STATEMENT,
    rqOptions: MOCK_RQ_OPTIONS,
    selectedRQId: MOCK_RQ_OPTIONS[0]?.id ?? null,
    studyDesignOptions: MOCK_STUDY_DESIGNS,
    selectedStudyDesignId: MOCK_STUDY_DESIGNS[0]?.id ?? null,
    paperSections: MOCK_PAPER_SECTIONS,
    finalTopicOptions: [],
    topicFinalData: MOCK_TOPIC_FINAL_DATA,
    selectedFinalTopicId: null,
    chatMessages: INITIAL_CHAT_MESSAGES,
    versionHistory: MOCK_VERSION_HISTORY,
    saveStatus: 'saved',
    showVersionHistory: false,
    showBackNavModal: false,
    pendingBackStep: null,
    consistencyAlert: null,
    editMode: false,
    staleSteps: [],
  }
}

function snapshotToState(snap: SessionSnapshot): AppState {
  const base = freshState()
  return {
    ...base,
    sessionId: snap.sessionId,
    sessionTitle: snap.sessionTitle,
    createdAt: snap.createdAt,
    currentStep: snap.currentStep,
    staleSteps: snap.staleSteps ?? [],
    stepStates: computeStepStates(snap.currentStep, snap.staleSteps ?? []),
    profileCompleteness: computeCompleteness(snap.profile),
    profile: snap.profile,
    chatMessages: snap.chatMessages ?? base.chatMessages,
    systemItems: snap.systemItems ?? [],
    topics: snap.topics ?? base.topics,
    queries: snap.queries ?? [],
    results: snap.results ?? [],
    reviewList: snap.reviewList ?? [],
    matrixColumns: snap.matrixColumns ?? base.matrixColumns,
    matrixRows: snap.matrixRows ?? base.matrixRows,
    systemMatrixColumns: snap.systemMatrixColumns ?? base.systemMatrixColumns,
    systemMatrixRows: snap.systemMatrixRows ?? base.systemMatrixRows,
    themes: snap.themes ?? base.themes,
    activeThemeId: snap.activeThemeId ?? base.activeThemeId,
    gaps: snap.gaps ?? base.gaps,
    gapStatement: snap.gapStatement ?? base.gapStatement,
    rqOptions: snap.rqOptions ?? base.rqOptions,
    selectedRQId: snap.selectedRQId ?? base.selectedRQId,
    studyDesignOptions: snap.studyDesignOptions ?? base.studyDesignOptions,
    selectedStudyDesignId: snap.selectedStudyDesignId ?? base.selectedStudyDesignId,
    finalTopicOptions: snap.finalTopicOptions ?? [],
    topicFinalData: snap.topicFinalData ?? base.topicFinalData,
    selectedFinalTopicId: snap.selectedFinalTopicId ?? null,
  }
}

function getInitialState(): AppState {
  const recentId = getMostRecentSessionId()
  if (recentId) {
    const snap = loadSession(recentId)
    if (snap) return snapshotToState(snap)
  }
  return freshState()
}

function computeStepStates(current: number, stale: number[]): Record<number, StepState> {
  const states: Record<number, StepState> = {}
  for (let i = 1; i <= 8; i++) {
    if (i === current) states[i] = 'active'
    else if (stale.includes(i)) states[i] = 'stale'
    else if (i < current) states[i] = 'done'
    else states[i] = 'locked'
  }
  return states
}

function computeCompleteness(profile: ResearchProfile): number {
  const fields = Object.values(profile)
  const filled = fields.filter(v => v.trim().length > 0).length
  return Math.round((filled / fields.length) * 100)
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_STEP': {
      const step = action.step
      const newStale = state.staleSteps.filter(s => s !== step)
      return {
        ...state,
        currentStep: step,
        editMode: false,
        stepStates: computeStepStates(step, newStale),
        staleSteps: newStale,
        consistencyAlert: null,
      }
    }

    case 'ADVANCE_STEP': {
      const next = Math.min(state.currentStep + 1, 8)
      return { ...state, currentStep: next, stepStates: computeStepStates(next, state.staleSteps), editMode: false }
    }

    case 'BACK_NAV_REQUEST': {
      if (action.step >= state.currentStep) return state
      return { ...state, showBackNavModal: true, pendingBackStep: action.step }
    }

    case 'BACK_NAV_CONFIRM': {
      if (state.pendingBackStep === null) return state
      const target = state.pendingBackStep
      const newStale = Array.from({ length: state.currentStep - target }, (_, i) => target + i + 1)
      return {
        ...state,
        currentStep: target,
        stepStates: computeStepStates(target, newStale),
        staleSteps: newStale,
        editMode: true,
        showBackNavModal: false,
        pendingBackStep: null,
      }
    }

    case 'BACK_NAV_CANCEL':
    case 'DISMISS_BACK_NAV_MODAL':
      return { ...state, showBackNavModal: false, pendingBackStep: null }

    case 'UPDATE_PROFILE': {
      const updated = { ...state.profile, [action.field]: action.value }
      const autoTitle = !state.sessionTitle && action.field === 'domain' && action.value.trim()
        ? action.value.trim()
        : state.sessionTitle
      return {
        ...state,
        profile: updated,
        profileCompleteness: computeCompleteness(updated),
        sessionTitle: autoTitle,
      }
    }

    case 'SET_SESSION_TITLE':
      return { ...state, sessionTitle: action.title }

    case 'SET_SAVE_STATUS':
      return { ...state, saveStatus: action.status }

    case 'NEW_SESSION':
      return { ...freshState(), showVersionHistory: false }

    case 'LOAD_SESSION':
      return { ...snapshotToState(action.snapshot), showVersionHistory: false }

    case 'TOGGLE_TOPIC':
      return { ...state, topics: state.topics.map(t => t.id === action.topicId ? { ...t, selected: !t.selected } : t) }

    case 'UPDATE_TOPIC':
      return { ...state, topics: state.topics.map(t => t.id === action.topicId ? { ...t, [action.field]: action.value } : t) }

    case 'ADD_TOPIC':
      return { ...state, topics: [...state.topics, action.topic] }

    case 'SET_TOPICS':
      return { ...state, topics: action.topics }

    case 'SET_SYSTEM_ITEMS':
      return { ...state, systemItems: action.items }

    case 'TOGGLE_SYSTEM_ITEM':
      return { ...state, systemItems: state.systemItems.map(s => s.id === action.itemId ? { ...s, selected: !s.selected } : s) }

    case 'ADD_CUSTOM_SYSTEM': {
      const newItem: SystemItem = {
        id: `sys-custom-${Date.now()}`,
        name: action.name,
        description: '',
        category: 'other',
        url: null,
        vendor: '',
        aiGenerated: false,
        selected: true,
      }
      return { ...state, systemItems: [...state.systemItems, newItem] }
    }

    case 'SET_QUERIES':
      return { ...state, queries: action.queries }

    case 'CLEAR_RESULTS':
      return { ...state, results: [] }

    case 'ADD_SEARCH_RESULTS': {
      const existingTitles = new Set(state.results.map(r => r.title.toLowerCase().trim()))
      const fresh = action.results.filter(r => !existingTitles.has(r.title.toLowerCase().trim()))
      return { ...state, results: [...state.results, ...fresh] }
    }

    case 'TOGGLE_REVIEW': {
      const paper = state.results.find(r => r.id === action.paperId)
      if (!paper) return state
      const inList = state.reviewList.some(r => r.id === action.paperId)
      return {
        ...state,
        reviewList: inList
          ? state.reviewList.filter(r => r.id !== action.paperId)
          : [...state.reviewList, { ...paper, status: 'maybe' as const }],
      }
    }

    case 'ADD_TO_REVIEW': {
      const paper = state.results.find(r => r.id === action.paperId)
      if (!paper) return state
      const inList = state.reviewList.some(r => r.id === action.paperId)
      return {
        ...state,
        reviewList: inList
          ? state.reviewList.map(r => r.id === action.paperId ? { ...r, status: action.status } : r)
          : [...state.reviewList, { ...paper, status: action.status }],
      }
    }

    case 'REMOVE_FROM_REVIEW':
      return { ...state, reviewList: state.reviewList.filter(r => r.id !== action.paperId) }

    case 'UPDATE_REVIEW_STATUS':
      return { ...state, reviewList: state.reviewList.map(r => r.id === action.paperId ? { ...r, status: action.status } : r) }

    case 'SEND_MESSAGE': {
      const userMsg = {
        id: `msg-${Date.now()}`,
        type: 'student' as const,
        content: action.content,
        timestamp: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      }
      return { ...state, chatMessages: [...state.chatMessages, userMsg] }
    }

    case 'ADD_CHAT_MESSAGE':
      return { ...state, chatMessages: [...state.chatMessages, action.message] }

    case 'DISMISS_MESSAGE':
      return { ...state, chatMessages: state.chatMessages.filter(m => m.id !== action.messageId) }

    case 'TOGGLE_HISTORY':
      return { ...state, showVersionHistory: !state.showVersionHistory }

    case 'TOGGLE_GAP_SELECTED':
      return { ...state, gaps: state.gaps.map(g => g.id === action.gapId ? { ...g, selected: !g.selected } : g) }

    case 'UPDATE_RESULT_RELEVANCE':
      return {
        ...state,
        results: state.results.map(r =>
          r.id === action.paperId ? { ...r, relevanceScore: action.score, confidence: action.confidence } : r
        ),
      }

    case 'SET_MATRIX_COLUMNS':
      return { ...state, matrixColumns: action.columns }

    case 'ADD_MATRIX_COLUMN': {
      if (!action.column.trim() || state.matrixColumns.includes(action.column.trim())) return state
      return { ...state, matrixColumns: [...state.matrixColumns, action.column.trim()] }
    }

    case 'INIT_MATRIX_ROWS':
      return {
        ...state,
        matrixRows: state.reviewList.map(paper => ({
          paperId: paper.id,
          title: paper.title,
          authors: paper.authors,
          year: paper.year,
          cells: {} as Record<string, import('../types').MatrixCell>,
        })),
      }

    case 'UPDATE_MATRIX_ROW_CELLS':
      return {
        ...state,
        matrixRows: state.matrixRows.map(row =>
          row.paperId === action.paperId ? { ...row, cells: { ...row.cells, ...action.cells } } : row
        ),
      }

    case 'UPDATE_SYSTEM_MATRIX_ROW_CELLS':
      return {
        ...state,
        systemMatrixRows: (state.systemMatrixRows ?? []).map(row =>
          row.systemId === action.systemId ? { ...row, cells: { ...row.cells, ...action.cells } } : row
        ),
      }

    case 'SET_SYSTEM_MATRIX_COLUMNS':
      return { ...state, systemMatrixColumns: action.columns }

    case 'ADD_SYSTEM_MATRIX_COLUMN': {
      if (!action.column.trim() || (state.systemMatrixColumns ?? []).includes(action.column.trim())) return state
      return { ...state, systemMatrixColumns: [...(state.systemMatrixColumns ?? []), action.column.trim()] }
    }

    case 'INIT_SYSTEM_MATRIX_ROWS': {
      const newSystemRows: SystemMatrixRow[] = (state.systemItems ?? [])
        .filter(s => s.selected)
        .map(s => ({
          systemId: s.id,
          name: s.name,
          vendor: s.vendor,
          category: s.category,
          url: s.url,
          cells: {} as Record<string, import('../types').MatrixCell>,
        }))
      return { ...state, systemMatrixRows: newSystemRows }
    }

    case 'UPDATE_THEME_COLUMNS':
      return { ...state, themes: state.themes.map(t => t.id === action.themeId ? { ...t, sourceColumns: action.columns } : t) }

    case 'SELECT_RQ':
      return { ...state, selectedRQId: action.rqId }

    case 'SELECT_STUDY_DESIGN':
      return { ...state, selectedStudyDesignId: action.designId }

    case 'UPDATE_GAP_STATEMENT':
      return { ...state, gapStatement: action.text }

    case 'SET_THEMES':
      return {
        ...state,
        themes: action.themes.map(t => ({ ...t, systemSourceColumns: t.systemSourceColumns ?? [] })),
        activeThemeId: action.themes[0]?.id ?? state.activeThemeId,
      }

    case 'ADD_SYNTHESIS_BLOCK':
      return { ...state, themes: state.themes.map(t => t.id === action.themeId ? { ...t, blocks: [...t.blocks, action.block] } : t) }

    case 'UPDATE_SYNTHESIS_BLOCK':
      return {
        ...state,
        themes: state.themes.map(t =>
          t.id === action.themeId
            ? { ...t, blocks: t.blocks.map(b => b.id === action.blockId ? { ...b, content: action.content } : b) }
            : t
        ),
      }

    case 'UPDATE_THEME_SYSTEM_COLUMNS':
      return { ...state, themes: state.themes.map(t => t.id === action.themeId ? { ...t, systemSourceColumns: action.columns } : t) }

    case 'SET_RQ_OPTIONS':
      return { ...state, rqOptions: action.options, selectedRQId: action.options[0]?.id ?? state.selectedRQId }

    case 'SET_STUDY_DESIGN_OPTIONS':
      return { ...state, studyDesignOptions: action.options, selectedStudyDesignId: action.options[0]?.id ?? state.selectedStudyDesignId }

    case 'SET_FINAL_TOPIC_OPTIONS':
      return {
        ...state,
        finalTopicOptions: action.options,
        selectedFinalTopicId: state.selectedFinalTopicId ?? action.options[0]?.id ?? null,
      }

    case 'SET_TOPIC_FINAL_DATA':
      return {
        ...state,
        topicFinalData: action.data,
        selectedFinalTopicId: state.selectedFinalTopicId ?? action.data[0]?.topicId ?? null,
      }

    case 'SELECT_FINAL_TOPIC':
      return { ...state, selectedFinalTopicId: action.topicId }

    case 'REMOVE_RESULTS': {
      const ids = new Set(action.paperIds)
      return { ...state, results: state.results.filter(r => !ids.has(r.id)) }
    }

    case 'DISMISS_CONSISTENCY_ALERT':
      return { ...state, consistencyAlert: null }

    case 'TOGGLE_TOPIC_SELECTED':
      return { ...state, topics: state.topics.map(t => t.id === action.topicId ? { ...t, selected: !t.selected } : t) }

    case 'UPDATE_ACTION_STATUS':
      return {
        ...state,
        chatMessages: state.chatMessages.map(m =>
          m.id === action.messageId
            ? {
                ...m,
                proposedActions: m.proposedActions?.map(a =>
                  a.id === action.actionId ? { ...a, status: action.status } : a
                ),
              }
            : m
        ),
      }

    case 'RESTORE_STATE':
      return action.state

    default:
      return state
  }
}

// Actions that only change UI state — do NOT trigger a save or undo entry
const UI_ONLY_ACTIONS = new Set([
  'TOGGLE_HISTORY', 'SET_SAVE_STATUS',
  'DISMISS_CONSISTENCY_ALERT', 'DISMISS_BACK_NAV_MODAL',
  'BACK_NAV_CANCEL', 'BACK_NAV_REQUEST',
  'RESTORE_STATE',
])

const MAX_HISTORY = 30

type AppContextValue = {
  state: AppState
  dispatch: React.Dispatch<AppAction>
  saveStatus: 'saved' | 'saving'
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, getInitialState)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // Track last dispatched action type to skip UI-only state changes
  const lastActionRef = useRef<string>('__init__')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep a ref to current state so the timer callback always saves the latest snapshot
  const stateRef = useRef(state)
  stateRef.current = state

  // Undo/redo stacks — stored in refs so mutations don't trigger re-renders
  const historyRef = useRef<AppState[]>([])
  const futureRef  = useRef<AppState[]>([])

  const wrappedDispatch: React.Dispatch<AppAction> = (action) => {
    if (!UI_ONLY_ACTIONS.has(action.type)) {
      // Push current state onto history, clear future
      historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 1)), stateRef.current]
      futureRef.current = []
      setCanUndo(true)
      setCanRedo(false)
    }
    lastActionRef.current = action.type
    dispatch(action)
  }

  function undo() {
    const prev = historyRef.current.pop()
    if (!prev) return
    futureRef.current = [stateRef.current, ...futureRef.current.slice(0, MAX_HISTORY - 1)]
    setCanUndo(historyRef.current.length > 0)
    setCanRedo(true)
    lastActionRef.current = 'RESTORE_STATE'
    dispatch({ type: 'RESTORE_STATE', state: prev })
  }

  function redo() {
    const next = futureRef.current.shift()
    if (!next) return
    historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 1)), stateRef.current]
    setCanUndo(true)
    setCanRedo(futureRef.current.length > 0)
    lastActionRef.current = 'RESTORE_STATE'
    dispatch({ type: 'RESTORE_STATE', state: next })
  }

  useEffect(() => {
    // Skip pure UI-state changes
    if (UI_ONLY_ACTIONS.has(lastActionRef.current)) return

    setSaveStatus('saving')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveSession(stateRef.current)
      setSaveStatus('saved')
    }, 600)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // ── Dev debug: expose state and research context on window ────────────────
  useEffect(() => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any
      w.__state = state
      w.__mem   = buildResearchContext(state)
    }
  }, [state])

  return (
    <AppContext.Provider value={{ state, dispatch: wrappedDispatch, saveStatus, canUndo, canRedo, undo, redo }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
