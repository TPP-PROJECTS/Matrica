export type StepState = 'active' | 'done' | 'stale' | 'locked' | 'edit'
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'none'
export type MessageType = 'proactive' | 'student' | 'assistant' | 'ask_about_this' | 'command' | 'mirror' | 'stuck' | 'action_confirm'

// ── Agentic chat actions ──────────────────────────────────────────────────────

export type ProposedActionStatus = 'pending' | 'applied' | 'skipped' | 'failed'

export interface ProposedAction {
  id: string
  type: string
  label: string                      // human-readable description shown in card
  detail?: string                    // secondary detail (e.g. new value)
  payload: Record<string, unknown>
  status: ProposedActionStatus
  note?: string                      // failure reason shown when status === 'failed'
}

export interface Step {
  id: number
  label: string
  state: StepState
}

export interface ResearchProfile {
  domain: string
  population: string
  focus: string
  method: string
  reviewType: string
}

export interface TopicCard {
  id: string
  type: 'population' | 'design' | 'risk' | 'review'
  title: string
  description: string
  tags: string[]
  rationale: string
  profileMatch: 'profile_match' | 'inferred' | null
  selected: boolean
  confidence: ConfidenceLevel
}

/**
 * One database's search strategy exactly as it was executed.
 *
 * PRISMA 2020 item 7 asks for the full strategy for every database, filters
 * included, so a reader can re-run it. The query the user types is not that
 * string: OpenAlex has no boolean syntax so the operators are stripped, and
 * PubMed takes date/language/access limits as extra query terms. Only the
 * per-database rewrite is reproducible, so that is what is recorded.
 */
export interface SourceQuery {
  source: string
  queryAsRun: string
  hits: number
}

export interface QueryCard {
  id: string
  queryN: number
  topicId: string
  text: string
  qualityScore: number
  priority: 'high' | 'med'
  databases: string[]
  resultCount: number
  stale: boolean
  // ── Reproducibility record, written each time the query is run ──
  /** ISO timestamp of the most recent run — PRISMA requires the search date. */
  lastRunAt?: string
  /** The limits in force for that run, which are part of the strategy. */
  lastRunFilters?: SearchFilters
  /** What each database was actually asked, and how many hits it reported. */
  sourceQueries?: SourceQuery[]
}

/**
 * How a paper entered the review — a PRISMA 2020 identification pathway.
 *
 * `web` is the flow diagram's second column, "websites and organisations": a
 * record found by web search rather than in a bibliographic database. It is
 * kept distinct from `search` everywhere the two would be summed, because a
 * vendor's documentation page is not a peer-reviewed record and counting it as
 * one would misstate both the identification total and the duplicate figure.
 */
export type PaperOrigin = 'search' | 'snowball' | 'upload' | 'import' | 'web'

/** Lifecycle of the background AI relevance assessment for one paper. */
export type ScoreStatus = 'pending' | 'scored' | 'failed'

/** Who made a paper's current screening decision. */
export type ScreenedBy = 'ai' | 'human'

/** Lifecycle of the LLM auto-screening pass on one paper. */
export type ScreenStatus = 'pending' | 'done' | 'failed'

export interface ResultCard {
  id: string
  title: string
  authors: string
  year: number
  source: string
  relevanceScore: number
  abstract: string
  topicId: string
  queryId: string
  confidence: ConfidenceLevel
  isDuplicate: boolean
  status: 'included' | 'maybe' | 'saved' | 'excluded' | null
  notes: string
  // Fields below are absent on papers from sessions saved before they existed;
  // read them through the defaults in `lib/paperDefaults.ts`.
  origin?: PaperOrigin
  /** For origin === 'snowball': the review-list paper this was chased from. */
  snowballFromId?: string
  /**
   * For origin === 'import': the database whose export file the record came out
   * of, as the reviewer named it. Database searching has to be reported per
   * database, and a record imported from Scopus is not attributable to one
   * without this — the file itself does not reliably say where it came from.
   */
  importedFrom?: string
  scoreStatus?: ScoreStatus
  /** For status === 'excluded': which ScreeningCriterion justified it. */
  exclusionReasonId?: string | null
  // ── Screening decision provenance ──
  /** Who decided the current status. AI decisions are shown as needing review. */
  screenedBy?: ScreenedBy
  /** Free-text justification for the current include/exclude/uncertain call. */
  screeningReason?: string
  /**
   * Set on a paper the AI screened but could not decide from the abstract.
   * status stays null (unscreened) — this only carries the AI's note so the UI
   * can surface "AI unsure: …" and hand the call back to a human.
   */
  screenUncertain?: boolean
  /** Live state during an auto-screen pass, for per-row spinners. */
  screenStatus?: ScreenStatus
}

/**
 * One line of the review protocol. Exclusions must name the criterion they rest
 * on, because PRISMA requires reporting excluded records *with reasons*.
 */
export interface ScreeningCriterion {
  id: string
  kind: 'inclusion' | 'exclusion'
  label: string
}

/** One database this build can search, as reported by the backend. */
export interface SearchSource {
  key: string
  name: string
  blurb: string
  default: boolean
  /** Limits this database has no way to express, so a search cannot apply them. */
  unsupportedLimits: string[]
  /**
   * Whether this database's hit count means "records matching the search".
   * Where it is false the database ranks by relevance over the terms taken
   * separately, so its total rises as a query gets more specific and cannot be
   * read as records identified.
   */
  comparableHits: boolean
  /**
   * True where the source returns grey literature — documentation, white
   * papers, regulatory filings — rather than peer-reviewed work. PRISMA counts
   * those on the websites/organisations pathway, not with database searching.
   */
  greyLiterature?: boolean
}

