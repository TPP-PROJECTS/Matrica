import { describe, it, expect } from 'vitest'
import { resolveAction } from './actionRegistry'
import type { AppState, ProposedAction } from '../types'

function state(over: Partial<AppState> = {}): AppState {
  return {
    topics: [{ id: 't1' }], systemItems: [], results: [{ id: 'p1' }], reviewList: [],
    gaps: [], rqOptions: [], finalTopicOptions: [], studyDesignOptions: [],
    themes: [], matrixRows: [], systemMatrixRows: [],
    ...over,
  } as unknown as AppState
}

function proposed(type: string, payload: Record<string, unknown>): ProposedAction {
  return { id: 'a1', type, label: '', payload, status: 'pending' }
}

describe('resolveAction payload validation', () => {
  it('accepts a well-formed action', () => {
    const r = resolveAction(proposed('SET_STEP', { step: 3 }), state())
    expect(r.error).toBeUndefined()
    expect(r.actions).toEqual([{ type: 'SET_STEP', step: 3 }])
  })

  it('rejects a number field sent as a string', () => {
    // Reaching the reducer, this would make every step comparison fail and the
    // whole workflow nav render as locked.
    const r = resolveAction(proposed('SET_STEP', { step: '3' }), state())
    expect(r.actions).toEqual([])
    expect(r.error).toMatch(/must be a number/)
  })

  it('rejects a string sent where an array is required', () => {
    // This is the crash case: the reducer stores it and the next .map() throws.
    const r = resolveAction(
      proposed('SET_MATRIX_COLUMNS', { columns: 'Method, Outcome' }),
      state(),
    )
    expect(r.actions).toEqual([])
    expect(r.error).toMatch(/must be an array/)
  })

  it('rejects a value outside a literal union', () => {
    const r = resolveAction(
      proposed('ADD_TO_REVIEW', { paperId: 'p1', status: 'definitely' }),
      state(),
    )
    expect(r.actions).toEqual([])
    expect(r.error).toMatch(/must be one of/)
  })

  it('accepts a valid member of a literal union', () => {
    const r = resolveAction(
      proposed('ADD_TO_REVIEW', { paperId: 'p1', status: 'included' }),
      state(),
    )
    expect(r.error).toBeUndefined()
  })

  it('still rejects an id that does not exist', () => {
    const r = resolveAction(proposed('TOGGLE_TOPIC', { topicId: 'nope' }), state())
    expect(r.actions).toEqual([])
    expect(r.error).toMatch(/no longer exists/)
  })

  it('drops payload keys the catalog does not declare', () => {
    const r = resolveAction(
      proposed('SET_STEP', { step: 2, sneaky: 'value' }),
      state(),
    )
    expect(r.actions).toEqual([{ type: 'SET_STEP', step: 2 }])
  })

  it('rejects an unknown action type', () => {
    const r = resolveAction(proposed('DROP_DATABASE', {}), state())
    expect(r.actions).toEqual([])
    expect(r.error).toMatch(/Unsupported action/)
  })

  it('still reports a missing required field', () => {
    const r = resolveAction(proposed('SET_STEP', {}), state())
    expect(r.actions).toEqual([])
    expect(r.error).toMatch(/Missing "step"/)
  })
})
