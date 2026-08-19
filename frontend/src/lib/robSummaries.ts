/**
 * The appraisal, packaged for the steps that consume it.
 *
 * Both the synthesis step and the gap step need to weigh study quality, and
 * they must weigh it identically — a synthesis that treats a study as solid
 * while the gap analysis calls it methodologically weak is worse than either
 * step having no appraisal at all.
 *
 * Raw domain judgements are sent rather than a digested verdict: which
 * judgements count as a concern is a property of the instrument, and the
 * instrument is defined on the backend, so that is where the interpretation
 * belongs.
 */
import type { AppState } from '../types'

export interface RobSummaryPayload {
  title: string
  tool: string
  overall: string
  /** False while any AI-drafted domain is still awaiting the reviewer. */
  confirmed: boolean
  domains: Record<string, string>
}

export function buildRobSummaries(state: AppState): RobSummaryPayload[] {
  return (state.robAssessments ?? []).map(assessment => {
    const paper = state.reviewList.find(p => p.id === assessment.paperId)
    const domains = Object.entries(assessment.domains)
    return {
      title: paper?.title ?? assessment.paperId,
      tool: assessment.toolId,
      overall: assessment.overall,
      // An appraisal counts as the reviewer's only when every AI-drafted
      // domain in it has been confirmed; one unreviewed domain is enough to
      // make the whole judgement provisional.
      confirmed: domains.length > 0 && domains.every(([, d]) => !d.aiGenerated || d.verifiedByStudent),
      domains: Object.fromEntries(domains.map(([id, d]) => [id, d.judgement])),
    }
  })
}