/** Database limits applied at search time, before any screening happens. */
export interface SearchFilters {
  yearFrom: number | null
  yearTo: number | null
  openAccessOnly: boolean
  excludePreprints: boolean
  language: string          // ISO 639-1 code, '' = any
}

/** Running counts the PRISMA flow diagram is built from. */
export interface ScreeningCounts {
  /**
   * Total hits the databases reported, across all pages — not just what was
   * retrieved — keyed by the query that produced them. Keyed rather than summed
   * because re-running a query re-identifies the same corpus: adding the figure
   * again would inflate "records identified" every time the user hits Search.
   */
  identifiedByQuery: Record<string, number>
  /**
   * Records actually pulled into the tool, keyed by query, for the same reason.
   * Page 1 of a query assigns; later pages add to that query's own entry.
   */
  retrievedByQuery: Record<string, number>
  /**
   * Legacy accumulated duplicate counter. It grew on every re-run of a search —
   * the same inflation `identifiedByQuery` was keyed to avoid — so it is no
   * longer written. Sessions saved before the fix still carry a value, and
   * `duplicatesRemoved()` falls back to it so their exports do not change.
   */
  duplicatesRemoved?: number
}

/**
 * One search run in another database's own interface and brought in as a file.
 *
 * The records are only half of what a review has to report. PRISMA 2020 item 7
 * wants the strategy for *every* database, and for an imported set the tool
 * never saw the query — so it is asked for at import time and kept here. The
 * counts are recorded at the same moment because a second import of an
 * overlapping file cannot be told apart from the first once the records have
 * been merged and de-duplicated.
 */
export interface ImportedSearch {
  id: string
  /** The database searched, as the reviewer named it (e.g. "Scopus"). */
  database: string
  /** The strategy as run there, copied from that database's search history. */
  queryAsRun: string
  /** When it was run there — not the date the file happened to be imported. */
  searchedAt: string
  /** Records the file contained, which is this database's "identified" figure. */
  recordsInFile: number
  /** How many were new to this review; the rest were already held. */
  recordsAdded: number
  /** Entries the file held that carried no title and could not be imported. */
  recordsUnreadable: number
  importedAt: string
  format: 'ris' | 'bibtex'
  filename: string
}

/** Records identified through imported files, across every import. */
export function totalImported(imports: ImportedSearch[]): number {
  return imports.reduce((n, i) => n + i.recordsInFile, 0)
}

/** Records identified across every query — the PRISMA identification total. */
export function totalIdentified(counts: ScreeningCounts): number {
  return Object.values(counts.identifiedByQuery).reduce((a, b) => a + b, 0)
}

/** Records retrieved across every query, counting a repeat hit each time. */
export function totalRetrieved(counts: ScreeningCounts): number {
  return Object.values(counts.retrievedByQuery ?? {}).reduce((a, b) => a + b, 0)
}

/**
 * Records removed as duplicates before screening.
 *
 * Derived, not counted: gross records retrieved minus the unique ones still
 * held. A stored counter cannot survive the user re-running a search, because
 * every already-held paper is re-detected as a duplicate on the second run.
 * Subtraction is idempotent — running the same search ten times leaves both
 * terms unchanged.
 */
export function duplicatesRemoved(counts: ScreeningCounts, uniqueHeld: number): number {
  const gross = totalRetrieved(counts)
  if (gross === 0) return counts.duplicatesRemoved ?? 0   // pre-fix session
  return Math.max(0, gross - uniqueHeld)
}

export interface SystemItem {
  id: string
  name: string
  description: string
  category: string
  url: string | null
  vendor: string
  aiGenerated: boolean
  selected: boolean
}

/**
 * One system's bearing on one topic, as the model reads it.
 *
 * A review that appraises systems alongside the literature has to bring the two
 * back together eventually — a theme about diagnostic accuracy is answered
 * partly by studies and partly by what a named platform actually does. Holding
 * the links in the session makes that relationship visible while the searches
 * are still being planned, and lets the assistant reason about it.
 */
export interface SystemTopicLink {
  systemId: string
  topicId: string
  /** 'strong' when the system is squarely about the topic; 'possible' when partial. */
  strength: 'strong' | 'possible'
  /** One sentence naming the actual connection. */
  reason: string
}

export interface MatrixCell {
  value: string
  aiGenerated: boolean
  confidenceScore: number
  confidenceLevel: ConfidenceLevel
  evidenceType: 'extracted' | 'inferred' | 'not_available'
  sourceRef: string
  extractionMethod: 'verbatim' | 'summarised' | 'inferred' | 'not_available'
  verifiedByStudent: boolean
  /** When the reviewer signed the cell off. */
  verifiedAt?: string
  /**
   * The AI's value, kept when the reviewer corrects it, so the audit can show
   * what was extracted as well as what the review now says.
   */
  originalValue?: string
  /**
   * The whole AI extraction (quote, confidence, method) as it stood before the
   * reviewer's first edit, so the cell can be reset to it.
   */
  originalCell?: Omit<MatrixCell, 'originalValue' | 'originalCell' | 'editExplanation'>
  /** Why the reviewer changed the AI's value, if they said. */
  editExplanation?: CellEditExplanation
}

