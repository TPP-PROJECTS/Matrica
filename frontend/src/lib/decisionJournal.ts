import type { DecisionJournalEntry } from '../types'

export function journalEntry(
  entry: Omit<DecisionJournalEntry, 'id' | 'createdAt'>,
): DecisionJournalEntry {
  return {
    ...entry,
    id: `journal-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
  }
}
