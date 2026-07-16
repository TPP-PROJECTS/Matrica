/**
 * actionRegistry.ts
 *
 * Chatbot action plumbing — fully derived, no per-action code.
 *
 * The catalog is generated from the `// @chatbot` tags on the AppAction union
 * (see scripts/genActionCatalog.ts). The assistant emits reducer actions
 * directly, referencing entities by the ids we put in its research context, so
 * there is no name→id translation layer to hand-write. This module only:
 *
 *   1. buildActionsSpec()  — renders the catalog into the assistant's prompt
 *   2. resolveAction()     — validates an AI-proposed action, then hands it to
 *                            dispatch verbatim
 *
 * To make a new feature chatbot-operable: add the reducer case, tag its
 * AppAction with `// @chatbot <description>`, run `npm run gen:actions`. Done.
 */

import type { ProposedAction, AppAction, AppState } from '../types'
import { ACTION_CATALOG, type CatalogEntry } from './generatedActionCatalog'

const CATALOG_BY_TYPE: Record<string, CatalogEntry> = Object.fromEntries(
  ACTION_CATALOG.map(e => [e.type, e]),
)

// ── Entity id index ───────────────────────────────────────────────────────────
// Every id the assistant is allowed to reference. Used to reject hallucinated or
// stale ids before they reach the reducer (where they would silently no-op).

function collectIds(state: AppState): Set<string> {
  const ids = new Set<string>()
  const add = (v: string | null | undefined) => { if (v) ids.add(v) }

  state.topics.forEach(t => add(t.id))
  state.systemItems.forEach(s => add(s.id))
  state.results.forEach(r => add(r.id))
  state.reviewList.forEach(r => add(r.id))
  state.gaps.forEach(g => add(g.id))
  state.rqOptions.forEach(r => add(r.id))
  state.finalTopicOptions.forEach(t => add(t.id))
  state.studyDesignOptions.forEach(d => add(d.id))
  state.themes.forEach(th => {
    add(th.id)
    th.blocks.forEach(b => add(b.id))
  })
  state.matrixRows.forEach(r => add(r.paperId))
  state.systemMatrixRows.forEach(r => add(r.systemId))

  return ids
}

/** Fields named `*Id` hold entity references and are checked against the index. */
function isIdField(name: string, tsType: string): boolean {
  return /Id$/.test(name) && tsType.replace(/\s/g, '') === 'string'
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ResolvedAction {
  actions: AppAction[]
  error?: string
}

/** Validate an AI-proposed action and turn it into a dispatchable AppAction. */
export function resolveAction(action: ProposedAction, state: AppState): ResolvedAction {
  const entry = CATALOG_BY_TYPE[action.type]
  if (!entry) {
    return { actions: [], error: `Unsupported action "${action.type}".` }
  }

  const payload = action.payload ?? {}
  const ids = collectIds(state)

  for (const field of entry.fields) {
    const value = payload[field.name]

    if (value === undefined || value === null) {
      if (field.optional) continue
      return { actions: [], error: `Missing "${field.name}" for ${entry.type}.` }
    }

    if (isIdField(field.name, field.tsType) && !ids.has(String(value))) {
      return {
        actions: [],
        error: `${entry.type} refers to ${field.name} "${String(value)}", which no longer exists.`,
      }
    }
  }

  // Validated: the payload matches the reducer's own action shape, so it can be
  // dispatched verbatim.
  return { actions: [{ type: entry.type, ...payload } as unknown as AppAction] }
}

/** Build the "## AVAILABLE ACTIONS" block sent to the assistant backend. */
export function buildActionsSpec(): string {
  const body = ACTION_CATALOG.map(e => {
    const shape = e.fields.length === 0
      ? '{}'
      : `{ ${e.fields.map(f => `"${f.name}": ${f.tsType}${f.optional ? ' (optional)' : ''}`).join(', ')} }`
    return `- ${e.type}: ${e.doc}\n  payload: ${shape}`
  }).join('\n')

  return `## AVAILABLE ACTIONS
Include any of these in the "actions" array when the user asks for a change.
Confirm what you will do in your reply, then include the matching action.

Reference entities by the ids shown in RESEARCH MEMORY (e.g. [t3]); never invent
an id. Toggle actions flip current state — only send them when a change is needed.

${body}`
}
