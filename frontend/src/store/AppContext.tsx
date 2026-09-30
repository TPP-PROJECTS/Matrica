/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect, useRef, useState, type ReactNode } from 'react'
import { buildResearchContext } from '../lib/buildResearchContext'
import { setAnalyticsSession, trackEvent } from '../lib/api'
import { partitionNewPapers } from '../lib/dedupe'
import { newId } from '../lib/ids'
import { describeAiExtraction, describeEditExplanation, mergeExtractedCells, resetCell, reviewCell } from '../lib/matrixVerification'
import type {
  AppState, AppAction, ResearchProfile, StepState, SystemItem, SystemMatrixRow, MatrixCell,
  SessionSnapshot, ScreeningCriterion, SearchFilters, DecisionJournalEntry, MatrixKind,
} from '../types'
import { BASE_MATRIX_COLUMNS, WELCOME_MESSAGES } from '../data/initialData'
import { STEPS, LAST_STEP, clampStep, migrateStep, migrateSteps } from '../lib/steps'
import {
  generateSessionId, saveSession, loadSession, getMostRecentSessionId,
  migrateLocalSessionsToRemote, flushSessionLocal, createVersion, type SaveOutcome,
} from '../lib/sessionStorage'

/** Save state as the UI shows it: an in-flight save plus every save outcome. */
type SaveStatus = 'saving' | SaveOutcome


const initialStepStates: Record<number, StepState> = Object.fromEntries(
  STEPS.map(step => [step.id, step.id === 1 ? 'active' : 'locked'] as const),
)

const NO_SEARCH_FILTERS: SearchFilters = {
  yearFrom: null,
  yearTo: null,
  openAccessOnly: false,
  excludePreprints: false,
  language: '',
}

/**
 * Databases a new review starts with. It matches the backend's own default, so
 * an existing review's searches are unchanged; the picker in the search step is
 * where the rest of the available databases are turned on.
 */
const DEFAULT_SEARCH_SOURCES = ['openalex', 'pubmed']

/**
 * Starter exclusion reasons. These are the discipline-agnostic ones every
 * review needs; topic-specific inclusion criteria are for the user to add. They
 * are seeded rather than left empty so that screening can never produce an
 * exclusion with no reason attached to it.
 */
const DEFAULT_CRITERIA: ScreeningCriterion[] = [
  { id: 'ex-population', kind: 'exclusion', label: 'Wrong population' },
  { id: 'ex-intervention', kind: 'exclusion', label: 'Wrong intervention or exposure' },
  { id: 'ex-outcome', kind: 'exclusion', label: 'Wrong outcome' },
  { id: 'ex-design', kind: 'exclusion', label: 'Wrong study design' },
  { id: 'ex-not-peer-reviewed', kind: 'exclusion', label: 'Not peer-reviewed' },
  { id: 'ex-no-full-text', kind: 'exclusion', label: 'Full text unavailable' },
  { id: 'ex-language', kind: 'exclusion', label: 'Language not readable by the team' },
]

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
    systemMatrixEnabled: true,
    matrixColumnSuggestions: [],
    systemMatrixColumnSuggestions: [],
    columnDescriptions: {},
    systemColumnDescriptions: {},
    topics: [],
    systemItems: [],
    systemTopicLinks: [],
    queries: [],
    results: [],
    reviewList: [],
    searchFilters: NO_SEARCH_FILTERS,
    searchSources: DEFAULT_SEARCH_SOURCES,
    criteria: DEFAULT_CRITERIA,
    screening: { identifiedByQuery: {}, retrievedByQuery: {} },
    importedSearches: [],
    matrixRows: [],
    matrixColumns: BASE_MATRIX_COLUMNS,
    systemMatrixRows: [],
    systemMatrixColumns: [],
    paperFullTexts: {},
    integrityChecks: {},
    robToolId: null,
    robAssessments: [],
    certaintyAssessments: [],
    themes: [],
    activeThemeId: '',
    gaps: [],
    gapStatement: '',
    axisGaps: {},
    rqOptions: [],
    selectedRQId: null,
    studyDesignOptions: [],
    selectedStudyDesignId: null,
    paperSections: [],
    finalTopicOptions: [],
    topicFinalData: [],
    selectedFinalTopicId: null,
    decisionJournal: [],
    chatMessages: WELCOME_MESSAGES,
    saveStatus: 'saved',
    showVersionHistory: false,
    showBackNavModal: false,
    pendingBackStep: null,
    editMode: false,
    staleSteps: [],
    maxStepReached: 1,
    reviewMode: false,
  }
}

