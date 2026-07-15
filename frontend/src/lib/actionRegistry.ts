/**
 * actionRegistry.ts
 *
 * SINGLE SOURCE OF TRUTH for chatbot-operable actions.
 *
 * Each entry declares:
 *   - `type`:    the action id the AI emits
 *   - `spec`:    the doc block injected into the assistant's system prompt so the
 *                model knows the action exists and how to shape its payload
 *   - `resolve`: turns an AI payload into concrete AppAction(s) to dispatch, OR
 *                returns an error string when the request can't be fulfilled
 *
 * To make a new feature chatbot-operable, add ONE entry here. `buildActionsSpec()`
 * feeds the backend automatically (no prompt editing), and resolve() failures are
 * surfaced to the user instead of silently doing nothing.
 */

import type { ProposedAction, AppAction, AppState } from '../types'

/** A resolve() returns AppActions to dispatch, or an error string on failure. */
type ResolveOutput = AppAction[] | string

interface ActionDef {
  type: string
  spec: string
  resolve: (payload: Record<string, unknown>, state: AppState) => ResolveOutput
}

const str = (v: unknown) => String(v ?? '')
const norm = (v: unknown) => str(v).toLowerCase().trim()

// ── Registry ──────────────────────────────────────────────────────────────────

const REGISTRY: ActionDef[] = [
  // ── Profile & session ──────────────────────────────────────────────────────
  {
    type: 'UPDATE_PROFILE',
    spec: `- UPDATE_PROFILE: Update one profile field
  payload: { "field": "domain"|"population"|"focus"|"method"|"reviewType", "value": "string" }`,
    resolve: (p) => {
      const field = str(p.field) as keyof AppState['profile']
      const allowed = ['domain', 'population', 'focus', 'method', 'reviewType']
      if (!allowed.includes(field)) return `Unknown profile field "${str(p.field)}".`
      return [{ type: 'UPDATE_PROFILE', field, value: str(p.value) }]
    },
  },
  {
    type: 'SET_SESSION_TITLE',
    spec: `- SET_SESSION_TITLE: Rename this research session
  payload: { "title": "string" }`,
    resolve: (p) => {
      const title = str(p.title)
      if (!title) return 'No title provided.'
      return [{ type: 'SET_SESSION_TITLE', title }]
    },
  },

  // ── Navigation ─────────────────────────────────────────────────────────────
  {
    type: 'NAVIGATE_TO_STEP',
    spec: `- NAVIGATE_TO_STEP: Jump to a workflow step
  payload: { "step": 1-9 }`,
    resolve: (p, state) => {
      const step = Number(p.step)
      if (isNaN(step) || step < 1 || step > 9) return `Invalid step "${str(p.step)}".`
      return step < state.currentStep
        ? [{ type: 'BACK_NAV_REQUEST', step }]
        : [{ type: 'SET_STEP', step }]
    },
  },

  // ── Step 2 — Systems ───────────────────────────────────────────────────────
  {
    type: 'SELECT_SYSTEM',
    spec: `- SELECT_SYSTEM: Select or deselect a system by name
  payload: { "name": "exact system name", "selected": true|false }`,
    resolve: (p, state) => {
      const system = state.systemItems.find(s => norm(s.name) === norm(p.name))
      if (!system) return `No system named "${str(p.name)}" found.`
      if (system.selected === Boolean(p.selected)) return []
      return [{ type: 'TOGGLE_SYSTEM_ITEM', itemId: system.id }]
    },
  },

  // ── Step 3 — Topics ────────────────────────────────────────────────────────
  {
    type: 'SELECT_TOPIC',
    spec: `- SELECT_TOPIC: Select or deselect a topic by title
  payload: { "title": "exact topic title", "selected": true|false }`,
    resolve: (p, state) => {
      const topic = state.topics.find(t => norm(t.title) === norm(p.title))
      if (!topic) return `No topic titled "${str(p.title)}" found.`
      if (topic.selected === Boolean(p.selected)) return []
      return [{ type: 'TOGGLE_TOPIC', topicId: topic.id }]
    },
  },

  // ── Step 4 — Papers ────────────────────────────────────────────────────────
  {
    type: 'ADD_PAPER_TO_REVIEW',
    spec: `- ADD_PAPER_TO_REVIEW: Add a paper to the review list
  payload: { "title": "exact paper title", "status": "included"|"maybe" }`,
    resolve: (p, state) => {
      const paper = state.results.find(r => norm(r.title) === norm(p.title))
        ?? state.reviewList.find(r => norm(r.title) === norm(p.title))
      if (!paper) return `No paper titled "${str(p.title)}" found in search results.`
      const status = (p.status as 'included' | 'maybe') ?? 'maybe'
      return [{ type: 'ADD_TO_REVIEW', paperId: paper.id, status }]
    },
  },
  {
    type: 'REMOVE_PAPER_FROM_REVIEW',
    spec: `- REMOVE_PAPER_FROM_REVIEW: Remove a paper from the review list
  payload: { "title": "exact paper title" }`,
    resolve: (p, state) => {
      const paper = state.reviewList.find(r => norm(r.title) === norm(p.title))
      if (!paper) return `"${str(p.title)}" is not in the review list.`
      return [{ type: 'REMOVE_FROM_REVIEW', paperId: paper.id }]
    },
  },
  {
    type: 'UPDATE_PAPER_STATUS',
    spec: `- UPDATE_PAPER_STATUS: Change a paper's review status
  payload: { "title": "exact paper title", "status": "included"|"maybe"|"saved" }`,
    resolve: (p, state) => {
      const paper = state.reviewList.find(r => norm(r.title) === norm(p.title))
      if (!paper) return `"${str(p.title)}" is not in the review list.`
      const status = p.status as 'included' | 'maybe' | 'saved'
      if (!status) return 'No status provided.'
      return [{ type: 'UPDATE_REVIEW_STATUS', paperId: paper.id, status }]
    },
  },

  // ── Step 5 — Matrix (literature) ───────────────────────────────────────────
  {
    type: 'SET_LIT_MATRIX_COLUMNS',
    spec: `- SET_LIT_MATRIX_COLUMNS: Replace ALL literature matrix columns
  payload: { "columns": ["col1", "col2", ...] }`,
    resolve: (p) => {
      const columns = p.columns as string[]
      if (!Array.isArray(columns) || columns.length === 0) return 'No columns provided.'
      return [{ type: 'SET_MATRIX_COLUMNS', columns }]
    },
  },
  {
    type: 'ADD_LIT_MATRIX_COLUMN',
    spec: `- ADD_LIT_MATRIX_COLUMN: Add one column to the literature matrix
  payload: { "column": "New Column Name" }`,
    resolve: (p, state) => {
      const column = str(p.column).trim()
      if (!column) return 'No column name provided.'
      if (state.matrixColumns.includes(column)) return `Column "${column}" already exists.`
      return [{ type: 'ADD_MATRIX_COLUMN', column }]
    },
  },
  {
    type: 'RENAME_LIT_MATRIX_COLUMN',
    spec: `- RENAME_LIT_MATRIX_COLUMN: Rename a literature matrix column
  payload: { "old_name": "existing column", "new_name": "new column name" }`,
    resolve: (p, state) => {
      const oldName = state.matrixColumns.find(c => norm(c) === norm(p.old_name))
      const newName = str(p.new_name).trim()
      if (!oldName) return `No column named "${str(p.old_name)}" found.`
      if (!newName) return 'No new column name provided.'
      return [{ type: 'RENAME_MATRIX_COLUMN', oldName, newName }]
    },
  },
  {
    type: 'REMOVE_LIT_MATRIX_COLUMN',
    spec: `- REMOVE_LIT_MATRIX_COLUMN: Remove a column from the literature matrix
  payload: { "column": "existing column name" }`,
    resolve: (p, state) => {
      const column = state.matrixColumns.find(c => norm(c) === norm(p.column))
      if (!column) return `No column named "${str(p.column)}" found.`
      return [{ type: 'REMOVE_MATRIX_COLUMN', column }]
    },
  },

  // ── Step 5 — Matrix (systems) ──────────────────────────────────────────────
  {
    type: 'SET_SYS_MATRIX_COLUMNS',
    spec: `- SET_SYS_MATRIX_COLUMNS: Replace ALL system matrix columns
  payload: { "columns": ["col1", "col2", ...] }`,
    resolve: (p) => {
      const columns = p.columns as string[]
      if (!Array.isArray(columns) || columns.length === 0) return 'No columns provided.'
      return [{ type: 'SET_SYSTEM_MATRIX_COLUMNS', columns }]
    },
  },
  {
    type: 'ADD_SYS_MATRIX_COLUMN',
    spec: `- ADD_SYS_MATRIX_COLUMN: Add one column to the system matrix
  payload: { "column": "New Column Name" }`,
    resolve: (p, state) => {
      const column = str(p.column).trim()
      if (!column) return 'No column name provided.'
      if (state.systemMatrixColumns.includes(column)) return `Column "${column}" already exists.`
      return [{ type: 'ADD_SYSTEM_MATRIX_COLUMN', column }]
    },
  },
  {
    type: 'RENAME_SYS_MATRIX_COLUMN',
    spec: `- RENAME_SYS_MATRIX_COLUMN: Rename a system matrix column
  payload: { "old_name": "existing column", "new_name": "new column name" }`,
    resolve: (p, state) => {
      const oldName = state.systemMatrixColumns.find(c => norm(c) === norm(p.old_name))
      const newName = str(p.new_name).trim()
      if (!oldName) return `No column named "${str(p.old_name)}" found.`
      if (!newName) return 'No new column name provided.'
      return [{ type: 'RENAME_SYSTEM_MATRIX_COLUMN', oldName, newName }]
    },
  },
  {
    type: 'REMOVE_SYS_MATRIX_COLUMN',
    spec: `- REMOVE_SYS_MATRIX_COLUMN: Remove a column from the system matrix
  payload: { "column": "existing column name" }`,
    resolve: (p, state) => {
      const column = state.systemMatrixColumns.find(c => norm(c) === norm(p.column))
      if (!column) return `No column named "${str(p.column)}" found.`
      return [{ type: 'REMOVE_SYSTEM_MATRIX_COLUMN', column }]
    },
  },

  // ── Step 6 — Synthesis ─────────────────────────────────────────────────────
  {
    type: 'UPDATE_SYNTHESIS_BLOCK',
    spec: `- UPDATE_SYNTHESIS_BLOCK: Rewrite a synthesis block's content
  payload: { "theme_name": "exact theme name", "block_title": "exact block title", "content": "new full content" }`,
    resolve: (p, state) => {
      const content = str(p.content)
      if (!content) return 'No content provided.'
      const theme = state.themes.find(t => norm(t.name) === norm(p.theme_name))
      if (!theme) return `No theme named "${str(p.theme_name)}" found.`
      const block = theme.blocks.find(b => norm(b.title) === norm(p.block_title))
      if (!block) return `No block titled "${str(p.block_title)}" in theme "${theme.name}".`
      return [{ type: 'UPDATE_SYNTHESIS_BLOCK', themeId: theme.id, blockId: block.id, content }]
    },
  },

  // ── Step 7 — Gaps & RQ ─────────────────────────────────────────────────────
  {
    type: 'UPDATE_GAP_STATEMENT',
    spec: `- UPDATE_GAP_STATEMENT: Rewrite the gap statement
  payload: { "text": "new gap statement text" }`,
    resolve: (p) => {
      const text = str(p.text)
      if (!text) return 'No gap statement text provided.'
      return [{ type: 'UPDATE_GAP_STATEMENT', text }]
    },
  },
  {
    type: 'SELECT_GAP',
    spec: `- SELECT_GAP: Select or deselect a gap dimension
  payload: { "label": "exact gap label", "selected": true|false }`,
    resolve: (p, state) => {
      const gap = state.gaps.find(g => norm(g.label) === norm(p.label))
      if (!gap) return `No gap labelled "${str(p.label)}" found.`
      if (gap.selected === Boolean(p.selected)) return []
      return [{ type: 'TOGGLE_GAP_SELECTED', gapId: gap.id }]
    },
  },
  {
    type: 'SELECT_RQ',
    spec: `- SELECT_RQ: Set the active research question by its text
  payload: { "text": "exact RQ text" }`,
    resolve: (p, state) => {
      const rq = state.rqOptions.find(r => norm(r.text) === norm(p.text))
      if (!rq) return `No research question matching "${str(p.text)}" found.`
      return [{ type: 'SELECT_RQ', rqId: rq.id }]
    },
  },

  // ── Step 8 — Final ─────────────────────────────────────────────────────────
  {
    type: 'SELECT_FINAL_TOPIC',
    spec: `- SELECT_FINAL_TOPIC: Choose a final research topic
  payload: { "title": "exact topic title" }`,
    resolve: (p, state) => {
      const topic = state.finalTopicOptions.find(t => norm(t.title) === norm(p.title))
      if (!topic) return `No final topic titled "${str(p.title)}" found.`
      return [{ type: 'SELECT_FINAL_TOPIC', topicId: topic.id }]
    },
  },
  {
    type: 'SELECT_STUDY_DESIGN',
    spec: `- SELECT_STUDY_DESIGN: Choose a study design
  payload: { "name": "exact design name" }`,
    resolve: (p, state) => {
      const design = state.studyDesignOptions.find(d => norm(d.name) === norm(p.name))
      if (!design) return `No study design named "${str(p.name)}" found.`
      return [{ type: 'SELECT_STUDY_DESIGN', designId: design.id }]
    },
  },
]

const REGISTRY_BY_TYPE: Record<string, ActionDef> = Object.fromEntries(
  REGISTRY.map(def => [def.type, def]),
)

// ── Public API ────────────────────────────────────────────────────────────────

export interface ResolvedAction {
  actions: AppAction[]
  error?: string
}

/** Resolve an AI-proposed action into dispatchable AppActions, or an error. */
export function resolveAction(action: ProposedAction, state: AppState): ResolvedAction {
  const def = REGISTRY_BY_TYPE[action.type]
  if (!def) return { actions: [], error: `Unsupported action "${action.type}".` }
  const out = def.resolve(action.payload ?? {}, state)
  return typeof out === 'string' ? { actions: [], error: out } : { actions: out }
}

/** Build the "## AVAILABLE ACTIONS" block sent to the assistant backend. */
export function buildActionsSpec(): string {
  const body = REGISTRY.map(def => def.spec).join('\n\n')
  return `## AVAILABLE ACTIONS
You may include any of the following in the "actions" array when the user asks you to make a change.
Confirm what you will do in your reply, then include the matching action.
Use exact names/titles as they appear in RESEARCH MEMORY.

${body}`
}
