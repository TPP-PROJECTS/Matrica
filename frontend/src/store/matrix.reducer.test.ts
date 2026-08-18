import { describe, it, expect } from 'vitest'
import { reducer } from './AppContext'
import type { AppState, MatrixCell, MatrixRow, ResultCard, SystemItem, SystemMatrixRow, Theme } from '../types'

function cell(value: string): MatrixCell {
  return {
    value,
    aiGenerated: true,
    confidenceScore: 90,
    confidenceLevel: 'high',
    evidenceType: 'extracted',
    sourceRef: 'abstract',
    extractionMethod: 'verbatim',
    verifiedByStudent: true,
  }
}

function paper(id: string): ResultCard {
  return {
    id, title: `Study ${id}`, authors: 'Smith', year: 2020,
    source: '', relevanceScore: 0, abstract: '', topicId: 't1', queryId: 'q1',
    confidence: 'none', isDuplicate: false, status: 'included', notes: '',
  }
}

function row(paperId: string, cells: Record<string, MatrixCell> = {}): MatrixRow {
  return { paperId, title: `Study ${paperId}`, authors: 'Smith', year: 2020, cells }
}

function stateWith(over: Partial<AppState>): AppState {
  return {
    reviewList: [], matrixRows: [], matrixColumns: [], columnDescriptions: {},
    systemItems: [], systemMatrixRows: [], systemMatrixColumns: [], systemColumnDescriptions: {},
    themes: [], results: [],
    ...over,
  } as unknown as AppState
}

describe('SYNC_MATRIX_ROWS', () => {
  it('keeps filled cells when an unrelated paper is removed from the review list', () => {
    const s = reducer(
      stateWith({
        reviewList: [paper('a'), paper('c')],
        matrixRows: [row('a', { Method: cell('RCT') }), row('b'), row('c', { Method: cell('cohort') })],
      }),
      { type: 'SYNC_MATRIX_ROWS' },
    )
    expect(s.matrixRows.map(r => r.paperId)).toEqual(['a', 'c'])
    expect(s.matrixRows[0].cells.Method.value).toBe('RCT')
    expect(s.matrixRows[1].cells.Method.value).toBe('cohort')
  })

  it('adds an empty row for a paper newly added to the review list', () => {
    const s = reducer(
      stateWith({
        reviewList: [paper('a'), paper('b')],
        matrixRows: [row('a', { Method: cell('RCT') })],
      }),
      { type: 'SYNC_MATRIX_ROWS' },
    )
    expect(s.matrixRows.map(r => r.paperId)).toEqual(['a', 'b'])
    expect(s.matrixRows[0].cells.Method.value).toBe('RCT')
    expect(s.matrixRows[1].cells).toEqual({})
  })

  it('is a no-op when rows already match, so it can run from an effect', () => {
    const before = stateWith({ reviewList: [paper('a')], matrixRows: [row('a', { M: cell('x') })] })
    expect(reducer(before, { type: 'SYNC_MATRIX_ROWS' })).toBe(before)
  })
})

describe('SYNC_SYSTEM_MATRIX_ROWS', () => {
  const sys = (id: string, selected: boolean): SystemItem => ({
    id, name: `Sys ${id}`, description: '', category: 'other', url: null,
    vendor: 'v', aiGenerated: true, selected,
  })
  const sysRow = (systemId: string, cells: Record<string, MatrixCell> = {}): SystemMatrixRow => ({
    systemId, name: `Sys ${systemId}`, vendor: 'v', category: 'other', url: null, cells,
  })

  it('preserves cells of still-selected systems when one is deselected', () => {
    const s = reducer(
      stateWith({
        systemItems: [sys('a', true), sys('b', false)],
        systemMatrixRows: [sysRow('a', { Coverage: cell('full') }), sysRow('b', { Coverage: cell('partial') })],
      }),
      { type: 'SYNC_SYSTEM_MATRIX_ROWS' },
    )
    expect(s.systemMatrixRows.map(r => r.systemId)).toEqual(['a'])
    expect(s.systemMatrixRows[0].cells.Coverage.value).toBe('full')
  })
})

describe('matrix column rename and removal cascade', () => {
  const themed = (sourceColumns: string[]): Theme => ({
    id: 'th1', name: 'Theme', paperCount: 1, totalPapers: 1, coverageLabel: 'Sparse',
    profileMatch: null, blocks: [], sourceColumns, systemSourceColumns: [],
  })

  it('carries the description and theme reference across a rename', () => {
    const s = reducer(
      stateWith({
        matrixColumns: ['Method'],
        matrixRows: [row('a', { Method: cell('RCT') })],
        columnDescriptions: { Method: 'How the study was run' },
        themes: [themed(['Method'])],
      }),
      { type: 'RENAME_MATRIX_COLUMN', oldName: 'Method', newName: 'Design' },
    )
    expect(s.matrixColumns).toEqual(['Design'])
    expect(s.matrixRows[0].cells.Design.value).toBe('RCT')
    expect(s.columnDescriptions).toEqual({ Design: 'How the study was run' })
    expect(s.themes[0].sourceColumns).toEqual(['Design'])
  })

  it('drops the description and theme reference when a column is removed', () => {
    const s = reducer(
      stateWith({
        matrixColumns: ['Method', 'Outcome'],
        matrixRows: [row('a', { Method: cell('RCT'), Outcome: cell('mortality') })],
        columnDescriptions: { Method: 'How', Outcome: 'What' },
        themes: [themed(['Method', 'Outcome'])],
      }),
      { type: 'REMOVE_MATRIX_COLUMN', column: 'Method' },
    )
    expect(s.matrixColumns).toEqual(['Outcome'])
    expect(s.matrixRows[0].cells).not.toHaveProperty('Method')
    expect(s.columnDescriptions).toEqual({ Outcome: 'What' })
    expect(s.themes[0].sourceColumns).toEqual(['Outcome'])
  })
})

describe('REMOVE_RESULTS', () => {
  it('removes the paper from the review list and matrix as well as the results', () => {
    const s = reducer(
      stateWith({
        results: [paper('a'), paper('b')],
        reviewList: [paper('a'), paper('b')],
        matrixRows: [row('a'), row('b')],
      }),
      { type: 'REMOVE_RESULTS', paperIds: ['a'] },
    )
    expect(s.results.map(r => r.id)).toEqual(['b'])
    expect(s.reviewList.map(r => r.id)).toEqual(['b'])
    expect(s.matrixRows.map(r => r.paperId)).toEqual(['b'])
  })
})

describe('review status stays consistent across results and reviewList', () => {
  it('UPDATE_REVIEW_STATUS writes through to the underlying result', () => {
    const s = reducer(
      stateWith({ results: [paper('a')], reviewList: [paper('a')] }),
      { type: 'UPDATE_REVIEW_STATUS', paperId: 'a', status: 'saved' },
    )
    expect(s.reviewList[0].status).toBe('saved')
    expect(s.results[0].status).toBe('saved')
  })

  it('TOGGLE_REVIEW clears the result status when the paper leaves the list', () => {
    const withPaper = stateWith({ results: [paper('a')], reviewList: [paper('a')] })
    const s = reducer(withPaper, { type: 'TOGGLE_REVIEW', paperId: 'a' })
    expect(s.reviewList).toHaveLength(0)
    expect(s.results[0].status).toBeNull()
  })
})
