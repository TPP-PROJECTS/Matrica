import { API, apiFetch } from './api'
import type { AppAction, ResearchProfile, ResultCard, ConfidenceLevel } from '../types'

function levelFor(score: number): ConfidenceLevel {
  if (score >= 75) return 'high'
  if (score >= 45) return 'medium'
  if (score >= 15) return 'low'
  return 'none'
}

/**
 * Assess one paper's relevance in the background and fold the result into the
 * store. Every paper entering the result set goes through here, whichever
 * pathway brought it in, so none is left showing an assessment that never
 * arrives. A failure is recorded as such rather than swallowed — a card stuck
 * at 0% is indistinguishable from a genuinely irrelevant paper otherwise.
 */
export async function scorePaperRelevance(
  paper: Pick<ResultCard, 'id' | 'title' | 'abstract' | 'authors' | 'year' | 'source'>,
  profile: ResearchProfile,
  dispatch: React.Dispatch<AppAction>,
): Promise<void> {
  try {
    const res = await apiFetch(`${API}/recognise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'paper_relevance',
        paper: {
          title: paper.title,
          abstract: paper.abstract,
          authors: paper.authors,
          year: paper.year,
          url: paper.source,
        },
        profile,
      }),
    })
    if (!res.ok) throw new Error(`recognise failed: ${res.status}`)
    const data = await res.json()
    if (!paper.abstract.trim() && data.resolvedAbstract?.trim()) {
      dispatch({
        type: 'UPDATE_PAPER_ABSTRACT',
        paperId: paper.id,
        abstract: data.resolvedAbstract.trim(),
      })
    }
    dispatch({
      type: 'UPDATE_RESULT_RELEVANCE',
      paperId: paper.id,
      score: data.score,
      confidence: levelFor(data.score),
    })
  } catch {
    dispatch({ type: 'SET_RESULT_SCORE_STATUS', paperId: paper.id, status: 'failed' })
  }
}
