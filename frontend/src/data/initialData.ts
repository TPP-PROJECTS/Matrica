import type { ChatMessage } from '../types'

/**
 * Structural fields are UI schema, not research records. Every substantive
 * research output starts empty and is populated from user input, source
 * databases, or a clearly labelled AI operation.
 */
export const BASE_MATRIX_COLUMNS = ['#', 'Title', 'Authors', 'Year']

export const WELCOME_MESSAGES: ChatMessage[] = [
  {
    id: 'welcome',
    type: 'assistant',
    content: "Hi there! I'm your Research Assistant. I'll help you develop a well-defined research topic through conversation. To get started, could you tell me about the broad area you're interested in exploring?",
    timestamp: '',
  },
]
