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
export type TriggerType = 'student_action' | 'ai_proactive' | 'chat_command' | 'consistency_correction'

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
}

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
  status: 'included' | 'maybe' | 'saved' | null
  notes: string
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

export interface MatrixCell {
  value: string
  aiGenerated: boolean
  confidenceScore: number
  confidenceLevel: ConfidenceLevel
  evidenceType: 'extracted' | 'inferred' | 'not_available'
  sourceRef: string
  extractionMethod: 'verbatim' | 'summarised' | 'inferred' | 'not_available'
  verifiedByStudent: boolean
}

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

export interface VersionEntry {
  id: string
  step: number
  stepName: string
  timestamp: string
  changeSummary: string
  triggerType: TriggerType
  isCurrent: boolean
  decisionJournal?: string
  avgConfidence?: number
  dismissedContradiction?: boolean
  chatExcerpt?: string
}

export interface ConsistencyAlert {
  claim: string
  data: string
  detail: string
}

// ── Session persistence ───────────────────────────────────────────────────────

export interface SessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  currentStep: number
  topicPreview: string
}

export interface SessionSnapshot {
  sessionId: string
  sessionTitle: string
  createdAt: string
  updatedAt: string
  currentStep: number
  staleSteps: number[]
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
  // Step 3
  topics: TopicCard[]
  queries: QueryCard[]
  // Step 4
  results: ResultCard[]
  reviewList: ResultCard[]
  // Step 5
  matrixColumns: string[]
  matrixRows: MatrixRow[]
  systemMatrixColumns: string[]
  systemMatrixRows: SystemMatrixRow[]
  // Step 6
  themes: Theme[]
  activeThemeId: string
  // Step 7
  gaps: GapDimension[]
  gapStatement: string
  rqOptions: RQOption[]
  selectedRQId: string | null
  // Step 8
  studyDesignOptions: StudyDesignOption[]
  selectedStudyDesignId: string | null
  finalTopicOptions: FinalTopicOption[]
  topicFinalData: TopicFinalData[]
  selectedFinalTopicId: string | null
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
  consistencyAlert: ConsistencyAlert | null
  editMode: boolean
  staleSteps: number[]
  versionHistory: VersionEntry[]
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
  // Step 2b — System Review
  systemItems: SystemItem[]
  // Step 3
  topics: TopicCard[]
  queries: QueryCard[]
  // Step 4
  results: ResultCard[]
  reviewList: ResultCard[]
  // Step 5
  matrixColumns: string[]
  matrixRows: MatrixRow[]
  systemMatrixColumns: string[]
  systemMatrixRows: SystemMatrixRow[]
  // Step 6
  themes: Theme[]
  activeThemeId: string
  // Step 7
  gaps: GapDimension[]
  gapStatement: string
  rqOptions: RQOption[]
  selectedRQId: string | null
  // Step 8
  studyDesignOptions: StudyDesignOption[]
  selectedStudyDesignId: string | null
  finalTopicOptions: FinalTopicOption[]
  topicFinalData: TopicFinalData[]
  selectedFinalTopicId: string | null
}

// ── Chatbot-operable actions ──────────────────────────────────────────────────
// A trailing `// @chatbot <description>` marks an action as invocable by the
// research assistant. scripts/genActionCatalog.ts parses this union and emits
// src/lib/generatedActionCatalog.ts, which drives BOTH the action list sent to
// the assistant and the runtime validation — so tagging an action here is the
// only step needed to make a new feature chatbot-operable.

