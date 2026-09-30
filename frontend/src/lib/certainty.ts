import type {
  AppState, CertaintyAssessment, CertaintyFrameworkId, CertaintyLevel, Theme,
} from '../types'

// ── Certainty of evidence ─────────────────────────────────────────────────────
// How much confidence a review's finding deserves, rated with the established
// framework for its kind of evidence: GRADE for effects and associations,
// GRADE-CERQual for findings from qualitative research.
//
// The AI drafts a judgement per domain; the overall level is never the AI's.
// It follows from the domain judgements by the framework's own rule, so a
// reviewer who changes one domain sees the rating move, and the rating can
// always be traced back to reasons. A reviewer who disagrees with the rule's
// outcome can override it, with a stated reason.
//
// This module is the single definition of both frameworks: the backend is sent
// the domains and options with each request rather than keeping its own copy.

export interface DomainOption {
  id: string
  label: string
  /** Levels this judgement moves the rating: negative downgrades. */
  shift: number
}

export interface CertaintyDomain {
  id: string
  label: string
  /** The question the domain answers, as the framework puts it. */
  question: string
  options: DomainOption[]
  /** GRADE's upgrading domains apply only to a body that starts at low. */
  upgradeOnly?: boolean
}

export interface CertaintyFramework {
  id: CertaintyFrameworkId
  name: string
  short: string
  /** One line on when to use it, shown when choosing. */
  useFor: string
  domains: CertaintyDomain[]
  /** GRADE starts randomised evidence at high and observational at low. */
  startLevels?: { id: 'high' | 'low'; label: string }[]
  /** Extra guidance passed to the model with the domain definitions. */
  instructions: string
}

const DOWNGRADE: DomainOption[] = [
  { id: 'no_concern', label: 'Not serious', shift: 0 },
  { id: 'serious', label: 'Serious', shift: -1 },
  { id: 'very_serious', label: 'Very serious', shift: -2 },
]

const CERQUAL_CONCERN: DomainOption[] = [
  { id: 'no_or_very_minor', label: 'No or very minor concerns', shift: 0 },
  { id: 'minor', label: 'Minor concerns', shift: 0 },
  { id: 'moderate', label: 'Moderate concerns', shift: -1 },
  { id: 'serious', label: 'Serious concerns', shift: -2 },
]

export const FRAMEWORKS: Record<CertaintyFrameworkId, CertaintyFramework> = {
  grade: {
    id: 'grade',
    name: 'GRADE',
    short: 'GRADE',
    useFor: 'Effects, associations and other quantitative findings',
    startLevels: [
      { id: 'high', label: 'High — mostly randomised trials' },
      { id: 'low', label: 'Low — mostly observational studies' },
    ],
    domains: [
      { id: 'risk_of_bias', label: 'Risk of bias', question: 'Do limitations in the design or conduct of the studies lower confidence in the finding? Use the risk-of-bias appraisal where given.', options: DOWNGRADE },
      { id: 'inconsistency', label: 'Inconsistency', question: 'Do the studies’ results differ from one another in ways that are not explained?', options: DOWNGRADE },
      { id: 'indirectness', label: 'Indirectness', question: 'Do the studies’ populations, interventions, comparators or outcomes differ from those the review question asks about?', options: DOWNGRADE },
      { id: 'imprecision', label: 'Imprecision', question: 'Are the studies few or small, or the estimates wide enough that the conclusion could change?', options: DOWNGRADE },
      { id: 'publication_bias', label: 'Publication bias', question: 'Is there reason to suspect that studies with unfavourable results are missing?', options: [
        { id: 'undetected', label: 'Undetected', shift: 0 },
        { id: 'strongly_suspected', label: 'Strongly suspected', shift: -1 },
      ] },
      { id: 'large_effect', label: 'Large effect', question: 'Is the effect so large that bias is unlikely to explain it?', upgradeOnly: true, options: [
        { id: 'none', label: 'No', shift: 0 },
        { id: 'large', label: 'Large', shift: 1 },
        { id: 'very_large', label: 'Very large', shift: 2 },
      ] },
      { id: 'dose_response', label: 'Dose-response', question: 'Does the effect rise with the level of exposure?', upgradeOnly: true, options: [
        { id: 'none', label: 'No', shift: 0 },
        { id: 'present', label: 'Present', shift: 1 },
      ] },
      { id: 'plausible_confounding', label: 'Plausible confounding', question: 'Would the likely confounding have reduced the observed effect, so the true effect is at least as large?', upgradeOnly: true, options: [
        { id: 'none', label: 'No', shift: 0 },
        { id: 'would_reduce_effect', label: 'Would reduce the effect', shift: 1 },
      ] },
    ],
    instructions: 'Apply GRADE. Choose the starting level from the study designs: "high" when the body of evidence is mainly randomised trials, "low" when it is mainly observational. Judge the upgrading domains only when starting low; otherwise answer "none".',
  },
  cerqual: {
    id: 'cerqual',
    name: 'GRADE-CERQual',
    short: 'CERQual',
    useFor: 'Findings from qualitative research',
    domains: [
      { id: 'methodological_limitations', label: 'Methodological limitations', question: 'Are there concerns about the design or conduct of the studies contributing to the finding?', options: CERQUAL_CONCERN },
      { id: 'coherence', label: 'Coherence', question: 'Is the finding well grounded in the data from the contributing studies, and does it account for patterns that contradict it?', options: CERQUAL_CONCERN },
      { id: 'adequacy', label: 'Adequacy of data', question: 'Is there enough data — in richness and in quantity — behind the finding?', options: CERQUAL_CONCERN },
      { id: 'relevance', label: 'Relevance', question: 'Do the contexts of the contributing studies match the context the review question is about?', options: CERQUAL_CONCERN },
    ],
    instructions: 'Apply GRADE-CERQual. Each component is rated for concerns, from "no or very minor" to "serious".',
  },
}

