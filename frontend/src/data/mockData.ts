import type {
  TopicCard, MatrixRow, SystemMatrixRow, Theme,
  GapDimension, RQOption, StudyDesignOption, PaperSection,
  TopicFinalData, ChatMessage, VersionEntry
} from '../types'

export const MOCK_TOPICS: TopicCard[] = []

export const MOCK_MATRIX_COLUMNS: string[] = [
  '#', 'Title', 'Authors', 'Year', 'Aim / RQ', 'Population', 'Method', 'Key Findings', 'Limitations', 'Relevance',
]

export const MOCK_MATRIX_ROWS: MatrixRow[] = []

export const MOCK_SYSTEM_MATRIX_COLUMNS: string[] = []

export const MOCK_SYSTEM_MATRIX_ROWS: SystemMatrixRow[] = []

export const MOCK_THEMES: Theme[] = []

export const MOCK_GAPS: GapDimension[] = []

export const MOCK_GAP_STATEMENT = ''

export const MOCK_RQ_OPTIONS: RQOption[] = []

export const MOCK_STUDY_DESIGNS: StudyDesignOption[] = [
  { id: 'sd1', name: 'Systematic Review',  recommended: true,  hint: 'Best for synthesising existing evidence across multiple studies' },
  { id: 'sd2', name: 'Scoping Review',     recommended: false, hint: 'Best for mapping the breadth of a field' },
  { id: 'sd3', name: 'Meta-Analysis',      recommended: false, hint: 'Best for pooling quantitative effect sizes' },
  { id: 'sd4', name: 'RCT',               recommended: false, hint: 'Best for causal efficacy questions' },
  { id: 'sd5', name: 'Cohort Study',      recommended: false, hint: 'Best for longitudinal outcomes' },
  { id: 'sd6', name: 'Qualitative',       recommended: false, hint: 'Best for experience, meaning, and process' },
  { id: 'sd7', name: 'Mixed Methods',     recommended: false, hint: 'Best for complex phenomena requiring both approaches' },
]

export const MOCK_PAPER_SECTIONS: PaperSection[] = []

export const MOCK_TOPIC_FINAL_DATA: TopicFinalData[] = []

export const INITIAL_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'cm1',
    type: 'assistant',
    content: "Hi there! I'm your Research Assistant. I'll help you develop a well-defined research topic through conversation. To get started, could you tell me about the broad area you're interested in exploring?",
    timestamp: '09:00',
  },
]

export const MOCK_VERSION_HISTORY: VersionEntry[] = []
