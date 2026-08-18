/**
 * Collision-free client-side ids.
 *
 * These ids are React keys and entity references, and several of them used to
 * be `${prefix}-${Date.now()}`. Anything that creates two entities inside the
 * same millisecond — a paste handler adding several criteria, an assistant
 * applying a batch of actions, a fast double click — produced duplicates, which
 * React renders as a warning and a corrupted list, and which the action
 * registry's id index cannot tell apart.
 *
 * The timestamp prefix is kept because it makes ids sort chronologically and
 * makes them readable in a saved session file; the random suffix is what makes
 * them unique.
 */

/** `crypto.randomUUID` needs a secure context; fall back where it is absent. */
function randomSuffix(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8)
  }
  return Math.random().toString(36).slice(2, 10)
}

/** A unique id of the form `<prefix>-<timestamp>-<random>`. */
export function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomSuffix()}`
}
