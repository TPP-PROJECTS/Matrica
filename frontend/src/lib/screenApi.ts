import { API, apiFetch } from './api'
import type { AppAction, ResearchProfile, ResultCard, ScreeningCriterion } from '../types'

export interface ScreenDecision {
  decision: 'include' | 'exclude' | 'uncertain'
  criterionId: string | null
  reason: string
  resolvedAbstract?: string | null
}

/**
 * Screen one paper against the protocol via the LLM, then apply the decision to
 * the store. Provenance is stamped as `by: 'ai'` on whatever it writes, so an
 * AI call is always distinguishable from a human's and can be undone wholesale.
 * A failed request is recorded on the paper rather than swallowed — a screening
 * pass that silently skipped papers would leave gaps that look like "not yet
 * screened", inflating the apparent work still to do.
 */
export async function screenPaper(
  paper: ResultCard,
  criteria: ScreeningCriterion[],
  profile: ResearchProfile,
  dispatch: React.Dispatch<AppAction>,
  customPrompt: string | null = null,
): Promise<ScreenDecision['decision'] | 'failed'> {
  const inclusion = criteria.filter(c => c.kind === 'inclusion').map(c => ({ id: c.id, label: c.label }))
  const exclusion = criteria.filter(c => c.kind === 'exclusion').map(c => ({ id: c.id, label: c.label }))

  try {
    const res = await apiFetch(`${API}/screening/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paper: {
          title: paper.title,
          abstract: paper.abstract,
          authors: paper.authors,
          year: paper.year,
          url: paper.source,
        },
        inclusion,
        exclusion,
        profile,
        custom_system_prompt: customPrompt,
      }),
    })
    if (!res.ok) throw new Error(`classify failed: ${res.status}`)
    const d = await res.json() as ScreenDecision
    if (!paper.abstract.trim() && d.resolvedAbstract?.trim()) {
      dispatch({
        type: 'UPDATE_PAPER_ABSTRACT',
        paperId: paper.id,
        abstract: d.resolvedAbstract.trim(),
      })
    }

    if (d.decision === 'include') {
      dispatch({ type: 'ADD_TO_REVIEW', paperId: paper.id, status: 'included', reason: d.reason, by: 'ai' })
    } else if (d.decision === 'exclude') {
      dispatch({ type: 'EXCLUDE_PAPER', paperId: paper.id, reasonId: d.criterionId, reason: d.reason, by: 'ai' })
    } else {
      dispatch({ type: 'MARK_SCREEN_UNCERTAIN', paperId: paper.id, reason: d.reason, by: 'ai' })
    }
    return d.decision
  } catch {
    dispatch({ type: 'SET_SCREEN_STATUS', paperId: paper.id, status: 'failed' })
    return 'failed'
  }
}
