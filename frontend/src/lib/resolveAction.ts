/**
 * resolveAction.ts
 *
 * Converts an AI-returned ProposedAction (which uses names/titles/text)
 * into one or more AppActions (which use IDs) for dispatching.
 *
 * Returns an empty array if the action is unrecognised or can't be resolved.
 */

import type { ProposedAction, AppAction, AppState } from '../types'

export function resolveAction(action: ProposedAction, state: AppState): AppAction[] {
  const p = action.payload

  switch (action.type) {
    // ── Profile ────────────────────────────────────────────────────────────────
    case 'UPDATE_PROFILE': {
      const field = p.field as keyof AppState['profile']
      const value = String(p.value ?? '')
      const allowed: Array<keyof AppState['profile']> = ['domain', 'population', 'focus', 'method', 'reviewType']
      if (!allowed.includes(field)) return []
      return [{ type: 'UPDATE_PROFILE', field, value }]
    }

    case 'SET_SESSION_TITLE': {
      const title = String(p.title ?? '')
      if (!title) return []
      return [{ type: 'SET_SESSION_TITLE', title }]
    }

    // ── Navigation ─────────────────────────────────────────────────────────────
    case 'NAVIGATE_TO_STEP': {
      const step = Number(p.step)
      if (isNaN(step) || step < 1 || step > 9) return []
      if (step < state.currentStep) {
        return [{ type: 'BACK_NAV_REQUEST', step }]
      }
      return [{ type: 'SET_STEP', step }]
    }

    // ── Step 2: Systems ────────────────────────────────────────────────────────
    case 'SELECT_SYSTEM': {
      const name = String(p.name ?? '').toLowerCase().trim()
      const selected = Boolean(p.selected)
      const system = state.systemItems.find(s => s.name.toLowerCase().trim() === name)
      if (!system) return []
      if (system.selected === selected) return [] // already in desired state
      return [{ type: 'TOGGLE_SYSTEM_ITEM', itemId: system.id }]
    }

    // ── Step 3: Topics ─────────────────────────────────────────────────────────
    case 'SELECT_TOPIC': {
      const title = String(p.title ?? '').toLowerCase().trim()
      const selected = Boolean(p.selected)
      const topic = state.topics.find(t => t.title.toLowerCase().trim() === title)
      if (!topic) return []
      if (topic.selected === selected) return []
      return [{ type: 'TOGGLE_TOPIC', topicId: topic.id }]
    }

    // ── Step 4: Papers ─────────────────────────────────────────────────────────
    case 'ADD_PAPER_TO_REVIEW': {
      const title = String(p.title ?? '').toLowerCase().trim()
      const status = (p.status as 'included' | 'maybe') ?? 'maybe'
      // Look in results first, then reviewList (in case already there)
      const paper = state.results.find(r => r.title.toLowerCase().trim() === title)
        ?? state.reviewList.find(r => r.title.toLowerCase().trim() === title)
      if (!paper) return []
      return [{ type: 'ADD_TO_REVIEW', paperId: paper.id, status }]
    }

    case 'REMOVE_PAPER_FROM_REVIEW': {
      const title = String(p.title ?? '').toLowerCase().trim()
      const paper = state.reviewList.find(r => r.title.toLowerCase().trim() === title)
      if (!paper) return []
      return [{ type: 'REMOVE_FROM_REVIEW', paperId: paper.id }]
    }

    case 'UPDATE_PAPER_STATUS': {
      const title = String(p.title ?? '').toLowerCase().trim()
      const status = p.status as 'included' | 'maybe' | 'saved'
      const paper = state.reviewList.find(r => r.title.toLowerCase().trim() === title)
      if (!paper || !status) return []
      return [{ type: 'UPDATE_REVIEW_STATUS', paperId: paper.id, status }]
    }

    // ── Step 5: Matrix Columns ─────────────────────────────────────────────────
    case 'SET_LIT_MATRIX_COLUMNS': {
      const columns = p.columns as string[]
      if (!Array.isArray(columns) || columns.length === 0) return []
      return [{ type: 'SET_MATRIX_COLUMNS', columns }]
    }

    case 'SET_SYS_MATRIX_COLUMNS': {
      const columns = p.columns as string[]
      if (!Array.isArray(columns) || columns.length === 0) return []
      return [{ type: 'SET_SYSTEM_MATRIX_COLUMNS', columns }]
    }

    // ── Step 6: Synthesis ──────────────────────────────────────────────────────
    case 'UPDATE_SYNTHESIS_BLOCK': {
      const themeName = String(p.theme_name ?? '').toLowerCase().trim()
      const blockTitle = String(p.block_title ?? '').toLowerCase().trim()
      const content = String(p.content ?? '')
      if (!content) return []

      const theme = state.themes.find(t => t.name.toLowerCase().trim() === themeName)
      if (!theme) return []
      const block = theme.blocks.find(b => b.title.toLowerCase().trim() === blockTitle)
      if (!block) return []

      return [{ type: 'UPDATE_SYNTHESIS_BLOCK', themeId: theme.id, blockId: block.id, content }]
    }

    // ── Step 7: Gaps & RQ ──────────────────────────────────────────────────────
    case 'UPDATE_GAP_STATEMENT': {
      const text = String(p.text ?? '')
      if (!text) return []
      return [{ type: 'UPDATE_GAP_STATEMENT', text }]
    }

    case 'SELECT_GAP': {
      const label = String(p.label ?? '').toLowerCase().trim()
      const selected = Boolean(p.selected)
      const gap = state.gaps.find(g => g.label.toLowerCase().trim() === label)
      if (!gap) return []
      if (gap.selected === selected) return []
      return [{ type: 'TOGGLE_GAP_SELECTED', gapId: gap.id }]
    }

    case 'SELECT_RQ': {
      const text = String(p.text ?? '').toLowerCase().trim()
      const rq = state.rqOptions.find(r => r.text.toLowerCase().trim() === text)
      if (!rq) return []
      return [{ type: 'SELECT_RQ', rqId: rq.id }]
    }

    // ── Step 8: Final ──────────────────────────────────────────────────────────
    case 'SELECT_FINAL_TOPIC': {
      const title = String(p.title ?? '').toLowerCase().trim()
      const topic = state.finalTopicOptions.find(t => t.title.toLowerCase().trim() === title)
      if (!topic) return []
      return [{ type: 'SELECT_FINAL_TOPIC', topicId: topic.id }]
    }

    case 'SELECT_STUDY_DESIGN': {
      const name = String(p.name ?? '').toLowerCase().trim()
      const design = state.studyDesignOptions.find(d => d.name.toLowerCase().trim() === name)
      if (!design) return []
      return [{ type: 'SELECT_STUDY_DESIGN', designId: design.id }]
    }

    // ── Prompts (no AppAction — handled externally via custom prompt store) ──────
    case 'SET_CUSTOM_PROMPT':
      // Not managed by reducer; handled by ChatPanel saving to a customPrompts map
      return []

    default:
      return []
  }
}
