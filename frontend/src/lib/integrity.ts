import { API, apiFetch } from './api'
import type { AppAction, IntegrityCheck, IntegrityNotice, IntegrityStatus, ResultCard } from '../types'

// ── Publication-integrity checks ──────────────────────────────────────────────
// Included papers are looked up on Crossref for retractions, expressions of
// concern and corrections. It is a plain metadata lookup, not an AI call, so
// it runs quietly in the background and only speaks up when it finds something.

const DAY_MS = 24 * 60 * 60 * 1000
/** Retractions arrive years after publication, so a clear result goes stale. */
const RECHECK_CLEAR_AFTER_MS = 30 * DAY_MS
/** An unresolved lookup is often a transient failure; try again next day. */
const RECHECK_UNRESOLVED_AFTER_MS = DAY_MS
const BATCH_SIZE = 50

type Checkable = Pick<ResultCard, 'id' | 'title' | 'source'>

/** Papers with no check yet, or whose last check has gone stale. */
export function papersDueForCheck<P extends Checkable>(
  papers: P[],
  checks: Record<string, IntegrityCheck>,
  now: number,
): P[] {
  return papers.filter(p => {
    const c = checks[p.id]
    if (!c) return true
    const age = now - Date.parse(c.checkedAt)
    if (c.status === 'unresolved') return age > RECHECK_UNRESOLVED_AFTER_MS
    return age > RECHECK_CLEAR_AFTER_MS
  })
}

/**
 * Check `papers` and record the results. A request that fails outright records
 * nothing, so the papers stay due and are tried again later.
 */
export async function checkIntegrity(papers: Checkable[], dispatch: React.Dispatch<AppAction>): Promise<void> {
  for (let i = 0; i < papers.length; i += BATCH_SIZE) {
    const batch = papers.slice(i, i + BATCH_SIZE)
    const res = await apiFetch(`${API}/integrity/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ papers: batch.map(p => ({ id: p.id, title: p.title, url: p.source || null })) }),
    })
    if (!res.ok) throw new Error(`integrity check failed: ${res.status}`)
    const data = await res.json() as {
      results: { id: string; status: IntegrityStatus; doi?: string | null; notices?: IntegrityNotice[] }[]
    }
    const checkedAt = new Date().toISOString()
    const checks: Record<string, IntegrityCheck> = {}
    for (const r of data.results) {
      checks[r.id] = { status: r.status, doi: r.doi ?? null, notices: r.notices ?? [], checkedAt }
    }
    dispatch({ type: 'SET_INTEGRITY_CHECKS', checks })
  }
}

/** Statuses a reader must be told about, most serious first. */
export const FLAGGED_STATUSES: IntegrityStatus[] = ['retracted', 'concern', 'corrected']

export const INTEGRITY_LABEL: Record<IntegrityStatus, string> = {
  retracted: 'Retracted',
  concern: 'Expression of concern',
  corrected: 'Corrected',
  clear: 'No notices',
  unresolved: 'Not matched on Crossref',
}

/** The notice to link to: the one that explains the status shown. */
export function primaryNotice(check: IntegrityCheck): IntegrityNotice | undefined {
  const want = check.status === 'retracted'
    ? ['retraction', 'withdrawal', 'removal', 'partial_retraction']
    : check.status === 'concern' ? ['expression_of_concern'] : ['correction', 'erratum', 'corrigendum']
  return check.notices.find(n => want.includes(n.type) && n.doi) ?? check.notices.find(n => want.includes(n.type))
}