/** How far the reviewer disagreed with the AI's extraction when editing it. */
export type CellEditReason = 'minor_revision' | 'partial_disagreement' | 'full_disagreement'

export interface CellEditExplanation {
  reason?: CellEditReason
  /** Where the corrected value comes from: a page, quote, table or other source. */
  reference?: string
}

// ── Publication integrity ─────────────────────────────────────────────────────
/**
 * Crossref's record of what has happened to a paper since publication.
 * `unresolved` means it could not be matched (no DOI and no exact title
 * match, or the lookup failed) — it is never taken to mean clear.
 */
export type IntegrityStatus = 'retracted' | 'concern' | 'corrected' | 'clear' | 'unresolved'

export interface IntegrityNotice {
  type: string
  label: string
  doi?: string | null
  date?: string | null
  source?: string | null
}

export interface IntegrityCheck {
  status: IntegrityStatus
  doi?: string | null
  notices: IntegrityNotice[]
  checkedAt: string
}

/** Which of the two matrices an action addresses. */
export type MatrixKind = 'literature' | 'system'

export interface MatrixRow {
  paperId: string
  title: string
  authors: string
  year: number
  cells: Record<string, MatrixCell>
}

export interface SystemMatrixRow {
  systemId: string
  name: string
  vendor: string
  category: string
  url: string | null
  cells: Record<string, MatrixCell>
}

// ── Risk of bias / quality appraisal ──────────────────────────────────────────
//
// The step between "these studies are eligible" and "this is what the evidence
// says". Without it a review weighs a confounded cohort study the same as a
// well-conducted trial.
//
// The instruments themselves (domains, signalling questions, allowed
// judgements) are served by the backend and never generated: a reviewer citing
// "RoB 2" entitles a reader to assume the published domains were applied.

/**
 * Instrument ids. Open rather than a closed union: the catalog lives on the
 * backend and grows there, and a union here would silently reject a new
 * instrument the server already serves.
 */
export type RobToolId = string

/**
 * What to appraise a study with when no validated instrument covers its design.
 *
 * Several designs — AI benchmarks, design science, simulation, Delphi — have no
 * published risk-of-bias tool. Offering one anyway is the worst outcome: the
 * reviewer would cite an instrument that does not cover their work and readers
 * would take the rating at face value. So the field's recognised concerns are
 * named instead, explicitly as an informal checklist.
 */
export interface AppraisalGuidance {
  note: string
  concerns: string[]
}

export interface RobRecommendation {
  designId: string
  recommended: RobTool[]
  guidance: AppraisalGuidance | null
}

export interface RobJudgementOption {
  value: string
  label: string
  tone: 'good' | 'warn' | 'bad' | 'unknown'
  /**
   * What the instrument says warrants this judgement. Shown behind the "?" next
   * to every judgement dropdown: a reviewer picking "Some concerns" over "High
   * risk" is applying a published rule, and having to remember it is how a
   * whole appraisal drifts into a personal scale.
   */
  criteria?: string
}

export interface RobDomainSpec {
  id: string
  label: string
  question: string
  /** AMSTAR 2 weights seven of its items as critical to the overall rating. */
  critical: boolean
}

export interface RobTool {
  id: RobToolId
  name: string
  fullName: string
  appliesTo: string
  /** The citation the instrument is published under, shown wherever it is used. */
  reference: string
  /** Resolvable link to that publication (a DOI, or the checklist's own page). */
  referenceUrl?: string
  /** The instrument's official home, where its full guidance manual lives. */
  toolUrl?: string
  domains: RobDomainSpec[]
  judgements: RobJudgementOption[]
  overallRule: string
}

export interface RobDomainResult {
  judgement: string
  rationale: string
  /** Quote from the paper, checked against it the same way matrix cells are. */
  supportQuote: string
  aiGenerated: boolean
  /** An AI appraisal is a draft; this is the reviewer signing it off. */
  verifiedByStudent: boolean
}

export interface RobAssessment {
  paperId: string
  toolId: RobToolId
  domains: Record<string, RobDomainResult>
  overall: string
  overallRationale: string
  assessedAt: string
}

export interface SynthesisBlock {
  id: string
  blockType: 'focus' | 'patterns' | 'unclear' | 'missing' | 'custom'
  title: string
  content: string
  paperCount: number
  avgConfidence: number
  isLowConfidence: boolean
}

export interface Theme {
  id: string
  name: string
  paperCount: number
  totalPapers: number
  coverageLabel: 'Dense' | 'Moderate' | 'Sparse'
  profileMatch: 'profile_match' | 'inferred' | null
  blocks: SynthesisBlock[]
  sourceColumns: string[]        // literature matrix columns driving this theme
  systemSourceColumns: string[]  // system matrix columns driving this theme
  /**
   * Defined by the reviewer rather than generated. Such a theme survives an AI
   * regeneration of the synthesis, and its coverage is computed live from the
   * columns it draws on instead of being reported by the model.
   */
  userDefined?: boolean
}

// ── Certainty of evidence (GRADE / GRADE-CERQual) ─────────────────────────────
export type CertaintyFrameworkId = 'grade' | 'cerqual'
export type CertaintyLevel = 'high' | 'moderate' | 'low' | 'very_low'

export interface CertaintyDomainJudgement {
  /** An option id from the framework's definition of this domain. */
  judgement: string
  rationale: string
  aiGenerated: boolean
  verifiedByStudent: boolean
}

