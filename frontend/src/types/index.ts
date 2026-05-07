export type StepState = 'active' | 'done' | 'stale' | 'locked' | 'edit'
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'none'
export type MessageType = 'proactive' | 'student' | 'assistant' | 'ask_about_this' | 'command' | 'mirror' | 'stuck' | 'action_confirm'

// ── Agentic chat actions ──────────────────────────────────────────────────────

export type ProposedActionStatus = 'pending' | 'applied' | 'skipped'

export interface ProposedAction {
  id: string
  type: string
  label: string                      // human-readable description shown in card
  detail?: string                    // secondary detail (e.g. new value)
  payload: Record<string, unknown>
  status: ProposedActionStatus
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
}

export interface PaperSection {
  number: number
  name: string
  purpose: string
  bullets: string[]
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
  // Step 2
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
  // Step 2
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

export type AppAction =
  | { type: 'SET_STEP'; step: number }
  | { type: 'ADVANCE_STEP' }
  | { type: 'BACK_NAV_CONFIRM' }
  | { type: 'BACK_NAV_REQUEST'; step: number }
  | { type: 'BACK_NAV_CANCEL' }
  | { type: 'UPDATE_PROFILE'; field: keyof ResearchProfile; value: string }
  | { type: 'TOGGLE_TOPIC'; topicId: string }
  | { type: 'UPDATE_TOPIC'; topicId: string; field: 'title' | 'description'; value: string }
  | { type: 'ADD_TOPIC'; topic: TopicCard }
  | { type: 'SET_TOPICS'; topics: TopicCard[] }
  | { type: 'SET_SYSTEM_ITEMS'; items: SystemItem[] }
  | { type: 'TOGGLE_SYSTEM_ITEM'; itemId: string }
  | { type: 'ADD_CUSTOM_SYSTEM'; name: string }
  | { type: 'SET_QUERIES'; queries: QueryCard[] }
  | { type: 'ADD_SEARCH_RESULTS'; results: ResultCard[] }
  | { type: 'CLEAR_RESULTS' }
  | { type: 'TOGGLE_REVIEW'; paperId: string }
  | { type: 'ADD_TO_REVIEW'; paperId: string; status: 'included' | 'maybe' }
  | { type: 'REMOVE_FROM_REVIEW'; paperId: string }
  | { type: 'UPDATE_REVIEW_STATUS'; paperId: string; status: ResultCard['status'] }
  | { type: 'SEND_MESSAGE'; content: string }
  | { type: 'ADD_CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'DISMISS_MESSAGE'; messageId: string }
  | { type: 'TOGGLE_HISTORY' }
  | { type: 'TOGGLE_TOPIC_SELECTED'; topicId: string }
  | { type: 'TOGGLE_GAP_SELECTED'; gapId: string }
  | { type: 'SELECT_RQ'; rqId: string }
  | { type: 'SELECT_STUDY_DESIGN'; designId: string }
  | { type: 'UPDATE_GAP_STATEMENT'; text: string }
  | { type: 'UPDATE_THEME_COLUMNS'; themeId: string; columns: string[] }
  | { type: 'UPDATE_RESULT_RELEVANCE'; paperId: string; score: number; confidence: ConfidenceLevel }
  | { type: 'SET_MATRIX_COLUMNS'; columns: string[] }
  | { type: 'INIT_MATRIX_ROWS' }
  | { type: 'SET_SYSTEM_MATRIX_COLUMNS'; columns: string[] }
  | { type: 'INIT_SYSTEM_MATRIX_ROWS' }
  | { type: 'UPDATE_MATRIX_ROW_CELLS'; paperId: string; cells: Record<string, MatrixCell> }
  | { type: 'UPDATE_SYSTEM_MATRIX_ROW_CELLS'; systemId: string; cells: Record<string, MatrixCell> }
  | { type: 'SET_THEMES'; themes: Theme[] }
  | { type: 'ADD_SYNTHESIS_BLOCK'; themeId: string; block: SynthesisBlock }
  | { type: 'UPDATE_SYNTHESIS_BLOCK'; themeId: string; blockId: string; content: string }
  | { type: 'UPDATE_THEME_SYSTEM_COLUMNS'; themeId: string; columns: string[] }
  | { type: 'REMOVE_RESULTS'; paperIds: string[] }
  | { type: 'SET_RQ_OPTIONS'; options: RQOption[] }
  | { type: 'SET_STUDY_DESIGN_OPTIONS'; options: StudyDesignOption[] }
  | { type: 'SET_FINAL_TOPIC_OPTIONS'; options: FinalTopicOption[] }
  | { type: 'SET_TOPIC_FINAL_DATA'; data: TopicFinalData[] }
  | { type: 'SELECT_FINAL_TOPIC'; topicId: string }
  | { type: 'DISMISS_CONSISTENCY_ALERT' }
  | { type: 'DISMISS_BACK_NAV_MODAL' }
  | { type: 'SET_SAVE_STATUS'; status: 'saved' | 'saving' }
  | { type: 'SET_SESSION_TITLE'; title: string }
  | { type: 'NEW_SESSION' }
  | { type: 'LOAD_SESSION'; snapshot: SessionSnapshot }
  | { type: 'UPDATE_ACTION_STATUS'; messageId: string; actionId: string; status: ProposedActionStatus }
