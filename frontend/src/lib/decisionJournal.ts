import type { DecisionJournalEntry } from '../types'
import { newId } from './ids'

export function journalEntry(
  entry: Omit<DecisionJournalEntry, 'id' | 'createdAt'>,
): DecisionJournalEntry {
  return {
    ...entry,
    id: newId('journal'),
    createdAt: new Date().toISOString(),
  }
}