/** The certainty rating of one theme's finding. */
export interface CertaintyAssessment {
  themeId: string
  framework: CertaintyFrameworkId
  /** The finding being rated, stated in one or two sentences. */
  finding: string
  /** GRADE only: where the body of evidence starts before any domain moves it. */
  startLevel?: 'high' | 'low'
  domains: Record<string, CertaintyDomainJudgement>
  /** The reviewer's own level, when they depart from the framework's rule. */
  override?: { level: CertaintyLevel; reason: string } | null
  assessedAt: string
}

export interface GapDimension {
  id: string
  type: 'dense' | 'thin' | 'ignored' | 'weak_design' | 'uncertain' | 'no_theory'
  label: string
  description: string
  supportingPapers: number
  selected: boolean
  confidenceScore: number
}

export type RQFormat = 'pico' | 'phenomenological' | 'predictive' | 'custom'

export interface RQOption {
  id: string
  format: RQFormat
  label: string
  text: string
  recommended: boolean
  formatHint: string
}

export interface StudyDesignOption {
  id: string
  name: string
  recommended: boolean
  hint: string
  category?: string       // catalog grouping, e.g. 'Evidence Synthesis'
  guideline?: string      // reporting guideline that fixes the paper framework
  matchReason?: string    // LLM's one-line reason when matched to the current topic
}

// LLM-generated substantive heading inside a fixed framework section,
// like the numbered subsections (2.1, 3.2 …) of a real published paper
export interface PaperSubsection {
  title: string     // topic-specific heading as it would appear in the article
  content: string   // outline of exactly what to write under this heading
  /**
   * Draft prose for this subsection — the paragraphs themselves rather than
   * instructions for writing them, generated from the review's own matrix,
   * synthesis, gap statement and appraisal.
   *
   * Kept separate from `content` because they answer different questions: the
   * outline says what belongs here and survives rewriting, the sample is one
   * attempt at saying it. Either can be regenerated without disturbing the
   * other, and the sample is freely editable — once the author has rewritten a
   * paragraph it is theirs, and regenerating would throw that away, so
   * regeneration is always an explicit action.
   */
  sample?: string
  /** Whether the current sample text is the model's or the author's own. */
  sampleEdited?: boolean
}

export interface PaperSection {
  number: number
  name: string
  purpose: string
  bullets: string[]               // legacy flat outline (older sessions)
  subsections?: PaperSubsection[] // real-paper style: generated headings + content
  origin?: 'framework' | 'ai'     // guideline anchor vs LLM-inserted content section
}

export interface TopicResearchQuestion {
  format: RQFormat
  label: string
  text: string
  recommended: boolean
}

// AI-generated final topic candidates (step 8) — distinct from step-1 initial topics
export interface FinalTopicOption {
  id: string
  title: string
  description: string
  rationale: string       // how this emerged from synthesis + gaps
  keyThemes: string[]     // synthesis themes it addresses
  researchQuestions: TopicResearchQuestion[]
}

export interface TopicFinalData {
  topicId: string
  researchQuestions: TopicResearchQuestion[]
  paperSections: PaperSection[]
}

export interface ChatMessage {
  id: string
  type: MessageType
  content: string
  timestamp: string
  isNew?: boolean
  elementRef?: string
  actionButtons?: { label: string; action: string }[]
  isDismissable?: boolean
  proposedActions?: ProposedAction[]   // for type === 'action_confirm'
}

/**
 * A checkpoint: this project as it stood at one moment, kept so the user can
 * come back to it.
 *
 * Not the same thing as the project list (which shows *different* reviews) and
 * not the same thing as undo (which covers the last few actions of the current
 * session). This is the case neither covers — wanting the matrix back the way
 * it was before yesterday's re-extraction.
 *
 * The snapshot itself lives on the backend: it is as large as the project, and
 * a handful of them in localStorage would exhaust the quota the working session
 * needs.
 */
export interface VersionEntry {
  id: string
  projectId: string
  createdAt: string
  step: number
  stepName: string
  /** What the user (or the workflow) called this point. */
  label: string
  /** 'manual' when the user asked for it, 'step_complete' when automatic. */
  trigger: 'manual' | 'step_complete'
}

/** `automated_check`: a finding from a lookup the tool ran itself, not a user act. */
export type DecisionJournalKind = 'justification' | 'ai_explanation_view' | 'user_action' | 'automated_check'

export interface DecisionJournalEntry {
  id: string
  kind: DecisionJournalKind
  step: number
  action: string
  entityType:
    | 'profile' | 'query' | 'search_filter' | 'matrix_column' | 'matrix_cell'
    | 'system' | 'screening_protocol' | 'synthesis' | 'theme' | 'gap_statement'
    | 'topic' | 'paper' | 'research_question' | 'study_design' | 'final_topic'
    | 'quality_appraisal'
  entityId: string
  entityLabel: string
  justification?: string
  previousValue?: string
  newValue?: string
  details?: string
  createdAt: string
}

// ── Session persistence ───────────────────────────────────────────────────────

export interface SessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  currentStep: number
  /** Step numbering `currentStep` was written under. See lib/steps.ts. */
  stepSchema?: number
  topicPreview: string
}

