/**
 * Where the report's research questions actually come from.
 *
 * There are two RQ representations in the app's history. The older one is the
 * flat `rqOptions` / `selectedRQId` pair; nothing populates it any more — the
 * final-question step (step 9) attaches questions to the chosen topic instead,
 * as `topicFinalData[].researchQuestions`. Until this selector existed the
 * exports still read the flat pair, so every report shipped with an empty
 * "Research Questions" section and the export checklist never lit up.
 *
 * Reading through here fixes new sessions without discarding old ones: sessions
 * saved back when `rqOptions` was written still export exactly as before.
 */
import type { AppState, RQFormat } from '../types'

export interface ReportRQ {
  format: RQFormat
  label: string
  text: string
  /** The question the user settled on, shown as the headline in the report. */
  selected: boolean
}

/** The research questions to report, newest source first, legacy as fallback. */
export function reportResearchQuestions(state: AppState): ReportRQ[] {
  const active = state.topicFinalData?.find(d => d.topicId === state.selectedFinalTopicId)
  const fromTopic = active?.researchQuestions
    ?? state.finalTopicOptions?.find(t => t.id === state.selectedFinalTopicId)?.researchQuestions

  if (fromTopic && fromTopic.length > 0) {
    // The step-9 shape marks its preferred question with `recommended`; if the
    // generator marked several, only the first is treated as the choice so the
    // report never shows two headline questions.
    const firstRecommended = fromTopic.findIndex(rq => rq.recommended)
    const chosen = firstRecommended === -1 ? 0 : firstRecommended
    return fromTopic.map((rq, i) => ({
      format: rq.format,
      label: rq.label,
      text: rq.text,
      selected: i === chosen,
    }))
  }

  // Legacy sessions.
  return (state.rqOptions ?? []).map(rq => ({
    format: rq.format,
    label: rq.label,
    text: rq.text,
    selected: rq.id === state.selectedRQId,
  }))
}

/** The single question the report leads with, if there is one. */
export function primaryResearchQuestion(state: AppState): ReportRQ | null {
  const all = reportResearchQuestions(state)
  return all.find(rq => rq.selected) ?? all[0] ?? null
}
