import { API, apiFetch } from './api'
import type { SessionSnapshot } from '../types'

export type ReviewScope = 'process' | 'screening' | 'extraction' | 'output'

export const SCOPE_LABELS: Record<ReviewScope, { title: string; blurb: string }> = {
  process: {
    title: 'Complete research-process review',
    blurb: 'Read every step result, operation, justification and AI-evidence interaction, then leave comments.',
  },
  screening: {
    title: 'Screening decisions',
    blurb: 'Judge each record for inclusion without seeing the first reviewer’s verdicts.',
  },
  extraction: {
    title: 'Data extraction',
    blurb: 'Fill the matrix independently; values are compared afterwards.',
  },
  output: {
    title: 'Write-up sign-off',
    blurb: 'Appraise the gap statement and research questions.',
  },
}

export interface ReviewDecision {
  scope: ReviewScope
  itemKey: string
  value: string | null
  note: string | null
}

export interface ReviewWorkspace {
  reviewId: string
  reviewerName: string | null
  scopes: ReviewScope[]
  submittedAt: number | null
  /** Process reviews receive the full project; legacy independent passes are redacted. */
  snapshot: SessionSnapshot
  decisions: ReviewDecision[]
}

export interface ReviewMeta {
  id: string
  reviewerName: string | null
  scopes: ReviewScope[]
  createdAt: number
  openedAt: number | null
  submittedAt: number | null
  revoked: boolean
  decisionCount: number
}

export interface ScreeningComparison {
  n: number
  observedAgreement: number
  expectedAgreement: number
  kappa: number
  interpretation: string
  conflicts: { paperId: string; title: string; owner: string; reviewer: string }[]
}

export interface ExtractionComparison {
  overallAgreementPct: number
  cellsCompared: number
  byColumn: {
    column: string
    n: number
    matched: number
    agreementPct: number
    discrepancies: { paperId: string; title: string; owner: string; reviewer: string }[]
  }[]
}

export interface Comparison {
  reviewId: string
  scopes: ReviewScope[]
  screening?: ScreeningComparison
  extraction?: ExtractionComparison
  output?: { verdicts: { itemKey: string; verdict: string; comment: string | null }[] }
  processComments?: { entryId: string; action: string; entityLabel: string; comment: string }[]
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

const POST = { method: 'POST', headers: { 'Content-Type': 'application/json' } } as const

// ── Owner side ────────────────────────────────────────────────────────────────

export async function createReview(
  projectId: string, scopes: ReviewScope[], reviewerName: string | null,
): Promise<{ id: string; token: string; url: string }> {
  return json(await apiFetch(`${API}/reviews`, {
    ...POST, body: JSON.stringify({ projectId, scopes, reviewerName }),
  }))
}

export async function listReviews(projectId: string): Promise<ReviewMeta[]> {
  return json(await apiFetch(`${API}/reviews/project/${projectId}`))
}

export async function revokeReview(reviewId: string): Promise<void> {
  await json(await apiFetch(`${API}/reviews/${reviewId}/revoke`, POST))
}

export async function getComparison(reviewId: string): Promise<Comparison> {
  return json(await apiFetch(`${API}/reviews/${reviewId}/comparison`))
}

// ── Reviewer side ─────────────────────────────────────────────────────────────

export async function getWorkspace(token: string): Promise<ReviewWorkspace> {
  return json(await apiFetch(`${API}/reviews/by-token/${token}`))
}

export async function saveDecisions(
  token: string, scope: ReviewScope,
  decisions: { itemKey: string; value?: string | null; note?: string | null }[],
): Promise<void> {
  await json(await apiFetch(`${API}/reviews/by-token/${token}/decisions`, {
    ...POST, body: JSON.stringify({ scope, decisions }),
  }))
}

export async function submitReview(token: string): Promise<void> {
  await json(await apiFetch(`${API}/reviews/by-token/${token}/submit`, POST))
}