export type AppAction =
  | { type: 'SET_STEP'; step: number } // @chatbot Jump forward to a workflow step (1-9).
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
  | { type: 'ADD_SEARCH_RESULTS'; results: ResultCard[] }
  | { type: 'CLEAR_RESULTS' }
  | { type: 'TOGGLE_REVIEW'; paperId: string }
  | { type: 'ADD_TO_REVIEW'; paperId: string; status: 'included' | 'maybe' } // @chatbot Add a search-result paper to the review list.
  | { type: 'REMOVE_FROM_REVIEW'; paperId: string } // @chatbot Remove a paper from the review list.
  | { type: 'UPDATE_REVIEW_STATUS'; paperId: string; status: ResultCard['status'] } // @chatbot Change a review-list paper's status.
  | { type: 'SEND_MESSAGE'; content: string }
  | { type: 'ADD_CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'DISMISS_MESSAGE'; messageId: string }
  | { type: 'TOGGLE_HISTORY' }
  | { type: 'TOGGLE_TOPIC_SELECTED'; topicId: string }
  | { type: 'TOGGLE_GAP_SELECTED'; gapId: string } // @chatbot Select or deselect a gap dimension (flips its current state).
  | { type: 'SELECT_RQ'; rqId: string } // @chatbot Set the active research question.
  | { type: 'SELECT_STUDY_DESIGN'; designId: string } // @chatbot Choose the study design.
  | { type: 'UPDATE_GAP_STATEMENT'; text: string } // @chatbot Rewrite the gap statement (full new text).
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
  | { type: 'INIT_MATRIX_ROWS' }
  | { type: 'SET_SYSTEM_MATRIX_COLUMNS'; columns: string[] } // @chatbot Replace ALL system matrix columns.
  | { type: 'ADD_SYSTEM_MATRIX_COLUMN'; column: string } // @chatbot Add one column to the system matrix.
  | { type: 'RENAME_SYSTEM_MATRIX_COLUMN'; oldName: string; newName: string } // @chatbot Rename a system matrix column (oldName must match exactly).
  | { type: 'REMOVE_SYSTEM_MATRIX_COLUMN'; column: string } // @chatbot Remove a system matrix column (must match exactly).
  | { type: 'INIT_SYSTEM_MATRIX_ROWS' }
  | { type: 'ADD_UPLOADED_PAPERS'; papers: ResultCard[] }
  | { type: 'ADD_SYSTEM_WITH_ROW'; item: SystemItem }
  | { type: 'UPDATE_MATRIX_ROW_CELLS'; paperId: string; cells: Record<string, MatrixCell> }
  | { type: 'UPDATE_SYSTEM_MATRIX_ROW_CELLS'; systemId: string; cells: Record<string, MatrixCell> }
  | { type: 'SET_THEMES'; themes: Theme[] }
  | { type: 'ADD_SYNTHESIS_BLOCK'; themeId: string; block: SynthesisBlock }
  | { type: 'UPDATE_SYNTHESIS_BLOCK'; themeId: string; blockId: string; content: string } // @chatbot Rewrite a synthesis block's content (full new text).
  | { type: 'UPDATE_THEME_SYSTEM_COLUMNS'; themeId: string; columns: string[] } // @chatbot Set which system-matrix columns a theme draws on.
  | { type: 'REMOVE_RESULTS'; paperIds: string[] }
  | { type: 'SET_RQ_OPTIONS'; options: RQOption[] }
  | { type: 'SET_STUDY_DESIGN_OPTIONS'; options: StudyDesignOption[] }
  | { type: 'SET_FINAL_TOPIC_OPTIONS'; options: FinalTopicOption[] }
  | { type: 'SET_TOPIC_FINAL_DATA'; data: TopicFinalData[] }
  | { type: 'UPDATE_PAPER_SECTIONS'; topicId: string; sections: PaperSection[] }
  | { type: 'SELECT_FINAL_TOPIC'; topicId: string } // @chatbot Choose the final research topic.
  | { type: 'DISMISS_CONSISTENCY_ALERT' }
  | { type: 'DISMISS_BACK_NAV_MODAL' }
  | { type: 'SET_SAVE_STATUS'; status: 'saved' | 'saving' }
  | { type: 'SET_SESSION_TITLE'; title: string } // @chatbot Rename this research session.
  | { type: 'NEW_SESSION' }
  | { type: 'LOAD_SESSION'; snapshot: SessionSnapshot }
  | { type: 'UPDATE_ACTION_STATUS'; messageId: string; actionId: string; status: ProposedActionStatus; note?: string }
  | { type: 'RESTORE_STATE'; state: AppState }
