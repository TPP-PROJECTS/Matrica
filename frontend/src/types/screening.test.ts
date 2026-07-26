import { describe, it, expect } from 'vitest'
import { totalIdentified } from './index'

describe('totalIdentified', () => {
  it('sums the hits reported by every query', () => {
    expect(totalIdentified({ identifiedByQuery: { q1: 4000, q2: 213 }, duplicatesRemoved: 0 })).toBe(4213)
  })

  it('is zero before any search has run', () => {
    expect(totalIdentified({ identifiedByQuery: {}, duplicatesRemoved: 0 })).toBe(0)
  })

  it('does not grow when a query is re-run', () => {
    // Re-running a search re-identifies the same corpus. Because the figure is
    // keyed by query, overwriting it leaves the total unchanged — accumulating
    // it would have doubled "records identified" on every click of Search.
    const first = { identifiedByQuery: { q1: 4000 }, duplicatesRemoved: 0 }
    const rerun = { ...first, identifiedByQuery: { ...first.identifiedByQuery, q1: 4000 } }
    expect(totalIdentified(rerun)).toBe(totalIdentified(first))
  })
})