export interface SessionSnapshot {
  sessionId: string
  sessionTitle: string
  createdAt: string
  updatedAt: string
  currentStep: number
  staleSteps: number[]
  /**
   * The furthest step this review has ever reached. Navigation is allowed
   * anywhere up to it, so revisiting an earlier step can never strand a later
   * one behind a "locked" badge that only an AI regeneration could lift.
   */
  maxStepReached?: number
  /** Which step numbering this snapshot was written under. See lib/steps.ts. */
  stepSchema?: number
  // Step 1
  profile: ResearchProfile
  chatMessages: ChatMessage[]
  // Step 2 — Matrix Schema
  systemMatrixEnabled: boolean
  matrixColumnSuggestions: string[]
  systemMatrixColumnSuggestions: string[]
  columnDescriptions: Record<string, string>
  systemColumnDescriptions: Record<string, string>
  // System Review
  systemItems: SystemItem[]
  systemTopicLinks?: SystemTopicLink[]
  // Step 3
  topics: TopicCard[]
  queries: QueryCard[]
  // Step 4
  results: ResultCard[]
  reviewList: ResultCard[]
  searchFilters: SearchFilters
  /**
   * Database keys every search runs against. Which databases a review searched
   * is a reported part of its method, not a preference, so it is held in the
   * session rather than in component state or the browser.
   */
  searchSources: string[]
  criteria: ScreeningCriterion[]
  screening: ScreeningCounts
  /** Searches run in other databases and brought in as RIS/BibTeX files. */
  importedSearches: ImportedSearch[]
  // Step 5
  matrixColumns: string[]
  matrixRows: MatrixRow[]
  systemMatrixColumns: string[]
  systemMatrixRows: SystemMatrixRow[]
  /**
   * Open-access full text per paper id, when a copy could be obtained.
   *
   * Kept in one keyed map rather than on ResultCard because every paper is held
   * twice — once in `results`, once in `reviewList` — and a 24 000-character
   * document stored twice per paper adds up fast against the browser's quota.
   *
   * Cached because fetching it means locating an OA copy and downloading a PDF:
   * doing that again for every column, and again for the risk-of-bias step,
   * is the slowest thing the tool does. Holding it also lets a supporting quote
   * be checked against the text it actually came from, rather than only against
   * the abstract.
   */
  paperFullTexts: Record<string, string>
  /** Retraction / concern / correction status per paper id, from Crossref. */
  integrityChecks?: Record<string, IntegrityCheck>
  // Step 5b — quality appraisal
  robToolId: RobToolId | null
  robAssessments: RobAssessment[]
  /** Certainty-of-evidence ratings, one per theme. */
  certaintyAssessments?: CertaintyAssessment[]
  // Step 6
  themes: Theme[]
  activeThemeId: string
  // Step 7
  gaps: GapDimension[]
  gapStatement: string
  // Per-schema-axis gap analyses, keyed "lit:<column>" / "sys:<column>".
  // Shown in the Gap step's left panel; also given to the assistant so it can
  // act on requests that reference them.
  axisGaps: Record<string, string>
  rqOptions: RQOption[]
  selectedRQId: string | null
  // Step 8
  studyDesignOptions: StudyDesignOption[]
  selectedStudyDesignId: string | null
  finalTopicOptions: FinalTopicOption[]
  topicFinalData: TopicFinalData[]
  selectedFinalTopicId: string | null
  decisionJournal: DecisionJournalEntry[]
}

export interface AppState {
  // Session identity
  sessionId: string
  sessionTitle: string
  createdAt: string
  // UI state
  currentStep: number
  stepStates: Record<number, StepState>
  profileCompleteness: number
  saveStatus: 'saved' | 'saving'
  showVersionHistory: boolean
  showBackNavModal: boolean
  pendingBackStep: number | null
  editMode: boolean
  staleSteps: number[]
  /** Furthest step ever reached — every step up to it stays navigable. */
  maxStepReached: number
  /**
   * Read-only browsing. Every step is reachable and nothing can be edited;
   * the stale/edit machinery is silent while it is on.
   */
  reviewMode: boolean
  paperSections: PaperSection[]
  // Step 1
  profile: ResearchProfile
  chatMessages: ChatMessage[]
  // Step 2 (Matrix Schema)
  systemMatrixEnabled: boolean
  matrixColumnSuggestions: string[]
  systemMatrixColumnSuggestions: string[]
  columnDescriptions: Record<string, string>
  systemColumnDescriptions: Record<string, string>
  // Step 3 (Systems tab) — System Review
  systemItems: SystemItem[]
  /** Topic ↔ system relevance, computed on demand in the search step. */
  systemTopicLinks: SystemTopicLink[]
  // Step 3
  topics: TopicCard[]
  queries: QueryCard[]
  // Step 4
  results: ResultCard[]
  reviewList: ResultCard[]
  searchFilters: SearchFilters
  /**
   * Database keys every search runs against. Which databases a review searched
   * is a reported part of its method, not a preference, so it is held in the
   * session rather than in component state or the browser.
   */
  searchSources: string[]
  criteria: ScreeningCriterion[]
  screening: ScreeningCounts
  /** Searches run in other databases and brought in as RIS/BibTeX files. */
  importedSearches: ImportedSearch[]
  // Step 5
  matrixColumns: string[]
  matrixRows: MatrixRow[]
  systemMatrixColumns: string[]
  systemMatrixRows: SystemMatrixRow[]
  /**
   * Open-access full text per paper id, when a copy could be obtained.
   *
   * Kept in one keyed map rather than on ResultCard because every paper is held
   * twice — once in `results`, once in `reviewList` — and a 24 000-character
   * document stored twice per paper adds up fast against the browser's quota.
   *
   * Cached because fetching it means locating an OA copy and downloading a PDF:
   * doing that again for every column, and again for the risk-of-bias step,
   * is the slowest thing the tool does. Holding it also lets a supporting quote
   * be checked against the text it actually came from, rather than only against
   * the abstract.
   */
  paperFullTexts: Record<string, string>
  /** Retraction / concern / correction status per paper id, from Crossref. */
  integrityChecks?: Record<string, IntegrityCheck>
  // Step 5b — quality appraisal
  robToolId: RobToolId | null
  robAssessments: RobAssessment[]
  /** Certainty-of-evidence ratings, one per theme. */
  certaintyAssessments?: CertaintyAssessment[]
  // Step 6
  themes: Theme[]
  activeThemeId: string
  // Step 7
  gaps: GapDimension[]
  gapStatement: string
  // Per-schema-axis gap analyses, keyed "lit:<column>" / "sys:<column>".
  // Shown in the Gap step's left panel; also given to the assistant so it can
  // act on requests that reference them.
  axisGaps: Record<string, string>
  rqOptions: RQOption[]
  selectedRQId: string | null
  // Step 8
  studyDesignOptions: StudyDesignOption[]
  selectedStudyDesignId: string | null
  finalTopicOptions: FinalTopicOption[]
  topicFinalData: TopicFinalData[]
  selectedFinalTopicId: string | null
  decisionJournal: DecisionJournalEntry[]
}

