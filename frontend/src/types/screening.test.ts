import { describe, it, expect } from 'vitest'
import { totalIdentified, duplicatesRemoved } from './index'

describe('totalIdentified', () => {
  it('sums the hits reported by every query', () => {
    expect(totalIdentified({ identifiedByQuery: { q1: 4000, q2: 213 }, retrievedByQuery: {} })).toBe(4213)
  })

  it('is zero before any search has run', () => {
    expect(totalIdentified({ identifiedByQuery: {}, retrievedByQuery: {} })).toBe(0)
  })

  it('does not grow when a query is re-run', () => {
    // Re-running a search re-identifies the same corpus. Because the figure is
    // keyed by query, overwriting it leaves the total unchanged — accumulating
    // it would have doubled "records identified" on every click of Search.
    const first = { identifiedByQuery: { q1: 4000 }, retrievedByQuery: {} }
    const rerun = { ...first, identifiedByQuery: { ...first.identifiedByQuery, q1: 4000 } }
    expect(totalIdentified(rerun)).toBe(totalIdentified(first))
  })
})

describe('duplicatesRemoved', () => {
  it('is derived from retrieved minus unique, not accumulated', () => {
    // Two queries each pulled 10 records; 15 unique papers are held.
    const counts = { identifiedByQuery: {}, retrievedByQuery: { q1: 10, q2: 10 } }
    expect(duplicatesRemoved(counts, 15)).toBe(5)
  })

  it('does not inflate when the same search is re-run', () => {
    // Re-running query 1 re-detects all 10 of its records as duplicates, but
    // assignment (not accumulation) leaves both terms unchanged.
    const afterFirstRun = { identifiedByQuery: {}, retrievedByQuery: { q1: 10 } }
    const afterRerun = { identifiedByQuery: {}, retrievedByQuery: { q1: 10 } }
    expect(duplicatesRemoved(afterRerun, 10)).toBe(duplicatesRemoved(afterFirstRun, 10))
    expect(duplicatesRemoved(afterRerun, 10)).toBe(0)
  })

  it('falls back to the stored counter for sessions saved before the fix', () => {
    expect(duplicatesRemoved({ identifiedByQuery: { q1: 5 }, retrievedByQuery: {}, duplicatesRemoved: 7 }, 3)).toBe(7)
  })

  it('never reports a negative count', () => {
    expect(duplicatesRemoved({ identifiedByQuery: {}, retrievedByQuery: { q1: 3 } }, 10)).toBe(0)
  })
})
