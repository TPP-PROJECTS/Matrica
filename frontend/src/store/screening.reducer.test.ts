import { describe, it, expect } from 'vitest'
import { reducer } from './AppContext'
import type { AppState, AppAction, ResultCard } from '../types'

function paper(over: Partial<ResultCard>): ResultCard {
  return {
    id: 'p1', title: 'A study', authors: 'Smith', year: 2020,
    source: '', relevanceScore: 0, abstract: '', topicId: 't1', queryId: 'q1',
    confidence: 'none', isDuplicate: false, status: null, notes: '',
    ...over,
  }
}

/** A minimal state carrying just the slices the screening actions touch. */
function stateWith(results: ResultCard[], reviewList: ResultCard[] = []): AppState {
  return { results, reviewList, criteria: [] } as unknown as AppState
}

function run(state: AppState, ...actions: AppAction[]): AppState {
  return actions.reduce(reducer, state)
}

describe('screening decisions', () => {
  it('appends audit entries without replacing earlier research decisions', () => {
    const base = { ...stateWith([]), decisionJournal: [] }
    const entry = {
      id: 'j1',
      kind: 'justification' as const,
      step: 4,
      action: 'Edited search query',
      entityType: 'query' as const,
      entityId: 'q1',
      entityLabel: 'Query 1',
      justification: 'Improve specificity',
      createdAt: '2026-01-01T00:00:00Z',
    }
    const s = reducer(base, { type: 'ADD_DECISION_JOURNAL_ENTRY', entry })
    expect(s.decisionJournal).toEqual([entry])
  })

  it('AI include adds the paper with provenance and reason', () => {
    const s = run(
      stateWith([paper({ id: 'a' })]),
      { type: 'ADD_TO_REVIEW', paperId: 'a', status: 'included', reason: 'meets PICO', by: 'ai' },
    )
    const r = s.results.find(p => p.id === 'a')!
    expect(r.status).toBe('included')
    expect(r.screenedBy).toBe('ai')
    expect(r.screeningReason).toBe('meets PICO')
    expect(s.reviewList.map(p => p.id)).toEqual(['a'])
  })

  it('AI exclude records the matched criterion and drops it from the review list', () => {
    const s = run(
      stateWith([paper({ id: 'a', status: 'included' })], [paper({ id: 'a', status: 'included' })]),
      { type: 'EXCLUDE_PAPER', paperId: 'a', reasonId: 'ex-animal', reason: 'mouse study', by: 'ai' },
    )
    const r = s.results.find(p => p.id === 'a')!
    expect(r.status).toBe('excluded')
    expect(r.exclusionReasonId).toBe('ex-animal')
    expect(r.screenedBy).toBe('ai')
    expect(s.reviewList).toEqual([])
  })

  it('lets a human add an excluded paper back to the review list', () => {
    const s = run(
      stateWith([paper({ id: 'a' })]),
      { type: 'EXCLUDE_PAPER', paperId: 'a', reasonId: null, reason: 'manual check', by: 'human' },
      { type: 'ADD_TO_REVIEW', paperId: 'a', status: 'included', reason: 'full text is eligible', by: 'human' },
    )
    expect(s.results[0].status).toBe('included')
    expect(s.results[0].exclusionReasonId).toBeNull()
    expect(s.reviewList.map(item => item.id)).toEqual(['a'])
  })

  it('an uncertain paper enters the review list as pending for a human decision', () => {
    const s = run(
      stateWith([paper({ id: 'a' })]),
      { type: 'MARK_SCREEN_UNCERTAIN', paperId: 'a', reason: 'no abstract', by: 'ai' },
    )
    const r = s.results.find(p => p.id === 'a')!
    expect(r.status).toBe('maybe')
    expect(r.screenUncertain).toBe(true)
    expect(r.screeningReason).toBe('no abstract')
    expect(s.reviewList.map(p => p.id)).toEqual(['a'])
    expect(s.reviewList[0].status).toBe('maybe')
  })

  it('a human include overwrites a prior AI-uncertain and clears the flag', () => {
    const s = run(
      stateWith([paper({ id: 'a' })]),
      { type: 'MARK_SCREEN_UNCERTAIN', paperId: 'a', reason: 'no abstract', by: 'ai' },
      { type: 'ADD_TO_REVIEW', paperId: 'a', status: 'included', reason: 'read full text', by: 'human' },
    )
    const r = s.results.find(p => p.id === 'a')!
    expect(r.status).toBe('included')
    expect(r.screenedBy).toBe('human')
    expect(r.screenUncertain).toBe(false)
    expect(r.screeningReason).toBe('read full text')
  })

  it('writes a screening-resolved abstract to both the result and review copy', () => {
    const original = paper({ id: 'a', status: 'included', abstract: '' })
    const s = run(
      stateWith([original], [original]),
      { type: 'UPDATE_PAPER_ABSTRACT', paperId: 'a', abstract: 'Verified source abstract.' },
    )
    expect(s.results[0].abstract).toBe('Verified source abstract.')
    expect(s.reviewList[0].abstract).toBe('Verified source abstract.')
  })

  describe('RESET_AI_SCREENING', () => {
    it('clears every AI decision but leaves human decisions untouched', () => {
      const start = run(
        stateWith([
          paper({ id: 'ai-inc' }),
          paper({ id: 'ai-exc' }),
          paper({ id: 'ai-unsure' }),
          paper({ id: 'human-inc' }),
        ]),
        { type: 'ADD_TO_REVIEW', paperId: 'ai-inc', status: 'included', reason: 'x', by: 'ai' },
        { type: 'EXCLUDE_PAPER', paperId: 'ai-exc', reasonId: 'ex-1', reason: 'x', by: 'ai' },
        { type: 'MARK_SCREEN_UNCERTAIN', paperId: 'ai-unsure', reason: 'x', by: 'ai' },
        { type: 'ADD_TO_REVIEW', paperId: 'human-inc', status: 'included', reason: 'mine', by: 'human' },
      )

      const s = reducer(start, { type: 'RESET_AI_SCREENING' })
      const by = (id: string) => s.results.find(p => p.id === id)!

      // AI decisions wiped back to unscreened.
      expect(by('ai-inc').status).toBeNull()
      expect(by('ai-exc').status).toBeNull()
      expect(by('ai-exc').exclusionReasonId).toBeNull()
      expect(by('ai-unsure').screenUncertain).toBe(false)

      // The human decision is the only survivor.
      expect(by('human-inc').status).toBe('included')
      expect(by('human-inc').screenedBy).toBe('human')
      expect(s.reviewList.map(p => p.id)).toEqual(['human-inc'])
    })

    it('is a no-op when the AI never screened anything', () => {
      const start = stateWith([paper({ id: 'a', status: 'included', screenedBy: 'human' })],
                              [paper({ id: 'a', status: 'included', screenedBy: 'human' })])
      const s = reducer(start, { type: 'RESET_AI_SCREENING' })
      expect(s.results[0].status).toBe('included')
      expect(s.reviewList).toHaveLength(1)
    })
  })
})
