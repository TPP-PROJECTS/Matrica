/**
 * The workflow's steps, in one place.
 *
 * Step numbers are used by the left nav, the back-navigation modal, the
 * decision journal and the analytics funnel, so they were duplicated in half a
 * dozen files and drifted apart whenever the workflow changed. They live here
 * instead, and renumbering the workflow is a change to this file plus the
 * router in App.tsx.
 */

export interface StepDef {
  id: number
  label: string
}

export const STEPS: StepDef[] = [
  { id: 1, label: 'Chat & Define Topic' },
  { id: 2, label: 'Matrix Initial' },
  { id: 3, label: 'Explore & Search' },
  { id: 4, label: 'Select Paper' },
  { id: 5, label: 'Matrix Table' },
  { id: 6, label: 'Synthesis & Gap' },
  { id: 7, label: 'Final Question' },
]

export const FIRST_STEP = STEPS[0].id
export const LAST_STEP = STEPS[STEPS.length - 1].id

export const STEP_NAMES: Record<number, string> = Object.fromEntries(
  STEPS.map(s => [s.id, s.label]),
)

export function stepName(id: number): string {
  return STEP_NAMES[id] ?? `Step ${id}`
}

/**
 * Current numbering of the step layout. Bumped whenever steps are merged or
 * renumbered, so a session saved under the old layout can be mapped forward
 * instead of reopening on the wrong screen.
 */
export const STEP_SCHEMA = 2

/**
 * Map a step number from the 9-step layout onto the 7-step one.
 *
 * The old layout ran: 1 chat · 2 matrix init · 3 system review ·
 * 4 explore & search · 5 select paper · 6 matrix table · 7 synthesis ·
 * 8 gap & statement · 9 final question. System review is now a tab inside
 * explore & search, and synthesis and gap are one step, so two pairs collapse.
 */
const LEGACY_STEP_MAP: Record<number, number> = {
  1: 1, 2: 2, 3: 3, 4: 3, 5: 4, 6: 5, 7: 6, 8: 6, 9: 7,
}

export function migrateStep(step: number, schema: number | undefined): number {
  if (schema === STEP_SCHEMA) return clampStep(step)
  return clampStep(LEGACY_STEP_MAP[step] ?? step)
}

export function migrateSteps(steps: number[], schema: number | undefined): number[] {
  const mapped = steps.map(s => migrateStep(s, schema))
  return Array.from(new Set(mapped)).sort((a, b) => a - b)
}

export function clampStep(step: number): number {
  if (!Number.isFinite(step)) return FIRST_STEP
  return Math.min(Math.max(Math.round(step), FIRST_STEP), LAST_STEP)
}
