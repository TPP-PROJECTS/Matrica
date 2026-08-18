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

// ── Payload type checking ─────────────────────────────────────────────────────
//
// The catalog records each field's TypeScript type as source text. That is
// enough to check the shapes a language model actually gets wrong: a number
// arrived as a string, an array arrived as a single value, a literal union
// answered with a word that is not one of the options.
//
// This matters because a validated action is dispatched *verbatim* into the
// reducer. Without it, `{ type: 'SET_TOPICS', topics: "diabetes" }` reaches the
// store and the next `state.topics.map(...)` takes the whole app down — a
// malformed model response should be a message in the chat, not a white screen.
//
// Checking is deliberately permissive: a type this cannot interpret is allowed
// through, so adding a new action never silently breaks the assistant.

/** Parse `'a' | 'b' | null` into its members, or null if it is not that shape. */
function literalUnionMembers(tsType: string): (string | null)[] | null {
  const parts = tsType.split('|').map(p => p.trim())
  if (parts.length < 2) return null
  const members: (string | null)[] = []
  for (const part of parts) {
    if (part === 'null' || part === 'undefined') { members.push(null); continue }
    const quoted = /^'(.*)'$/.exec(part) ?? /^"(.*)"$/.exec(part)
    if (!quoted) return null
    members.push(quoted[1])
  }
  return members
}

/** Human-readable reason `value` does not fit `tsType`, or null if it does. */
function typeError(fieldName: string, tsType: string, value: unknown): string | null {
  const t = tsType.trim()

  const members = literalUnionMembers(t)
  if (members) {
    const ok = value === null ? members.includes(null) : members.includes(value as string)
    return ok
      ? null
      : `"${fieldName}" must be one of ${members.map(m => m === null ? 'null' : `"${m}"`).join(', ')}, got ${JSON.stringify(value)}.`
  }

  switch (t) {
    case 'string':
      return typeof value === 'string' ? null : `"${fieldName}" must be a string, got ${typeof value}.`
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : `"${fieldName}" must be a number, got ${JSON.stringify(value)}.`
    case 'boolean':
      return typeof value === 'boolean' ? null : `"${fieldName}" must be true or false, got ${typeof value}.`
    case 'string[]':
      return Array.isArray(value) && value.every(v => typeof v === 'string')
        ? null
        : `"${fieldName}" must be an array of strings.`
    case 'number[]':
      return Array.isArray(value) && value.every(v => typeof v === 'number')
        ? null
        : `"${fieldName}" must be an array of numbers.`
    default:
      break
  }

  // Named array types (TopicCard[], SystemItem[] …): check the container only.
  if (t.endsWith('[]')) {
    return Array.isArray(value) ? null : `"${fieldName}" must be an array.`
  }

  // Anything else — a named interface, an indexed access type, a mapped type.
  // Not interpretable here, so only reject values that could not be any of them.
  return null
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

    const badType = typeError(field.name, field.tsType, value)
    if (badType) {
      return { actions: [], error: `${entry.type}: ${badType}` }
    }

    if (isIdField(field.name, field.tsType) && !ids.has(String(value))) {
      return {
        actions: [],
        error: `${entry.type} refers to ${field.name} "${String(value)}", which no longer exists.`,
      }
    }
  }

  // Keys the catalog does not know about are dropped rather than passed on, so
  // a hallucinated extra field cannot end up spread into the store.
  const known = new Set(entry.fields.map(f => f.name))
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (known.has(key)) clean[key] = value
  }

  // Validated: the payload matches the reducer's own action shape, so it can be
  // dispatched verbatim.
  return { actions: [{ type: entry.type, ...clean } as unknown as AppAction] }
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