export const LEVELS: CertaintyLevel[] = ['very_low', 'low', 'moderate', 'high']

export const LEVEL_LABEL: Record<CertaintyLevel, string> = {
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
  very_low: 'Very low',
}

/** GRADE's customary symbols: ⊕⊕⊕⊕ high down to ⊕◯◯◯ very low. */
export function levelSymbols(level: CertaintyLevel): string {
  const n = LEVELS.indexOf(level) + 1
  return '⊕'.repeat(n) + '◯'.repeat(4 - n)
}

/** Whether a domain applies, given the assessment's starting level. */
export function domainApplies(domain: CertaintyDomain, a: Pick<CertaintyAssessment, 'framework' | 'startLevel'>): boolean {
  return !domain.upgradeOnly || (a.framework === 'grade' && a.startLevel === 'low')
}

/**
 * The level the framework's rule gives. GRADE: start at high or low, move one
 * level per serious concern (two per very serious) and up for upgrading
 * factors. CERQual: start at high and move down for moderate or serious
 * concerns; several minor concerns together also cost a level, since CERQual
 * asks for the concerns to be weighed together rather than one by one.
 */
export function ruleLevel(a: Pick<CertaintyAssessment, 'framework' | 'startLevel' | 'domains'>): CertaintyLevel {
  const fw = FRAMEWORKS[a.framework]
  let index = a.framework === 'grade' && a.startLevel === 'low' ? 1 : 3
  let minor = 0
  for (const d of fw.domains) {
    if (!domainApplies(d, a)) continue
    const judgement = a.domains[d.id]?.judgement
    const opt = d.options.find(o => o.id === judgement)
    if (!opt) continue
    index += opt.shift
    if (a.framework === 'cerqual' && opt.id === 'minor') minor++
  }
  if (minor >= 2) index -= 1
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index))]
}

/** The level shown: the reviewer's override when there is one, else the rule's. */
export function finalLevel(a: CertaintyAssessment): CertaintyLevel {
  return a.override?.level ?? ruleLevel(a)
}

/** The domains that lowered the rating, for "downgraded for …" summaries. */
export function downgradeReasons(a: CertaintyAssessment): string[] {
  const fw = FRAMEWORKS[a.framework]
  return fw.domains
    .filter(d => domainApplies(d, a))
    .filter(d => {
      const opt = d.options.find(o => o.id === a.domains[d.id]?.judgement)
      return opt ? opt.shift < 0 || opt.id === 'minor' : false
    })
    .map(d => d.label.toLowerCase())
}

/** True while any AI-drafted domain is still awaiting the reviewer. */
export function awaitingReview(a: CertaintyAssessment): boolean {
  const fw = FRAMEWORKS[a.framework]
  return fw.domains.some(d => domainApplies(d, a) && a.domains[d.id]?.aiGenerated && !a.domains[d.id]?.verifiedByStudent)
}

/** A first guess at the framework, from the review type and the study designs. */
export function suggestFramework(state: AppState): CertaintyFrameworkId {
  const hint = `${state.profile.reviewType} ${state.profile.method}`.toLowerCase()
  return /qualitative|meta-?ethnograph|thematic synthesis|phenomenolog|grounded theory/.test(hint) ? 'cerqual' : 'grade'
}

// ── Request payload ───────────────────────────────────────────────────────────

const DESIGN_COLUMN = /design|method|study type/i

/**
 * The evidence behind a theme, for the model: every paper with a value in one
 * of the theme's columns, with its values, its study design where the matrix
 * records one, and its risk-of-bias judgement.
 */
export function themeEvidence(state: AppState, theme: Theme) {
  const cols = theme.sourceColumns ?? []
  const designCol = state.matrixColumns.find(c => DESIGN_COLUMN.test(c))
  return state.matrixRows
    .filter(row => cols.some(c => row.cells[c]?.value))
    .map(row => {
      const rob = (state.robAssessments ?? []).find(a => a.paperId === row.paperId)
      const robDomains = rob ? Object.values(rob.domains) : []
      return {
        title: row.title,
        year: row.year || null,
        design: designCol ? row.cells[designCol]?.value ?? '' : '',
        rob_overall: rob?.overall ?? '',
        rob_confirmed: robDomains.length > 0 && robDomains.every(d => !d.aiGenerated || d.verifiedByStudent),
        retracted: state.integrityChecks?.[row.paperId]?.status === 'retracted',
        values: Object.fromEntries(cols.filter(c => row.cells[c]?.value).map(c => [c, row.cells[c].value])),
      }
    })
}

/** The framework definition as the backend receives it. */
export function frameworkPayload(id: CertaintyFrameworkId) {
  const fw = FRAMEWORKS[id]
  return {
    id: fw.id,
    name: fw.name,
    instructions: fw.instructions,
    start_levels: fw.startLevels?.map(s => s.id) ?? [],
    domains: fw.domains.map(d => ({
      id: d.id, label: d.label, question: d.question,
      options: d.options.map(o => ({ id: o.id, label: o.label })),
      upgrade_only: !!d.upgradeOnly,
    })),
  }
}
