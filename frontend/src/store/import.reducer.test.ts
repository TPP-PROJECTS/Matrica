import { describe, it, expect } from 'vitest'
import { reducer } from './AppContext'
import type { AppState, ImportedSearch, ResultCard } from '../types'

function paper(over: Partial<ResultCard>): ResultCard {
  return {
    id: 'p1', title: 'A study', authors: 'Smith', year: 2020,
    source: '', relevanceScore: 0, abstract: '', topicId: '', queryId: 'q1',
    confidence: 'none', isDuplicate: false, status: null, notes: '',
    ...over,
  }
}

function search(over: Partial<Omit<ImportedSearch, 'recordsAdded'>> = {}): Omit<ImportedSearch, 'recordsAdded'> {
  return {
    id: 'imp1', database: 'Scopus', queryAsRun: 'TITLE-ABS-KEY(sepsis)',
    searchedAt: '2026-03-01', recordsInFile: 2, recordsUnreadable: 0,
    importedAt: '2026-03-02T10:00:00Z', format: 'ris', filename: 'scopus.ris',
    ...over,
  }
}

/** A state carrying only the slices the import action touches. */
function stateWith(results: ResultCard[]): AppState {
  return {
    results,
    importedSearches: [],
    screening: { identifiedByQuery: { q1: 4000 }, retrievedByQuery: { q1: 12 } },
  } as unknown as AppState
}

describe('IMPORT_RECORDS', () => {
  it('adds records that are new to the review', () => {
    const s = reducer(stateWith([]), {
      type: 'IMPORT_RECORDS',
      papers: [paper({ id: 'i1', title: 'One' }), paper({ id: 'i2', title: 'Two' })],
      search: search(),
    })
    expect(s.results.map(r => r.title)).toEqual(['One', 'Two'])
    expect(s.importedSearches).toHaveLength(1)
    expect(s.importedSearches[0].recordsAdded).toBe(2)
  })

  it('de-duplicates against papers the tool already retrieved', () => {
    const held = paper({ id: 'held', title: 'Sepsis prediction', source: 'https://doi.org/10.1/a' })
    const s = reducer(stateWith([held]), {
      type: 'IMPORT_RECORDS',
      papers: [
        paper({ id: 'i1', title: 'Sepsis prediction', source: 'https://doi.org/10.1/a' }),
        paper({ id: 'i2', title: 'Something else' }),
      ],
      search: search(),
    })
    expect(s.results).toHaveLength(2)
    // The file held two records; only one of them was new.
    expect(s.importedSearches[0].recordsInFile).toBe(2)
    expect(s.importedSearches[0].recordsAdded).toBe(1)
  })

  it('fills an abstract a held record was missing from its duplicate', () => {
    const held = paper({ id: 'held', source: 'https://doi.org/10.1/a', abstract: '' })
    const s = reducer(stateWith([held]), {
      type: 'IMPORT_RECORDS',
      papers: [paper({ id: 'i1', source: 'https://doi.org/10.1/a', abstract: 'From Scopus.' })],
      search: search({ recordsInFile: 1 }),
    })
    expect(s.results).toHaveLength(1)
    expect(s.results[0].abstract).toBe('From Scopus.')
  })

  it('leaves the query-derived PRISMA counts untouched', () => {
    // `duplicatesRemoved` is retrieved-minus-held over the *query* corpus.
    // Writing an import into either side of that subtraction would corrupt it.
    const before = stateWith([])
    const s = reducer(before, {
      type: 'IMPORT_RECORDS',
      papers: [paper({ id: 'i1' })],
      search: search({ recordsInFile: 1 }),
    })
    expect(s.screening).toEqual(before.screening)
  })

  it('keeps each import as its own strategy record', () => {
    const first = reducer(stateWith([]), {
      type: 'IMPORT_RECORDS',
      papers: [paper({ id: 'i1', title: 'One' })],
      search: search({ id: 'imp1', database: 'Scopus', recordsInFile: 1 }),
    })
    const second = reducer(first, {
      type: 'IMPORT_RECORDS',
      papers: [paper({ id: 'i2', title: 'Two' })],
      search: search({ id: 'imp2', database: 'Embase', recordsInFile: 1 }),
    })
    expect(second.importedSearches.map(i => i.database)).toEqual(['Scopus', 'Embase'])
  })
})