// ── Chatbot-operable actions ──────────────────────────────────────────────────
//
// A trailing `// @chatbot <description>` marks an action as invocable by the
// research assistant. scripts/genActionCatalog.ts parses this union and emits
// src/lib/generatedActionCatalog.ts, which drives BOTH the action list sent to
// the assistant and the runtime validation. Tagging an action here is therefore
// the only step needed to make a new feature chatbot-operable:
//
//     1. write the reducer case (the feature itself)
//     2. tag its action below
//     3. npm run gen:actions      (the build does this for you)
//
// Exposure is opt-in: an untagged action is unreachable by the assistant. That
// is what keeps NEW_SESSION, RESTORE_STATE, CLEAR_RESULTS and friends safe, so
// only tag an action you are happy for a language model to invoke on its own.
//
// ── Writing the description ───────────────────────────────────────────────────
//
// The description is not a code comment for humans: it is pasted verbatim into
// the assistant's prompt. All the model ever sees of an action is
//
//     - ADD_MATRIX_COLUMN: Add one column to the literature matrix.
//       payload: { "column": string }
//
// i.e. the action name, your sentence, and the field names/types (extracted from
// the type below — never restate them). Your sentence has one job: supply what
// the name and the types cannot.
//
// Shape:  <verb> <the thing it affects> (<non-obvious semantics>)
//
// 1. Distinguish it from its siblings. ADD_MATRIX_COLUMN and
//    ADD_SYSTEM_MATRIX_COLUMN are near-identical names; the words "literature"
//    and "system" are the only thing the model can pick between them on.
//        BAD:  Add a column.
//        GOOD: Add one column to the literature matrix.
//
// 2. Spell out semantics the field names hide. These are the ones that bite:
//      - toggles:      "(flips its current state)"  — or the model re-sends a
//                      toggle for something already selected and undoes it
//      - replacements: "Replace ALL ..."            — or it appends, wiping data
//      - whole values: "(full new text)"            — the payload is the new
//                      value, not a patch, so the model must include the parts
//                      that stay unchanged
//      - exact keys:   "(oldName must match exactly)"
//
// 3. Describe the effect on the user's document, in words the user would use —
//    not the implementation.
//        BAD:  Dispatch to the matrixColumns array in AppState.
//        GOOD: Add one column to the literature matrix.
//
// 4. One line, ending in a period; it is rendered into a list.
//
// Before committing a tag, ask: can the model tell this apart from its siblings,
// have I named every hidden semantic, and is it phrased the way a user speaks?