function snapshotToState(snap: SessionSnapshot): AppState {
  const base = freshState()
  return {
    ...base,
    sessionId: snap.sessionId,
    sessionTitle: snap.sessionTitle,
    createdAt: snap.createdAt,
    ...(() => {
      const currentStep = migrateStep(snap.currentStep, snap.stepSchema)
      const staleSteps = migrateSteps(snap.staleSteps ?? [], snap.stepSchema)
      const maxStepReached = Math.max(
        currentStep,
        migrateStep(snap.maxStepReached ?? snap.currentStep, snap.stepSchema),
        ...staleSteps,
      )
      return {
        currentStep,
        staleSteps,
        maxStepReached,
        stepStates: computeStepStates(currentStep, staleSteps, maxStepReached),
      }
    })(),
    profileCompleteness: computeCompleteness(snap.profile),
    profile: snap.profile,
    systemMatrixEnabled: snap.systemMatrixEnabled ?? base.systemMatrixEnabled,
    matrixColumnSuggestions: snap.matrixColumnSuggestions ?? base.matrixColumnSuggestions,
    systemMatrixColumnSuggestions: snap.systemMatrixColumnSuggestions ?? base.systemMatrixColumnSuggestions,
    columnDescriptions: snap.columnDescriptions ?? base.columnDescriptions,
    systemColumnDescriptions: snap.systemColumnDescriptions ?? base.systemColumnDescriptions,
    chatMessages: snap.chatMessages ?? base.chatMessages,
    systemItems: snap.systemItems ?? [],
    systemTopicLinks: snap.systemTopicLinks ?? [],
    topics: snap.topics ?? base.topics,
    queries: snap.queries ?? [],
    results: snap.results ?? [],
    reviewList: snap.reviewList ?? [],
    searchFilters: snap.searchFilters ?? base.searchFilters,
    // A session saved before the picker existed searched the original pair.
    searchSources: snap.searchSources ?? base.searchSources,
    criteria: snap.criteria ?? base.criteria,
    screening: snap.screening ?? base.screening,
    importedSearches: snap.importedSearches ?? base.importedSearches,
    matrixColumns: snap.matrixColumns ?? base.matrixColumns,
    matrixRows: snap.matrixRows ?? base.matrixRows,
    systemMatrixColumns: snap.systemMatrixColumns ?? base.systemMatrixColumns,
    systemMatrixRows: snap.systemMatrixRows ?? base.systemMatrixRows,
    paperFullTexts: snap.paperFullTexts ?? base.paperFullTexts,
    integrityChecks: snap.integrityChecks ?? base.integrityChecks,
    robToolId: snap.robToolId ?? base.robToolId,
    robAssessments: snap.robAssessments ?? base.robAssessments,
    certaintyAssessments: snap.certaintyAssessments ?? base.certaintyAssessments,
    themes: snap.themes ?? base.themes,
    activeThemeId: snap.activeThemeId ?? base.activeThemeId,
    gaps: snap.gaps ?? base.gaps,
    gapStatement: snap.gapStatement ?? base.gapStatement,
    axisGaps: snap.axisGaps ?? base.axisGaps,
    rqOptions: snap.rqOptions ?? base.rqOptions,
    selectedRQId: snap.selectedRQId ?? base.selectedRQId,
    studyDesignOptions: snap.studyDesignOptions ?? base.studyDesignOptions,
    selectedStudyDesignId: snap.selectedStudyDesignId ?? base.selectedStudyDesignId,
    finalTopicOptions: snap.finalTopicOptions ?? [],
    topicFinalData: snap.topicFinalData ?? base.topicFinalData,
    selectedFinalTopicId: snap.selectedFinalTopicId ?? null,
    // Entries carry the step they were made in, under the layout of the time;
    // map them forward with the session so they file under the right step.
    decisionJournal: (snap.decisionJournal ?? []).map(entry => ({ ...entry, step: migrateStep(entry.step, snap.stepSchema) })),
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

/**
 * Per-step badge state.
 *
 * `reached` is the furthest step the review has ever been on, and everything up
 * to it stays navigable. It used to be derived from `current` alone, so going
 * back to revise an early step re-locked every step past the one being revised
 * — the only way forward again was to re-run each step's AI generation, even
 * though the work was still in the session.
 */
function computeStepStates(current: number, stale: number[], reached: number): Record<number, StepState> {
  const states: Record<number, StepState> = {}
  const furthest = Math.max(reached, current)
  for (let i = 1; i <= LAST_STEP; i++) {
    if (i === current) states[i] = 'active'
    else if (stale.includes(i)) states[i] = 'stale'
    else if (i <= furthest) states[i] = 'done'
    else states[i] = 'locked'
  }
  return states
}

function computeCompleteness(profile: ResearchProfile): number {
  const fields = Object.values(profile)
  const filled = fields.filter(v => v.trim().length > 0).length
  return Math.round((filled / fields.length) * 100)
}

/** Copy of `map` with `oldKey` renamed to `newKey`, if it was present. */
function renameKey(map: Record<string, string>, oldKey: string, newKey: string): Record<string, string> {
  if (!(oldKey in map)) return map
  const { [oldKey]: value, ...rest } = map
  return { ...rest, [newKey]: value }
}

/**
 * Drop appraisals for papers that are no longer under review.
 *
 * An assessment outlives its paper the same way a matrix row used to, and the
 * result is a count like "2 of 1 appraised" and an orphan carried into the
 * synthesis payload. Removal is the right move rather than hiding them: a paper
 * that is no longer in the review has no place in its quality appraisal.
 */
function pruneRobAssessments(
  assessments: import('../types').RobAssessment[],
  reviewList: import('../types').ResultCard[],
): import('../types').RobAssessment[] {
  const live = new Set(reviewList.map(p => p.id))
  return assessments.length === assessments.filter(a => live.has(a.paperId)).length
    ? assessments
    : assessments.filter(a => live.has(a.paperId))
}

/**
 * Drop cached full text for papers that are gone.
 *
 * These are the largest things the session stores, so an orphan here costs far
 * more than a stale matrix row: leaving them behind is what would eventually
 * push a long review past the browser's storage quota.
 */
function pruneFullTexts(
  texts: Record<string, string>,
  removed: (id: string) => boolean,
): Record<string, string> {
  const kept = Object.entries(texts ?? {}).filter(([id]) => !removed(id))
  return kept.length === Object.keys(texts ?? {}).length
    ? texts
    : Object.fromEntries(kept)
}

/** Copy of `map` without `key`. */
function dropKey(map: Record<string, string>, key: string): Record<string, string> {
  if (!(key in map)) return map
  const rest = { ...map }
  delete rest[key]
  return rest
}

// Exported for unit testing; the app drives it through the provider below. This
// file already opts out of fast-refresh by exporting useApp, so exporting the
// reducer too costs nothing beyond what the hook export already does.
export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_REVIEW_MODE': {
      // Review mode is a way of reading the review, not of changing it: turning
      // it on leaves edit mode and the pending back-nav prompt behind, and the
      // stale markers are kept in state but not acted on while it is on.
      if (state.reviewMode === action.enabled) return state
      return {
        ...state,
        reviewMode: action.enabled,
        editMode: false,
        showBackNavModal: false,
        pendingBackStep: null,
      }
    }

    case 'SET_STEP': {
      const step = clampStep(action.step)
      const reached = Math.max(state.maxStepReached, step)
      // Reading a step in review mode must not clear its "outdated" marker —
      // the marker is about the work, and review mode changes no work.
      const newStale = state.reviewMode ? state.staleSteps : state.staleSteps.filter(s => s !== step)
      return {
        ...state,
        currentStep: step,
        maxStepReached: reached,
        editMode: false,
        stepStates: computeStepStates(step, newStale, reached),
        staleSteps: newStale,
      }
    }

    case 'ADVANCE_STEP': {
      const next = Math.min(state.currentStep + 1, LAST_STEP)
      const reached = Math.max(state.maxStepReached, next)
      // Moving onto a step is the same act of review as clicking it in the nav,
      // so it clears the same marker. Leaving it set meant a step could be
      // walked through and still be shown as outdated afterwards.
      const newStale = state.reviewMode ? state.staleSteps : state.staleSteps.filter(s => s !== next)
      return {
        ...state,
        currentStep: next,
        maxStepReached: reached,
        staleSteps: newStale,
        stepStates: computeStepStates(next, newStale, reached),
        editMode: false,
      }
    }

    case 'BACK_NAV_REQUEST': {
      if (action.step >= state.currentStep) return state
      if (state.reviewMode) return state
      return { ...state, showBackNavModal: true, pendingBackStep: action.step }
    }

    case 'BACK_NAV_CONFIRM': {
      if (state.pendingBackStep === null) return state
      const target = state.pendingBackStep
      // Everything downstream of the step being revised is outdated — as far as
      // the review has ever got, not just as far as the current step. Marking
      // only up to `currentStep` dropped the markers for steps beyond it, and
      // replacing the list (rather than merging) lost markers set earlier.
      const reached = Math.max(state.maxStepReached, state.currentStep)
      const downstream = Array.from({ length: reached - target }, (_, i) => target + i + 1)
      const newStale = Array.from(new Set([...state.staleSteps, ...downstream]))
        .filter(s => s > target)
        .sort((a, b) => a - b)
      return {
        ...state,
        currentStep: target,
        maxStepReached: reached,
        stepStates: computeStepStates(target, newStale, reached),
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
      return { ...freshState(), showVersionHistory: false, reviewMode: state.reviewMode }

    case 'LOAD_SESSION':
      return { ...snapshotToState(action.snapshot), showVersionHistory: false, reviewMode: state.reviewMode }

    case 'TOGGLE_TOPIC':
      return { ...state, topics: state.topics.map(t => t.id === action.topicId ? { ...t, selected: !t.selected } : t) }

    case 'UPDATE_TOPIC':
      return { ...state, topics: state.topics.map(t => t.id === action.topicId ? { ...t, [action.field]: action.value } : t) }

    case 'ADD_TOPIC':
      return { ...state, topics: [...state.topics, action.topic] }

    case 'SET_TOPICS': {
      const liveIds = new Set(action.topics.map(t => t.id))
      return {
        ...state,
        topics: action.topics,
        systemTopicLinks: (state.systemTopicLinks ?? []).filter(l => liveIds.has(l.topicId)),
      }
    }

    case 'SET_SYSTEM_ITEMS': {
      // A link to a system that is no longer listed points at nothing the UI
      // can draw, so replacing the list prunes the links with it.
      const liveIds = new Set(action.items.map(item => item.id))
      return {
        ...state,
        systemItems: action.items,
        systemTopicLinks: (state.systemTopicLinks ?? []).filter(l => liveIds.has(l.systemId)),
      }
    }

    case 'SET_SYSTEM_TOPIC_LINKS':
      return { ...state, systemTopicLinks: action.links }

    case 'TOGGLE_SYSTEM_ITEM':
      return { ...state, systemItems: state.systemItems.map(s => s.id === action.itemId ? { ...s, selected: !s.selected } : s) }

    case 'ADD_CUSTOM_SYSTEM': {
      const newItem: SystemItem = {
        id: newId('sys-custom'),
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

    case 'RECORD_QUERY_RUN':
      // The reproducibility record for the search-strategy appendix. Overwritten
      // on each run rather than appended: what a reader needs to re-run is the
      // strategy as it finally stood, not every draft of it. The decision
      // journal already keeps the history of filter changes.
      return {
        ...state,
        queries: state.queries.map(q =>
          q.id === action.queryId
            // `databases` is refreshed from the run rather than left as it was
            // set when the card was made: it is what the report's methods
            // section prints, and a database that failed or was deselected
            // since then did not search this query.
            ? {
                ...q,
                lastRunAt: action.runAt,
                lastRunFilters: action.filters,
                sourceQueries: action.sourceQueries,
                databases: action.sourceQueries.map(sq => sq.source),
              }
            : q
        ),
      }

    case 'CLEAR_RESULTS':
      return {
        ...state,
        results: [],
        screening: { identifiedByQuery: {}, retrievedByQuery: {} },
        paperFullTexts: {},
      }

    case 'ADD_SEARCH_RESULTS': {
      // Match incoming papers against everything already retrieved — by DOI
      // first, normalised title second — so the same study surfacing under
      // several queries is counted once and screened once.
      const { fresh, enrichments } = partitionNewPapers(state.results, action.results)
      const enrichedById = new Map(enrichments.map(e => [e.id, e.abstract]))
      const results = state.results.map(r =>
        enrichedById.has(r.id) ? { ...r, abstract: enrichedById.get(r.id)! } : r
      )
      // Retrieved records are tracked per query for the same reason as
      // identified ones: page 1 assigns, later pages add to that query's entry.
      // Duplicates are no longer counted here at all — a running total grew on
      // every re-run of a search, because each already-held paper is detected as
      // a duplicate again. It is derived from these two figures instead
      // (see `duplicatesRemoved` in types/index.ts), which is re-run safe.
      const retrieved = action.retrievedFor
      const retrievedByQuery = retrieved
        ? {
            ...state.screening.retrievedByQuery,
            [retrieved.queryId]: retrieved.page === 1
              ? retrieved.count
              : (state.screening.retrievedByQuery?.[retrieved.queryId] ?? 0) + retrieved.count,
          }
        : state.screening.retrievedByQuery
      return {
        ...state,
        results: [...results, ...fresh],
        screening: {
          ...state.screening,
          // Assigned per query, not accumulated: re-running a search finds the
          // same corpus again, and adding its total a second time would inflate
          // the PRISMA identification count.
          identifiedByQuery: action.identifiedFor
            ? { ...state.screening.identifiedByQuery, [action.identifiedFor.queryId]: action.identifiedFor.count }
            : state.screening.identifiedByQuery,
          retrievedByQuery,
        },
      }
    }

    case 'SET_SEARCH_FILTERS':
      return { ...state, searchFilters: action.filters }

    case 'SET_SEARCH_SOURCES':
      // An empty selection would search nothing and report a 400 as a failure;
      // the last database cannot be removed.
      return action.sources.length === 0
        ? state
        : { ...state, searchSources: action.sources }

    case 'ADD_CRITERION': {
      const label = action.criterion.label.trim()
      if (!label) return state
      if (state.criteria.some(c => c.kind === action.criterion.kind && c.label.trim().toLowerCase() === label.toLowerCase())) {
        return state
      }
      return { ...state, criteria: [...state.criteria, { ...action.criterion, label }] }
    }

    case 'REMOVE_CRITERION':
      return { ...state, criteria: state.criteria.filter(c => c.id !== action.criterionId) }

    case 'EXCLUDE_PAPER': {
      // An excluded paper stays in `results` carrying its reason — that record
      // is what the PRISMA "excluded, with reasons" table is built from — but
      // it leaves the review list.
      if (!state.results.some(r => r.id === action.paperId)) return state
      return {
        ...state,
        results: state.results.map(r =>
          r.id === action.paperId
            ? {
                ...r,
                status: 'excluded' as const,
                exclusionReasonId: action.reasonId,
                screenedBy: action.by,
                screeningReason: action.reason,
                screenUncertain: false,
                screenStatus: undefined,
              }
            : r
        ),
        reviewList: state.reviewList.filter(r => r.id !== action.paperId),
        robAssessments: (state.robAssessments ?? []).filter(a => a.paperId !== action.paperId),
      }
    }

    case 'UNEXCLUDE_PAPER':
      return {
        ...state,
        results: state.results.map(r =>
          r.id === action.paperId
            ? { ...r, status: null, exclusionReasonId: null, screenedBy: undefined, screeningReason: undefined, screenUncertain: false }
            : r
        ),
      }

    case 'MARK_SCREEN_UNCERTAIN':
      // The AI could not decide from the abstract. Put the paper in the review
      // list as pending so the human decision is not stranded in the left-hand
      // search results after an auto-screen pass.
      {
        const base = state.results.find(r => r.id === action.paperId)
        if (!base) return state
        const pending = {
          status: 'maybe' as const,
          screenUncertain: true,
          screeningReason: action.reason,
          screenedBy: action.by,
          screenStatus: 'done' as const,
        }
        const inList = state.reviewList.some(r => r.id === action.paperId)
        return {
          ...state,
          results: state.results.map(r =>
            r.id === action.paperId ? { ...r, ...pending } : r
          ),
          reviewList: inList
            ? state.reviewList.map(r => r.id === action.paperId ? { ...r, ...pending } : r)
            : [...state.reviewList, { ...base, ...pending }],
        }
      }

    case 'SET_SCREEN_STATUS':
      return {
        ...state,
        results: state.results.map(r =>
          r.id === action.paperId ? { ...r, screenStatus: action.status } : r
        ),
      }

    case 'RESET_AI_SCREENING': {
      // Undo only what the AI touched; anything a human decided is left alone.
      const clearAi = (r: import('../types').ResultCard) =>
        r.screenedBy === 'ai'
          ? { ...r, status: null, exclusionReasonId: null, screenedBy: undefined, screeningReason: undefined, screenUncertain: false, screenStatus: undefined }
          : r
      const reviewList = state.reviewList.filter(r => r.screenedBy !== 'ai')
      return {
        ...state,
        results: state.results.map(clearAi),
        reviewList,
        robAssessments: pruneRobAssessments(state.robAssessments ?? [], reviewList),
      }
    }

    case 'UPDATE_REVIEW_NOTE':
      return {
        ...state,
        results: state.results.map(r => r.id === action.paperId ? { ...r, notes: action.note } : r),
        reviewList: state.reviewList.map(r => r.id === action.paperId ? { ...r, notes: action.note } : r),
      }

    case 'UPDATE_PAPER_ABSTRACT':
      return {
        ...state,
        results: state.results.map(r =>
          r.id === action.paperId ? { ...r, abstract: action.abstract } : r
        ),
        reviewList: state.reviewList.map(r =>
          r.id === action.paperId ? { ...r, abstract: action.abstract } : r
        ),
      }

    case 'SET_RESULT_SCORE_STATUS':
      return {
        ...state,
        results: state.results.map(r =>
          r.id === action.paperId ? { ...r, scoreStatus: action.status } : r
        ),
      }

    case 'TOGGLE_REVIEW': {
      const paper = state.results.find(r => r.id === action.paperId)
      if (!paper) return state
      const inList = state.reviewList.some(r => r.id === action.paperId)
      const status = inList ? null : ('maybe' as const)
      return {
        ...state,
        results: state.results.map(r => r.id === action.paperId ? { ...r, status } : r),
        reviewList: inList
          ? state.reviewList.filter(r => r.id !== action.paperId)
          : [...state.reviewList, { ...paper, status }],
        robAssessments: inList
          ? (state.robAssessments ?? []).filter(a => a.paperId !== action.paperId)
          : (state.robAssessments ?? []),
      }
    }

    case 'ADD_TO_REVIEW': {
      const base = state.results.find(r => r.id === action.paperId)
      if (!base) return state
      // Provenance travels with the decision. Including a paper clears any prior
      // exclusion / uncertain state so a re-decided paper is never left in two
      // states at once.
      const decided = {
        status: action.status,
        screenedBy: action.by,
        screeningReason: action.reason,
        exclusionReasonId: null,
        screenUncertain: false,
        screenStatus: undefined,
      }
      const inList = state.reviewList.some(r => r.id === action.paperId)
      return {
        ...state,
        results: state.results.map(r => r.id === action.paperId ? { ...r, ...decided } : r),
        reviewList: inList
          ? state.reviewList.map(r => r.id === action.paperId ? { ...r, ...decided } : r)
          : [...state.reviewList, { ...base, ...decided }],
      }
    }

    case 'REMOVE_FROM_REVIEW':
      // Returning the paper to unscreened keeps the PRISMA funnel adding up: a
      // record is either excluded with a reason, still awaiting screening, or
      // in the review list — never silently absent from all three.
      return {
        ...state,
        reviewList: state.reviewList.filter(r => r.id !== action.paperId),
        results: state.results.map(r =>
          r.id === action.paperId
            ? { ...r, status: null, screenedBy: undefined, screeningReason: undefined, screenUncertain: false }
            : r
        ),
        robAssessments: (state.robAssessments ?? []).filter(a => a.paperId !== action.paperId),
      }

    case 'UPDATE_REVIEW_STATUS':
      // `results` is what the PRISMA export and the search-result badges read,
      // so the status has to be written to both copies or the two disagree.
      return {
        ...state,
        reviewList: state.reviewList.map(r => r.id === action.paperId ? { ...r, status: action.status } : r),
        results: state.results.map(r => r.id === action.paperId ? { ...r, status: action.status } : r),
      }

    case 'ADD_DECISION_JOURNAL_ENTRY':
      return { ...state, decisionJournal: [...state.decisionJournal, action.entry] }

    case 'SEND_MESSAGE': {
      const userMsg = {
        id: newId('msg'),
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
          r.id === action.paperId
            ? { ...r, relevanceScore: action.score, confidence: action.confidence, scoreStatus: 'scored' as const }
            : r
        ),
      }

    case 'SET_SYSTEM_MATRIX_ENABLED':
      return { ...state, systemMatrixEnabled: action.enabled }

    case 'SET_MATRIX_COLUMN_SUGGESTIONS':
      return { ...state, matrixColumnSuggestions: action.columns }

    case 'SET_SYSTEM_MATRIX_COLUMN_SUGGESTIONS':
      return { ...state, systemMatrixColumnSuggestions: action.columns }

    case 'MERGE_COLUMN_DESCRIPTIONS':
      return action.system
        ? { ...state, systemColumnDescriptions: { ...state.systemColumnDescriptions, ...action.descriptions } }
        : { ...state, columnDescriptions: { ...state.columnDescriptions, ...action.descriptions } }

    case 'SET_MATRIX_COLUMNS':
      return { ...state, matrixColumns: action.columns }

    case 'ADD_MATRIX_COLUMN': {
      if (!action.column.trim() || state.matrixColumns.includes(action.column.trim())) return state
      return { ...state, matrixColumns: [...state.matrixColumns, action.column.trim()] }
    }

    case 'RENAME_MATRIX_COLUMN': {
      const newName = action.newName.trim()
      if (!newName || newName === action.oldName || state.matrixColumns.includes(newName)) return state
      // A column name is a key in three other places. Renaming only the column
      // list would orphan its description and leave every theme pointing at a
      // column that no longer exists — which the synthesis step then sends to
      // the backend as a source it cannot resolve.
      return {
        ...state,
        matrixColumns: state.matrixColumns.map(c => c === action.oldName ? newName : c),
        matrixRows: state.matrixRows.map(row => {
          if (!(action.oldName in row.cells)) return row
          const { [action.oldName]: cell, ...rest } = row.cells
          return { ...row, cells: { ...rest, [newName]: cell } }
        }),
        columnDescriptions: renameKey(state.columnDescriptions, action.oldName, newName),
        themes: state.themes.map(t => ({
          ...t,
          sourceColumns: (t.sourceColumns ?? []).map(c => c === action.oldName ? newName : c),
        })),
      }
    }

    case 'REMOVE_MATRIX_COLUMN':
      return {
        ...state,
        matrixColumns: state.matrixColumns.filter(c => c !== action.column),
        matrixRows: state.matrixRows.map(row => {
          if (!(action.column in row.cells)) return row
          const cells = { ...row.cells }
          delete cells[action.column]
          return { ...row, cells }
        }),
        columnDescriptions: dropKey(state.columnDescriptions, action.column),
        themes: state.themes.map(t => ({
          ...t,
          sourceColumns: (t.sourceColumns ?? []).filter(c => c !== action.column),
        })),
      }

    case 'SYNC_MATRIX_ROWS': {
      // Reconcile rows against the review list *incrementally*. Rebuilding them
      // wholesale would throw away every filled cell — including ones a student
      // has verified by hand — the moment a single paper leaves the list.
      const existing = new Map(state.matrixRows.map(r => [r.paperId, r]))
      const rows = state.reviewList.map(paper => {
        const held = existing.get(paper.id)
        if (!held) {
          return {
            paperId: paper.id,
            title: paper.title,
            authors: paper.authors,
            year: paper.year,
            cells: {} as Record<string, import('../types').MatrixCell>,
          }
        }
        // Metadata is refreshed from the review list, but only by building a new
        // row when it actually differs — otherwise the identity check below can
        // never see "unchanged" and the effect that calls this would re-render
        // forever. `cells` is the user's work and is carried across untouched.
        const stale = held.title !== paper.title || held.authors !== paper.authors || held.year !== paper.year
        return stale ? { ...held, title: paper.title, authors: paper.authors, year: paper.year } : held
      })
      // Nothing changed — return the same object so this can run from an effect
      // on every render without causing one.
      const same = rows.length === state.matrixRows.length &&
        rows.every((r, i) => r === state.matrixRows[i])
      return same ? state : { ...state, matrixRows: rows }
    }

    // Extraction results never replace a cell the reviewer has verified.
    case 'UPDATE_MATRIX_ROW_CELLS':
      return {
        ...state,
        matrixRows: state.matrixRows.map(row =>
          row.paperId === action.paperId ? { ...row, cells: mergeExtractedCells(row.cells, action.cells) } : row
        ),
      }

    case 'UPDATE_SYSTEM_MATRIX_ROW_CELLS':
      return {
        ...state,
        systemMatrixRows: (state.systemMatrixRows ?? []).map(row =>
          row.systemId === action.systemId ? { ...row, cells: mergeExtractedCells(row.cells, action.cells) } : row
        ),
      }

    case 'REVIEW_MATRIX_CELL': {
      const now = new Date().toISOString()
      const apply = (cells: Record<string, MatrixCell>) => {
        const next = reviewCell(cells[action.column], action.verified, action.value, now, action.explanation)
        return next ? { ...cells, [action.column]: next } : cells
      }
      return action.matrix === 'literature'
        ? { ...state, matrixRows: state.matrixRows.map(row => row.paperId === action.rowId ? { ...row, cells: apply(row.cells) } : row) }
        : { ...state, systemMatrixRows: (state.systemMatrixRows ?? []).map(row => row.systemId === action.rowId ? { ...row, cells: apply(row.cells) } : row) }
    }

    case 'RESET_MATRIX_CELL': {
      const apply = (cells: Record<string, MatrixCell>) => {
        const next = resetCell(cells[action.column])
        return next ? { ...cells, [action.column]: next } : cells
      }
      return action.matrix === 'literature'
        ? { ...state, matrixRows: state.matrixRows.map(row => row.paperId === action.rowId ? { ...row, cells: apply(row.cells) } : row) }
        : { ...state, systemMatrixRows: (state.systemMatrixRows ?? []).map(row => row.systemId === action.rowId ? { ...row, cells: apply(row.cells) } : row) }
    }

    case 'SET_CERTAINTY_ASSESSMENT':
      return {
        ...state,
        certaintyAssessments: [
          ...(state.certaintyAssessments ?? []).filter(a => a.themeId !== action.assessment.themeId),
          action.assessment,
        ],
      }

    case 'UPDATE_CERTAINTY_DOMAIN':
      return {
        ...state,
        certaintyAssessments: (state.certaintyAssessments ?? []).map(a => {
          if (a.themeId !== action.themeId) return a
          const current = a.domains[action.domainId] ?? { judgement: '', rationale: '', aiGenerated: false, verifiedByStudent: false }
          return {
            ...a,
            domains: {
              ...a.domains,
              [action.domainId]: {
                ...current,
                judgement: action.judgement ?? current.judgement,
                rationale: action.rationale ?? current.rationale,
                // Changing a judgement is itself the reviewer's sign-off on it.
                verifiedByStudent: action.verified ?? (action.judgement !== undefined ? true : current.verifiedByStudent),
              },
            },
          }
        }),
      }

    case 'UPDATE_CERTAINTY_ASSESSMENT':
      return {
        ...state,
        certaintyAssessments: (state.certaintyAssessments ?? []).map(a => a.themeId !== action.themeId ? a : {
          ...a,
          ...(action.finding !== undefined ? { finding: action.finding } : {}),
          ...(action.startLevel !== undefined ? { startLevel: action.startLevel } : {}),
          ...(action.override !== undefined ? { override: action.override } : {}),
        }),
      }

    case 'REMOVE_CERTAINTY_ASSESSMENT':
      return { ...state, certaintyAssessments: (state.certaintyAssessments ?? []).filter(a => a.themeId !== action.themeId) }

    case 'SET_INTEGRITY_CHECKS':
      return { ...state, integrityChecks: { ...(state.integrityChecks ?? {}), ...action.checks } }

    case 'VERIFY_MATRIX_CELLS': {
      const now = new Date().toISOString()
      const ids = new Set(action.rowIds)
      const apply = (id: string, cells: Record<string, MatrixCell>) => {
        const cell = cells[action.column]
        if (!ids.has(id) || !cell || cell.verifiedByStudent) return cells
        return { ...cells, [action.column]: { ...cell, verifiedByStudent: true, verifiedAt: now } }
      }
      return action.matrix === 'literature'
        ? { ...state, matrixRows: state.matrixRows.map(row => ({ ...row, cells: apply(row.paperId, row.cells) })) }
        : { ...state, systemMatrixRows: (state.systemMatrixRows ?? []).map(row => ({ ...row, cells: apply(row.systemId, row.cells) })) }
    }

    case 'SET_SYSTEM_MATRIX_COLUMNS':
      return { ...state, systemMatrixColumns: action.columns }

    case 'ADD_SYSTEM_MATRIX_COLUMN': {
      if (!action.column.trim() || (state.systemMatrixColumns ?? []).includes(action.column.trim())) return state
      return { ...state, systemMatrixColumns: [...(state.systemMatrixColumns ?? []), action.column.trim()] }
    }

    case 'RENAME_SYSTEM_MATRIX_COLUMN': {
      const newName = action.newName.trim()
      if (!newName || newName === action.oldName || (state.systemMatrixColumns ?? []).includes(newName)) return state
      return {
        ...state,
        systemMatrixColumns: (state.systemMatrixColumns ?? []).map(c => c === action.oldName ? newName : c),
        systemMatrixRows: (state.systemMatrixRows ?? []).map(row => {
          if (!(action.oldName in row.cells)) return row
          const { [action.oldName]: cell, ...rest } = row.cells
          return { ...row, cells: { ...rest, [newName]: cell } }
        }),
        systemColumnDescriptions: renameKey(state.systemColumnDescriptions, action.oldName, newName),
        themes: state.themes.map(t => ({
          ...t,
          systemSourceColumns: (t.systemSourceColumns ?? []).map(c => c === action.oldName ? newName : c),
        })),
      }
    }

    case 'REMOVE_SYSTEM_MATRIX_COLUMN':
      return {
        ...state,
        systemMatrixColumns: (state.systemMatrixColumns ?? []).filter(c => c !== action.column),
        systemMatrixRows: (state.systemMatrixRows ?? []).map(row => {
          if (!(action.column in row.cells)) return row
          const cells = { ...row.cells }
          delete cells[action.column]
          return { ...row, cells }
        }),
        systemColumnDescriptions: dropKey(state.systemColumnDescriptions, action.column),
        themes: state.themes.map(t => ({
          ...t,
          systemSourceColumns: (t.systemSourceColumns ?? []).filter(c => c !== action.column),
        })),
      }

    case 'SYNC_SYSTEM_MATRIX_ROWS': {
      // Same incremental reconciliation as SYNC_MATRIX_ROWS: deselecting one
      // system must not wipe the extraction work done on all the others.
      const existing = new Map((state.systemMatrixRows ?? []).map(r => [r.systemId, r]))
      const rows: SystemMatrixRow[] = (state.systemItems ?? [])
        .filter(s => s.selected)
        .map(s => {
          const held = existing.get(s.id)
          if (!held) {
            return {
              systemId: s.id,
              name: s.name,
              vendor: s.vendor,
              category: s.category,
              url: s.url,
              cells: {} as Record<string, import('../types').MatrixCell>,
            }
          }
          const stale = held.name !== s.name || held.vendor !== s.vendor ||
            held.category !== s.category || held.url !== s.url
          return stale ? { ...held, name: s.name, vendor: s.vendor, category: s.category, url: s.url } : held
        })
      const prev = state.systemMatrixRows ?? []
      const same = rows.length === prev.length && rows.every((r, i) => r === prev[i])
      return same ? state : { ...state, systemMatrixRows: rows }
    }

    case 'IMPORT_RECORDS': {
      // Imported records go through exactly the de-duplication the tool's own
      // search results do: the same study is legitimately in both a Scopus
      // export and an OpenAlex result set, and screening it twice is waste and
      // a reliability problem at once. What the import must not do is write to
      // `retrievedByQuery` — the duplicate figure is derived from that against
      // the papers held from database *queries*, so adding a file's records to
      // one side of that subtraction and not the other would corrupt it. The
      // duplicates this import did remove are reported from its own counts.
      const { fresh, enrichments } = partitionNewPapers(state.results, action.papers)
      const enrichedById = new Map(enrichments.map(e => [e.id, e.abstract]))
      const results = state.results.map(r =>
        enrichedById.has(r.id) ? { ...r, abstract: enrichedById.get(r.id)! } : r
      )
      return {
        ...state,
        results: [...results, ...fresh],
        importedSearches: [
          ...state.importedSearches,
          { ...action.search, recordsAdded: fresh.length },
        ],
      }
    }

    case 'ADD_UPLOADED_PAPERS': {
      const { fresh } = partitionNewPapers([...state.results, ...state.reviewList], action.papers)
      if (fresh.length === 0) return state
      return {
        ...state,
        results: [...state.results, ...fresh],
        reviewList: [...state.reviewList, ...fresh],
        matrixRows: [
          ...state.matrixRows,
          ...fresh.map(p => ({
            paperId: p.id,
            title: p.title,
            authors: p.authors,
            year: p.year,
            cells: {} as Record<string, import('../types').MatrixCell>,
          })),
        ],
      }
    }

    case 'ADD_SYSTEM_WITH_ROW': {
      const nameKey = action.item.name.toLowerCase().trim()
      if ((state.systemItems ?? []).some(s => s.name.toLowerCase().trim() === nameKey)) return state
      return {
        ...state,
        systemItems: [...(state.systemItems ?? []), action.item],
        systemMatrixRows: [
          ...(state.systemMatrixRows ?? []),
          {
            systemId: action.item.id,
            name: action.item.name,
            vendor: action.item.vendor,
            category: action.item.category,
            url: action.item.url,
            cells: {} as Record<string, import('../types').MatrixCell>,
          },
        ],
      }
    }

    case 'UPDATE_THEME_COLUMNS':
      return { ...state, themes: state.themes.map(t => t.id === action.themeId ? { ...t, sourceColumns: action.columns } : t) }

    case 'SELECT_RQ':
      return { ...state, selectedRQId: action.rqId }

    case 'SELECT_STUDY_DESIGN':
      return { ...state, selectedStudyDesignId: action.designId }

    case 'UPDATE_GAP_STATEMENT':
      return { ...state, gapStatement: action.text }

    case 'SET_AXIS_GAP':
      return { ...state, axisGaps: { ...state.axisGaps, [action.key]: action.text } }

    case 'SET_PAPER_FULL_TEXT': {
      if (!action.text) return state
      const held = state.paperFullTexts ?? {}
      if (held[action.paperId] === action.text) return state
      return { ...state, paperFullTexts: { ...held, [action.paperId]: action.text } }
    }

    case 'SET_ROB_TOOL':
      // Changing instrument invalidates existing assessments: the domains and
      // the judgement scale both differ, so a RoB 2 rating cannot be carried
      // across to ROBINS-I. Dropping them is the honest move — silently
      // relabelling them would misreport which appraisal was actually done.
      return action.toolId === state.robToolId
        ? state
        : { ...state, robToolId: action.toolId, robAssessments: [] }

    case 'SET_ROB_ASSESSMENT': {
      const others = (state.robAssessments ?? []).filter(a => a.paperId !== action.assessment.paperId)
      return { ...state, robAssessments: [...others, action.assessment] }
    }

    case 'UPDATE_ROB_DOMAIN':
      // A human edit to any part of a domain marks it confirmed unless the
      // caller says otherwise — reviewing the AI's draft *is* the sign-off.
      return {
        ...state,
        robAssessments: (state.robAssessments ?? []).map(assessment => {
          if (assessment.paperId !== action.paperId) return assessment
          const current = assessment.domains[action.domainId]
          if (!current) return assessment
          return {
            ...assessment,
            domains: {
              ...assessment.domains,
              [action.domainId]: {
                ...current,
                judgement: action.judgement ?? current.judgement,
                rationale: action.rationale ?? current.rationale,
                verifiedByStudent: action.verifiedByStudent ?? true,
              },
            },
          }
        }),
      }

    case 'CLEAR_ROB_ASSESSMENTS':
      return { ...state, robAssessments: [] }

    case 'SET_THEMES': {
      // Regenerating the synthesis replaces the model's themes, never the
      // reviewer's own: those are kept, after the new generated ones.
      const generated = action.themes.map(t => ({ ...t, systemSourceColumns: t.systemSourceColumns ?? [] }))
      const kept = state.themes.filter(t => t.userDefined && !generated.some(g => g.id === t.id))
      const themes = [...generated, ...kept]
      return {
        ...state,
        themes,
        activeThemeId: themes[0]?.id ?? state.activeThemeId,
      }
    }

    case 'ADD_THEME': {
      const name = action.theme.name.trim()
      if (!name) return state
      return {
        ...state,
        themes: [...state.themes, { ...action.theme, name, systemSourceColumns: action.theme.systemSourceColumns ?? [] }],
        activeThemeId: action.theme.id,
      }
    }

    case 'RENAME_THEME': {
      const name = action.name.trim()
      if (!name) return state
      return { ...state, themes: state.themes.map(t => t.id === action.themeId ? { ...t, name } : t) }
    }

    case 'REMOVE_THEME': {
      const themes = state.themes.filter(t => t.id !== action.themeId)
      return {
        ...state,
        themes,
        activeThemeId: state.activeThemeId === action.themeId ? (themes[0]?.id ?? '') : state.activeThemeId,
        certaintyAssessments: (state.certaintyAssessments ?? []).filter(a => a.themeId !== action.themeId),
      }
    }

    case 'SET_ACTIVE_THEME':
      return { ...state, activeThemeId: action.themeId }

    case 'REMOVE_SYNTHESIS_BLOCK':
      return {
        ...state,
        themes: state.themes.map(t =>
          t.id === action.themeId ? { ...t, blocks: t.blocks.filter(b => b.id !== action.blockId) } : t
        ),
      }

    case 'ADD_SYNTHESIS_BLOCK':
      return { ...state, themes: state.themes.map(t => t.id === action.themeId ? { ...t, blocks: [...t.blocks, action.block] } : t) }

    case 'UPDATE_SYNTHESIS_BLOCK':
      return {
        ...state,
        themes: state.themes.map(t =>
          t.id === action.themeId
            // A regenerated block brings its own evidence figures; a hand edit
            // does not, and keeps the figures the block already had.
            ? { ...t, blocks: t.blocks.map(b => b.id === action.blockId ? { ...b, content: action.content, ...(action.stats ?? {}) } : b) }
            : t
        ),
      }

    case 'UPDATE_THEME_SYSTEM_COLUMNS':
      return { ...state, themes: state.themes.map(t => t.id === action.themeId ? { ...t, systemSourceColumns: action.columns } : t) }

    case 'SET_RQ_OPTIONS':
      return { ...state, rqOptions: action.options, selectedRQId: action.options[0]?.id ?? state.selectedRQId }

    case 'SET_STUDY_DESIGN_OPTIONS':
      return {
        ...state,
        studyDesignOptions: action.options,
        selectedStudyDesignId: action.options.some(option => option.id === state.selectedStudyDesignId)
          ? state.selectedStudyDesignId
          : null,
      }

    case 'SET_FINAL_TOPIC_OPTIONS':
      return {
        ...state,
        finalTopicOptions: action.options,
        selectedFinalTopicId: state.selectedFinalTopicId ?? action.options[0]?.id ?? null,
      }

    case 'UPDATE_PAPER_SECTIONS':
      return {
        ...state,
        topicFinalData: (state.topicFinalData ?? []).map(d =>
          d.topicId === action.topicId ? { ...d, paperSections: action.sections } : d
        ),
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
      // Discarding a search result has to remove every downstream trace of it.
      // Leaving the review-list copy or the matrix row behind would keep a
      // paper in the synthesis that the user believes they deleted.
      const ids = new Set(action.paperIds)
      return {
        ...state,
        results: state.results.filter(r => !ids.has(r.id)),
        reviewList: state.reviewList.filter(r => !ids.has(r.id)),
        matrixRows: state.matrixRows.filter(r => !ids.has(r.paperId)),
        robAssessments: (state.robAssessments ?? []).filter(a => !ids.has(a.paperId)),
        paperFullTexts: pruneFullTexts(state.paperFullTexts, id => ids.has(id)),
      }
    }

    case 'UPDATE_ACTION_STATUS':
      return {
        ...state,
        chatMessages: state.chatMessages.map(m =>
          m.id === action.messageId
            ? {
                ...m,
                proposedActions: m.proposedActions?.map(a =>
                  a.id === action.actionId ? { ...a, status: action.status, note: action.note } : a
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

/** A matrix cell and its row's display label, for journal entries. */
function matrixCellContext(state: AppState, matrix: MatrixKind, rowId: string, column: string) {
  const row = matrix === 'literature'
    ? state.matrixRows.find(r => r.paperId === rowId)
    : (state.systemMatrixRows ?? []).find(r => r.systemId === rowId)
  const label = row ? ('title' in row ? row.title : row.name) : 'Matrix row'
  return { label, cell: row?.cells[column] }
}

function automaticAuditEntry(state: AppState, action: AppAction): DecisionJournalEntry | null {
  const base = {
    id: newId('audit'),
    kind: 'user_action' as const,
    createdAt: new Date().toISOString(),
  }
  switch (action.type) {
    case 'SEND_MESSAGE':
      return { ...base, step: 1, action: 'Contributed research context in chat', entityType: 'profile', entityId: 'research-chat', entityLabel: 'Research definition conversation', details: action.content }
    case 'UPDATE_PROFILE':
      return { ...base, step: 1, action: `Updated research profile: ${String(action.field)}`, entityType: 'profile', entityId: String(action.field), entityLabel: String(action.field), previousValue: state.profile[action.field], newValue: action.value }
    case 'SET_MATRIX_COLUMNS':
      return state.currentStep === 2
        ? { ...base, step: 2, action: 'Changed initial literature matrix schema', entityType: 'matrix_column', entityId: 'initial-literature-schema', entityLabel: 'Literature matrix schema', previousValue: state.matrixColumns.join(', '), newValue: action.columns.join(', ') }
        : null
    case 'SET_SYSTEM_MATRIX_COLUMNS':
      return state.currentStep === 2
        ? { ...base, step: 2, action: 'Changed initial system matrix schema', entityType: 'matrix_column', entityId: 'initial-system-schema', entityLabel: 'System matrix schema', previousValue: state.systemMatrixColumns.join(', '), newValue: action.columns.join(', ') }
        : null
    case 'REVIEW_MATRIX_CELL': {
      const { label, cell: before } = matrixCellContext(state, action.matrix, action.rowId, action.column)
      const edited = action.value !== undefined && action.value.trim() !== (before?.value ?? '').trim()
      const verb = edited
        ? `${!before || before.evidenceType === 'not_available' ? 'Filled in' : 'Corrected'}${action.verified ? ' and confirmed' : ''}`
        : action.verified ? 'Confirmed' : 'Withdrew confirmation of'
      const justification = edited ? describeEditExplanation(action.explanation) : undefined
      return {
        ...base, step: 5,
        ...(justification ? { kind: 'justification' as const, justification } : {}),
        action: `${verb} ${action.matrix} matrix cell${edited && !action.verified ? ' (saved, not confirmed)' : ''}`,
        entityType: 'matrix_cell',
        entityId: `${action.rowId}:${action.column}`,
        entityLabel: `${label} — ${action.column}`,
        ...(edited ? { previousValue: before?.value ?? '', newValue: action.value!.trim() } : {}),
        details: describeAiExtraction(before),
      }
    }
    case 'RESET_MATRIX_CELL': {
      const { label, cell: before } = matrixCellContext(state, action.matrix, action.rowId, action.column)
      if (before?.originalValue === undefined) return null
      return {
        ...base, step: 5,
        action: `Reset ${action.matrix} matrix cell to the AI extraction`,
        entityType: 'matrix_cell',
        entityId: `${action.rowId}:${action.column}`,
        entityLabel: `${label} — ${action.column}`,
        previousValue: before.value, newValue: before.originalValue,
        details: describeAiExtraction(before),
      }
    }
    case 'UPDATE_CERTAINTY_DOMAIN': {
      if (action.judgement === undefined && action.verified === undefined) return null
      const theme = state.themes.find(t => t.id === action.themeId)
      const before = state.certaintyAssessments?.find(a => a.themeId === action.themeId)?.domains[action.domainId]
      const changed = action.judgement !== undefined && action.judgement !== before?.judgement
      return {
        ...base, step: 6,
        action: changed ? `Changed certainty judgement: ${action.domainId}` : action.verified ? `Confirmed certainty judgement: ${action.domainId}` : `Withdrew confirmation of certainty judgement: ${action.domainId}`,
        entityType: 'theme', entityId: `${action.themeId}:${action.domainId}`, entityLabel: theme?.name ?? action.themeId,
        ...(changed ? { previousValue: before?.judgement ?? '', newValue: action.judgement } : {}),
      }
    }
    case 'UPDATE_CERTAINTY_ASSESSMENT': {
      if (action.override === undefined && action.startLevel === undefined) return null
      const theme = state.themes.find(t => t.id === action.themeId)
      if (action.override !== undefined) {
        return {
          ...base, kind: 'justification' as const, step: 6,
          action: action.override ? 'Overrode certainty rating' : 'Removed certainty override',
          entityType: 'theme', entityId: action.themeId, entityLabel: theme?.name ?? action.themeId,
          newValue: action.override?.level, justification: action.override?.reason || undefined,
        }
      }
      return {
        ...base, step: 6, action: 'Changed GRADE starting level',
        entityType: 'theme', entityId: action.themeId, entityLabel: theme?.name ?? action.themeId, newValue: action.startLevel,
      }
    }
    case 'SET_INTEGRITY_CHECKS': {
      // Only a newly found problem is worth a journal line; clear results and
      // re-checks that change nothing are not decisions.
      const flagged = Object.entries(action.checks).filter(([id, c]) =>
        (c.status === 'retracted' || c.status === 'concern') && state.integrityChecks?.[id]?.status !== c.status)
      if (flagged.length === 0) return null
      const titles = flagged.map(([id]) => state.reviewList.find(p => p.id === id)?.title ?? id)
      return {
        ...base, kind: 'automated_check' as const, step: state.currentStep,
        action: `Publication integrity check flagged ${flagged.length} included paper${flagged.length === 1 ? '' : 's'}`,
        entityType: 'paper', entityId: flagged.map(([id]) => id).join('|'), entityLabel: titles.join('; '),
        details: flagged.map(([, c], i) => `${titles[i]}: ${c.status === 'retracted' ? 'retracted' : 'expression of concern'}`).join('\n'),
      }
    }
    case 'VERIFY_MATRIX_CELLS':
      return {
        ...base, step: 5,
        action: `Verified ${action.rowIds.length} ${action.matrix} matrix cell${action.rowIds.length === 1 ? '' : 's'} in one column`,
        entityType: 'matrix_cell',
        entityId: `column:${action.column}`,
        entityLabel: action.column,
        details: action.rowIds.map(id => {
          const { label, cell } = matrixCellContext(state, action.matrix, id, action.column)
          const ai = cell?.aiGenerated ? ` (AI, ${cell.confidenceScore}% confidence)` : ''
          return `${label}: ${cell?.value || 'Not reported'}${ai}`
        }).join('\n'),
      }
    case 'SET_SYSTEM_MATRIX_ENABLED':
      return { ...base, step: 2, action: action.enabled ? 'Enabled system matrix' : 'Disabled system matrix', entityType: 'matrix_column', entityId: 'system-matrix-enabled', entityLabel: 'System matrix', newValue: String(action.enabled) }
    case 'TOGGLE_SYSTEM_ITEM': {
      const item = state.systemItems.find(s => s.id === action.itemId)
      return { ...base, step: 3, action: item?.selected ? 'Deselected system' : 'Selected system', entityType: 'system', entityId: action.itemId, entityLabel: item?.name ?? action.itemId }
    }
    case 'ADD_CUSTOM_SYSTEM':
      return { ...base, step: 3, action: 'Added custom system', entityType: 'system', entityId: action.name, entityLabel: action.name }
    case 'SET_SYSTEM_TOPIC_LINKS':
      return { ...base, step: 3, action: 'Mapped systems onto topics', entityType: 'system', entityId: 'topic-system-links', entityLabel: `${action.links.length} link${action.links.length === 1 ? '' : 's'}` }
    case 'TOGGLE_TOPIC': {
      const topic = state.topics.find(t => t.id === action.topicId)
      return { ...base, step: 3, action: topic?.selected ? 'Deselected topic' : 'Selected topic', entityType: 'topic', entityId: action.topicId, entityLabel: topic?.title ?? action.topicId }
    }
    case 'ADD_TOPIC':
      return { ...base, step: 3, action: 'Added custom topic', entityType: 'topic', entityId: action.topic.id, entityLabel: action.topic.title, details: action.topic.description }
    case 'SET_SEARCH_SOURCES':
      return { ...base, step: 3, action: 'Changed which databases are searched', entityType: 'search_filter', entityId: 'search-sources', entityLabel: 'Databases searched', previousValue: state.searchSources.join(', '), newValue: action.sources.join(', ') }
    case 'SET_SEARCH_FILTERS':
      return { ...base, step: 3, action: 'Changed database search filters', entityType: 'search_filter', entityId: 'search-filters', entityLabel: 'Search filters', previousValue: JSON.stringify(state.searchFilters), newValue: JSON.stringify(action.filters) }
    case 'ADD_SEARCH_RESULTS':
      return action.results.length
        ? { ...base, step: 3, action: action.results[0]?.origin === 'snowball' ? 'Added citation-snowball results' : 'Ran database search', entityType: 'query', entityId: action.identifiedFor?.queryId ?? action.results[0]?.queryId ?? 'search', entityLabel: `${action.results.length} paper${action.results.length === 1 ? '' : 's'} added` }
        : null
    case 'IMPORT_RECORDS':
      return { ...base, step: 3, action: `Imported records from ${action.search.database}`, entityType: 'query', entityId: action.search.id, entityLabel: `${action.papers.length} record${action.papers.length === 1 ? '' : 's'} in ${action.search.filename}`, details: action.search.queryAsRun }
    case 'ADD_CRITERION':
      return { ...base, step: 4, action: 'Added screening criterion', entityType: 'screening_protocol', entityId: action.criterion.id, entityLabel: action.criterion.label, details: action.criterion.kind }
    case 'REMOVE_CRITERION': {
      const criterion = state.criteria.find(c => c.id === action.criterionId)
      return { ...base, step: 4, action: 'Removed screening criterion', entityType: 'screening_protocol', entityId: action.criterionId, entityLabel: criterion?.label ?? action.criterionId }
    }
    case 'ADD_TO_REVIEW': {
      if (action.by === 'ai') return null
      const paper = state.results.find(p => p.id === action.paperId)
      return { ...base, step: 4, action: action.status === 'maybe' ? 'Marked paper as pending' : 'Included paper', entityType: 'paper', entityId: action.paperId, entityLabel: paper?.title ?? action.paperId, justification: action.reason }
    }
    case 'EXCLUDE_PAPER': {
      if (action.by === 'ai') return null
      const paper = state.results.find(p => p.id === action.paperId)
      const criterion = state.criteria.find(c => c.id === action.reasonId)
      return { ...base, step: 4, action: 'Excluded paper', entityType: 'paper', entityId: action.paperId, entityLabel: paper?.title ?? action.paperId, justification: action.reason, details: criterion?.label }
    }
    case 'REMOVE_FROM_REVIEW': {
      const paper = state.reviewList.find(p => p.id === action.paperId)
      return { ...base, step: 4, action: 'Removed paper from review list', entityType: 'paper', entityId: action.paperId, entityLabel: paper?.title ?? action.paperId }
    }
    case 'UPDATE_REVIEW_STATUS': {
      const paper = state.reviewList.find(p => p.id === action.paperId)
      return { ...base, step: 4, action: 'Changed paper review status', entityType: 'paper', entityId: action.paperId, entityLabel: paper?.title ?? action.paperId, previousValue: paper?.status ?? '', newValue: action.status ?? '' }
    }
    case 'SET_ROB_TOOL':
      return { ...base, step: 5, action: action.toolId ? 'Chose a risk-of-bias instrument' : 'Turned off risk-of-bias appraisal', entityType: 'quality_appraisal', entityId: action.toolId ?? 'none', entityLabel: action.toolId ?? 'None', previousValue: state.robToolId ?? '', newValue: action.toolId ?? '' }
    case 'UPDATE_ROB_DOMAIN': {
      const paper = state.reviewList.find(p => p.id === action.paperId)
      return { ...base, step: 5, action: 'Confirmed a risk-of-bias judgement', entityType: 'quality_appraisal', entityId: `${action.paperId}:${action.domainId}`, entityLabel: `${paper?.title ?? action.paperId} — ${action.domainId}`, newValue: action.judgement ?? '', justification: action.rationale }
    }
    case 'UPDATE_THEME_COLUMNS': {
      const theme = state.themes.find(t => t.id === action.themeId)
      return { ...base, step: 6, action: 'Changed synthesis evidence columns', entityType: 'theme', entityId: action.themeId, entityLabel: theme?.name ?? action.themeId, previousValue: theme?.sourceColumns.join(', '), newValue: action.columns.join(', ') }
    }
    case 'ADD_THEME':
      return { ...base, step: 6, action: 'Added a synthesis theme', entityType: 'theme', entityId: action.theme.id, entityLabel: action.theme.name, details: action.theme.sourceColumns.join(', ') }
    case 'RENAME_THEME': {
      const theme = state.themes.find(t => t.id === action.themeId)
      return { ...base, step: 6, action: 'Renamed a synthesis theme', entityType: 'theme', entityId: action.themeId, entityLabel: action.name, previousValue: theme?.name, newValue: action.name }
    }
    case 'REMOVE_THEME': {
      const theme = state.themes.find(t => t.id === action.themeId)
      return { ...base, step: 6, action: 'Deleted a synthesis theme', entityType: 'theme', entityId: action.themeId, entityLabel: theme?.name ?? action.themeId }
    }
    case 'UPDATE_THEME_SYSTEM_COLUMNS': {
      const theme = state.themes.find(t => t.id === action.themeId)
      return { ...base, step: 6, action: 'Changed synthesis system-evidence columns', entityType: 'theme', entityId: action.themeId, entityLabel: theme?.name ?? action.themeId, previousValue: theme?.systemSourceColumns.join(', '), newValue: action.columns.join(', ') }
    }
    case 'SELECT_RQ': {
      const rq = state.rqOptions.find(item => item.id === action.rqId)
      return { ...base, step: 7, action: 'Selected research question', entityType: 'research_question', entityId: action.rqId, entityLabel: rq?.text ?? action.rqId }
    }
    case 'SELECT_STUDY_DESIGN': {
      const design = state.studyDesignOptions.find(item => item.id === action.designId)
      return { ...base, step: 7, action: 'Selected study design', entityType: 'study_design', entityId: action.designId, entityLabel: design?.name ?? action.designId }
    }
    case 'SELECT_FINAL_TOPIC': {
      const topic = state.finalTopicOptions.find(item => item.id === action.topicId)
      return { ...base, step: 7, action: 'Selected final topic', entityType: 'final_topic', entityId: action.topicId, entityLabel: topic?.title ?? action.topicId }
    }
    default:
      return null
  }
}

// Actions that only change UI state — do NOT trigger a save or undo entry
const UI_ONLY_ACTIONS = new Set([
  'TOGGLE_HISTORY', 'SET_SAVE_STATUS', 'SET_ACTIVE_THEME',
  'DISMISS_BACK_NAV_MODAL',
  'BACK_NAV_CANCEL', 'BACK_NAV_REQUEST',
  // Review mode is a way of looking at the session, not part of it.
  'SET_REVIEW_MODE',
])

/**
 * Actions that change the document but must not themselves be pushed onto the
 * undo stack — RESTORE_STATE *is* the undo, so recording it would make undo
 * unreachable. It still has to trigger a save: leaving it in UI_ONLY_ACTIONS
 * meant an undone change came back on the next reload.
 */
// A background lookup result is not a user edit: undoing it would only make
// the next check run again.
const NO_HISTORY_ACTIONS = new Set(['RESTORE_STATE', 'SET_INTEGRITY_CHECKS'])

const MAX_HISTORY = 30

type AppContextValue = {
  state: AppState
  dispatch: React.Dispatch<AppAction>
  saveStatus: SaveStatus
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, getInitialState)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // Track last dispatched action type to skip UI-only state changes
  const lastActionRef = useRef<string>('__init__')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep a ref to current state so the timer callback always saves the latest snapshot
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Undo/redo stacks — stored in refs so mutations don't trigger re-renders
  const historyRef = useRef<AppState[]>([])
  const futureRef  = useRef<AppState[]>([])

  // Analytics: track when the user entered the current step
  const stepEntryTimeRef = useRef<number | null>(null)

  const wrappedDispatch: React.Dispatch<AppAction> = (action) => {
    // ── Analytics: track step navigation ────────────────────────────────────
    if (
      action.type === 'SET_STEP' ||
      action.type === 'ADVANCE_STEP' ||
      action.type === 'BACK_NAV_CONFIRM'
    ) {
      const cur = stateRef.current
      const toStep =
        action.type === 'SET_STEP'       ? action.step
        : action.type === 'ADVANCE_STEP' ? Math.min(cur.currentStep + 1, LAST_STEP)
        : (cur.pendingBackStep ?? cur.currentStep)

      const now = Date.now()
      const enteredAt = stepEntryTimeRef.current ?? now
      trackEvent('step_change', {
        step: toStep,
        from_step: cur.currentStep,
        to_step: toStep,
        time_on_step_ms: now - enteredAt,
        direction: toStep > cur.currentStep ? 'forward' : 'back',
        domain: cur.profile.domain || undefined,
      })
      stepEntryTimeRef.current = now
    }

    // Completing a step is the natural checkpoint: it is where a researcher
    // draws a line under a decision, and where they later say "put it back to
    // how it was before I moved on". Fire-and-forget — a checkpoint failing
    // must never block the user from advancing.
    if (action.type === 'ADVANCE_STEP' && stateRef.current.currentStep < LAST_STEP) {
      const completed = stateRef.current.currentStep
      void createVersion(stateRef.current, `Completed step ${completed}`, 'step_complete').catch(() => {})
    }

    if (!UI_ONLY_ACTIONS.has(action.type) && !NO_HISTORY_ACTIONS.has(action.type)) {
      // Push current state onto history, clear future
      historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 1)), stateRef.current]
      futureRef.current = []
      setCanUndo(true)
      setCanRedo(false)
    }
    lastActionRef.current = action.type
    const auditEntry = automaticAuditEntry(stateRef.current, action)
    dispatch(action)
    if (auditEntry) {
      dispatch({ type: 'ADD_DECISION_JOURNAL_ENTRY', entry: auditEntry })
    }
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
      // The status now follows what the save actually did. It used to be set to
      // 'saved' unconditionally, so a failed write showed a green tick.
      void saveSession(stateRef.current).then(setSaveStatus).catch(() => setSaveStatus('error'))
    }, 600)
  }, [state])

  // A debounced save loses whatever happened in the last 600ms if the tab is
  // closed inside that window. localStorage is synchronous, so the unload
  // handler can still get it out the door.
  useEffect(() => {
    function flush() {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        flushSessionLocal(stateRef.current)
      }
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [])

  // ── Analytics: sync session ID and lifecycle events ───────────────────────
  useEffect(() => {
    setAnalyticsSession(state.sessionId)
  }, [state.sessionId])

  useEffect(() => {
    // One-shot: push any pre-existing localStorage sessions to the durable
    // backend store so prior work is preserved when persistence is introduced.
    migrateLocalSessionsToRemote()

    // Report session start once on mount
    trackEvent('session_start', { step: stateRef.current.currentStep })

    // Heartbeat every 2 min while the tab is visible — gives the backend
    // accurate "last active" data for stuck-session detection even when the
    // user is reading/thinking without making API calls.
    const heartbeat = setInterval(() => {
      if (document.visibilityState === 'visible') {
        trackEvent('heartbeat', {
          step: stateRef.current.currentStep,
          domain: stateRef.current.profile.domain || undefined,
        })
      }
    }, 2 * 60 * 1000)

    return () => clearInterval(heartbeat)
  }, [])

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
