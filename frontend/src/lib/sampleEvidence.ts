/**
 * The evidence a drafted subsection is allowed to draw on.
 *
 * Sample prose is only worth having if it cites the author's own review rather
 * than the model's recollection of the field. So the reviewed papers are sent
 * as a closed list — the backend tells the model it may cite nothing else — and
 * each carries its extracted matrix values so the prose can state what a paper
 * actually found instead of gesturing at it.
 *
 * The risk-of-bias rating travels too, so a finding resting on studies at
 * serious risk is hedged in the draft rather than asserted flatly.
 */
import type { AppState } from '../types'

export interface SamplePaperPayload {
  title: string
  authors: string
  year: number | null
  cells: Record<string, string>
  robOverall: string
}

/** Papers the draft may cite, with what the review extracted from each. */
export function buildSamplePapers(state: AppState): SamplePaperPayload[] {
  const robByPaper = new Map((state.robAssessments ?? []).map(a => [a.paperId, a]))

  return state.matrixRows.map(row => {
    const cells: Record<string, string> = {}
    for (const [column, cell] of Object.entries(row.cells)) {
      if (cell?.value && cell.value !== '—') cells[column] = cell.value
    }
    return {
      title: row.title,
      authors: row.authors,
      year: row.year || null,
      cells,
      robOverall: robByPaper.get(row.paperId)?.overall ?? '',
    }
  })
}

/** Themes, gaps and profile — the shared context every step of step 9 sends. */
export function buildSampleContext(state: AppState) {
  return {
    gap_statement: state.gapStatement,
    profile: state.profile,
    themes: state.themes.map(t => ({
      name: t.name,
      coverageLabel: t.coverageLabel,
      blocks: t.blocks.map(b => ({ blockType: b.blockType, content: b.content })),
    })),
    gaps: state.gaps.filter(g => g.selected).map(g => ({
      label: g.label, description: g.description, type: g.type,
    })),
    papers: buildSamplePapers(state),
  }
}