export type AppAction =
  | { type: 'SET_STEP'; step: number } // @chatbot Jump to a workflow step (1-7).
  | { type: 'SET_REVIEW_MODE'; enabled: boolean }
  | { type: 'SET_SYSTEM_TOPIC_LINKS'; links: SystemTopicLink[] }
  | { type: 'ADVANCE_STEP' }
  | { type: 'BACK_NAV_CONFIRM' }
  | { type: 'BACK_NAV_REQUEST'; step: number } // @chatbot Go back to an earlier workflow step (1-9); asks the user to confirm.
  | { type: 'BACK_NAV_CANCEL' }
  | { type: 'UPDATE_PROFILE'; field: keyof ResearchProfile; value: string } // @chatbot Set one research profile field.
  | { type: 'TOGGLE_TOPIC'; topicId: string } // @chatbot Select or deselect a topic (flips its current state).
  | { type: 'UPDATE_TOPIC'; topicId: string; field: 'title' | 'description'; value: string } // @chatbot Rewrite a topic's title or description.
  | { type: 'ADD_TOPIC'; topic: TopicCard }
  | { type: 'SET_TOPICS'; topics: TopicCard[] }
  | { type: 'SET_SYSTEM_ITEMS'; items: SystemItem[] }
  | { type: 'TOGGLE_SYSTEM_ITEM'; itemId: string } // @chatbot Select or deselect a system (flips its current state).
  | { type: 'ADD_CUSTOM_SYSTEM'; name: string } // @chatbot Add a custom system to the system review list.
  | { type: 'SET_QUERIES'; queries: QueryCard[] }
  | { type: 'RECORD_QUERY_RUN'; queryId: string; runAt: string; filters: SearchFilters; sourceQueries: SourceQuery[] }
  | { type: 'ADD_SEARCH_RESULTS'; results: ResultCard[]; identifiedFor?: { queryId: string; count: number }; retrievedFor?: { queryId: string; page: number; count: number } }
  | { type: 'CLEAR_RESULTS' }
  | { type: 'SET_SEARCH_FILTERS'; filters: SearchFilters }
  | { type: 'SET_SEARCH_SOURCES'; sources: string[] } // @chatbot Choose which literature databases every search runs against, by key (openalex, pubmed, europepmc, crossref, semanticscholar). // @chatbot Set the database search limits (year range, open access, preprints, language) applied to future searches.
  | { type: 'ADD_CRITERION'; criterion: ScreeningCriterion } // @chatbot Add one inclusion or exclusion criterion to the screening protocol.
  | { type: 'REMOVE_CRITERION'; criterionId: string } // @chatbot Remove a screening criterion from the protocol.
  | { type: 'EXCLUDE_PAPER'; paperId: string; reasonId: string | null; reason?: string; by?: ScreenedBy } // @chatbot Exclude a paper from the review, citing the exclusion criterion id that justifies it.
  | { type: 'UNEXCLUDE_PAPER'; paperId: string } // @chatbot Undo a paper's exclusion, returning it to unscreened.
  | { type: 'MARK_SCREEN_UNCERTAIN'; paperId: string; reason: string; by?: ScreenedBy }
  | { type: 'SET_SCREEN_STATUS'; paperId: string; status: ScreenStatus }
  | { type: 'RESET_AI_SCREENING' } // @chatbot Clear every screening decision the AI made, leaving human decisions untouched.
  | { type: 'UPDATE_REVIEW_NOTE'; paperId: string; note: string } // @chatbot Set the note on a review-list paper (full new text).
  | { type: 'UPDATE_PAPER_ABSTRACT'; paperId: string; abstract: string }
  | { type: 'SET_RESULT_SCORE_STATUS'; paperId: string; status: ScoreStatus }
  | { type: 'TOGGLE_REVIEW'; paperId: string }
  | { type: 'ADD_TO_REVIEW'; paperId: string; status: 'included' | 'maybe'; reason?: string; by?: ScreenedBy } // @chatbot Add a search-result paper to the review list.
  | { type: 'REMOVE_FROM_REVIEW'; paperId: string } // @chatbot Remove a paper from the review list.
  | { type: 'UPDATE_REVIEW_STATUS'; paperId: string; status: ResultCard['status'] } // @chatbot Change a review-list paper's status.
  | { type: 'ADD_DECISION_JOURNAL_ENTRY'; entry: DecisionJournalEntry }
  | { type: 'SEND_MESSAGE'; content: string }
  | { type: 'ADD_CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'DISMISS_MESSAGE'; messageId: string }
  | { type: 'TOGGLE_HISTORY' }
  | { type: 'TOGGLE_GAP_SELECTED'; gapId: string } // @chatbot Select or deselect a gap dimension (flips its current state).
  | { type: 'SELECT_RQ'; rqId: string } // @chatbot Set the active research question.
  | { type: 'SELECT_STUDY_DESIGN'; designId: string } // @chatbot Choose the study design.
  | { type: 'UPDATE_GAP_STATEMENT'; text: string } // @chatbot Rewrite the gap statement (full new text).
  | { type: 'SET_AXIS_GAP'; key: string; text: string }
  | { type: 'UPDATE_THEME_COLUMNS'; themeId: string; columns: string[] } // @chatbot Set which literature-matrix columns a theme draws on.
  | { type: 'UPDATE_RESULT_RELEVANCE'; paperId: string; score: number; confidence: ConfidenceLevel }
  | { type: 'SET_SYSTEM_MATRIX_ENABLED'; enabled: boolean } // @chatbot Turn the system matrix on or off.
  | { type: 'SET_MATRIX_COLUMN_SUGGESTIONS'; columns: string[] }
  | { type: 'SET_SYSTEM_MATRIX_COLUMN_SUGGESTIONS'; columns: string[] }
  | { type: 'MERGE_COLUMN_DESCRIPTIONS'; system: boolean; descriptions: Record<string, string> }
  | { type: 'SET_MATRIX_COLUMNS'; columns: string[] } // @chatbot Replace ALL literature matrix columns.
  | { type: 'ADD_MATRIX_COLUMN'; column: string } // @chatbot Add one column to the literature matrix.
  | { type: 'RENAME_MATRIX_COLUMN'; oldName: string; newName: string } // @chatbot Rename a literature matrix column (oldName must match exactly).
  | { type: 'REMOVE_MATRIX_COLUMN'; column: string } // @chatbot Remove a literature matrix column (must match exactly).
  | { type: 'SYNC_MATRIX_ROWS' }
  | { type: 'SET_SYSTEM_MATRIX_COLUMNS'; columns: string[] } // @chatbot Replace ALL system matrix columns.
  | { type: 'ADD_SYSTEM_MATRIX_COLUMN'; column: string } // @chatbot Add one column to the system matrix.
  | { type: 'RENAME_SYSTEM_MATRIX_COLUMN'; oldName: string; newName: string } // @chatbot Rename a system matrix column (oldName must match exactly).
  | { type: 'REMOVE_SYSTEM_MATRIX_COLUMN'; column: string } // @chatbot Remove a system matrix column (must match exactly).
  | { type: 'SYNC_SYSTEM_MATRIX_ROWS' }
  | { type: 'ADD_UPLOADED_PAPERS'; papers: ResultCard[] }
  | { type: 'IMPORT_RECORDS'; papers: ResultCard[]; search: Omit<ImportedSearch, 'recordsAdded'> }
  | { type: 'ADD_SYSTEM_WITH_ROW'; item: SystemItem }
  | { type: 'UPDATE_MATRIX_ROW_CELLS'; paperId: string; cells: Record<string, MatrixCell> }
  | { type: 'UPDATE_SYSTEM_MATRIX_ROW_CELLS'; systemId: string; cells: Record<string, MatrixCell> }
  // Reviewer sign-off on extracted data. Deliberately not exposed to the chatbot:
  // a confirmation is only worth anything if a person made it.
  | { type: 'REVIEW_MATRIX_CELL'; matrix: MatrixKind; rowId: string; column: string; verified: boolean; value?: string; explanation?: CellEditExplanation }
  | { type: 'RESET_MATRIX_CELL'; matrix: MatrixKind; rowId: string; column: string }
  | { type: 'SET_CERTAINTY_ASSESSMENT'; assessment: CertaintyAssessment }
  | { type: 'UPDATE_CERTAINTY_DOMAIN'; themeId: string; domainId: string; judgement?: string; rationale?: string; verified?: boolean }
  | { type: 'UPDATE_CERTAINTY_ASSESSMENT'; themeId: string; finding?: string; startLevel?: 'high' | 'low'; override?: { level: CertaintyLevel; reason: string } | null }
  | { type: 'REMOVE_CERTAINTY_ASSESSMENT'; themeId: string }
  | { type: 'SET_INTEGRITY_CHECKS'; checks: Record<string, IntegrityCheck> }
  | { type: 'VERIFY_MATRIX_CELLS'; matrix: MatrixKind; column: string; rowIds: string[] }
  | { type: 'SET_PAPER_FULL_TEXT'; paperId: string; text: string }
  | { type: 'SET_ROB_TOOL'; toolId: RobToolId | null } // @chatbot Choose the risk-of-bias appraisal instrument (rob2, robins_i or amstar2), or null for none.
  | { type: 'SET_ROB_ASSESSMENT'; assessment: RobAssessment }
  | { type: 'UPDATE_ROB_DOMAIN'; paperId: string; domainId: string; judgement?: string; rationale?: string; verifiedByStudent?: boolean }
  | { type: 'CLEAR_ROB_ASSESSMENTS' } // @chatbot Discard every risk-of-bias assessment, including ones a human confirmed.
  | { type: 'SET_THEMES'; themes: Theme[] }
  | { type: 'ADD_THEME'; theme: Theme } // @chatbot Add a new synthesis theme (give it an id, name, source columns and empty blocks).
  | { type: 'RENAME_THEME'; themeId: string; name: string } // @chatbot Rename a synthesis theme.
  | { type: 'REMOVE_THEME'; themeId: string } // @chatbot Delete a synthesis theme.
  | { type: 'SET_ACTIVE_THEME'; themeId: string }
  | { type: 'REMOVE_SYNTHESIS_BLOCK'; themeId: string; blockId: string }
  | { type: 'ADD_SYNTHESIS_BLOCK'; themeId: string; block: SynthesisBlock }
  | { type: 'UPDATE_SYNTHESIS_BLOCK'; themeId: string; blockId: string; content: string; stats?: { paperCount: number; avgConfidence: number; isLowConfidence: boolean } } // @chatbot Rewrite a synthesis block's content (full new text).
  | { type: 'UPDATE_THEME_SYSTEM_COLUMNS'; themeId: string; columns: string[] } // @chatbot Set which system-matrix columns a theme draws on.
  | { type: 'REMOVE_RESULTS'; paperIds: string[] }
  | { type: 'SET_RQ_OPTIONS'; options: RQOption[] }
  | { type: 'SET_STUDY_DESIGN_OPTIONS'; options: StudyDesignOption[] }
  | { type: 'SET_FINAL_TOPIC_OPTIONS'; options: FinalTopicOption[] }
  | { type: 'SET_TOPIC_FINAL_DATA'; data: TopicFinalData[] }
  | { type: 'UPDATE_PAPER_SECTIONS'; topicId: string; sections: PaperSection[] }
  | { type: 'SELECT_FINAL_TOPIC'; topicId: string } // @chatbot Choose the final research topic.
  | { type: 'DISMISS_BACK_NAV_MODAL' }
  | { type: 'SET_SAVE_STATUS'; status: 'saved' | 'saving' }
  | { type: 'SET_SESSION_TITLE'; title: string } // @chatbot Rename this research session.
  | { type: 'NEW_SESSION' }
  | { type: 'LOAD_SESSION'; snapshot: SessionSnapshot }
  | { type: 'UPDATE_ACTION_STATUS'; messageId: string; actionId: string; status: ProposedActionStatus; note?: string }
  | { type: 'RESTORE_STATE'; state: AppState }
