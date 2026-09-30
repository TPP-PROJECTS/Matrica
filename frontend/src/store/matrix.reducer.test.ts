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

describe('risk-of-bias appraisal', () => {
  const assessment = (over: Partial<import('../types').RobAssessment> = {}) => ({
    paperId: 'a',
    toolId: 'rob2' as const,
    domains: {
      randomisation: { judgement: 'low', rationale: 'r', supportQuote: 'q', aiGenerated: true, verifiedByStudent: false },
    },
    overall: 'low',
    overallRationale: '',
    assessedAt: '2026-01-01T00:00:00Z',
    ...over,
  })

  it('discards assessments when the instrument changes', () => {
    // RoB 2 domains and judgements have no ROBINS-I equivalent, so carrying
    // them across would misreport which appraisal was actually performed.
    const s = reducer(
      stateWith({ robToolId: 'rob2', robAssessments: [assessment()] }),
      { type: 'SET_ROB_TOOL', toolId: 'robins_i' },
    )
    expect(s.robToolId).toBe('robins_i')
    expect(s.robAssessments).toEqual([])
  })

  it('keeps assessments when the same instrument is re-selected', () => {
    const before = stateWith({ robToolId: 'rob2', robAssessments: [assessment()] })
    expect(reducer(before, { type: 'SET_ROB_TOOL', toolId: 'rob2' })).toBe(before)
  })

  it('replaces a paper’s assessment rather than accumulating duplicates', () => {
    const s = reducer(
      stateWith({ robAssessments: [assessment({ overall: 'low' })] }),
      { type: 'SET_ROB_ASSESSMENT', assessment: assessment({ overall: 'high' }) },
    )
    expect(s.robAssessments).toHaveLength(1)
    expect(s.robAssessments[0].overall).toBe('high')
  })

  it('marks a domain confirmed when the reviewer changes its judgement', () => {
    const s = reducer(
      stateWith({ robAssessments: [assessment()] }),
      { type: 'UPDATE_ROB_DOMAIN', paperId: 'a', domainId: 'randomisation', judgement: 'high' },
    )
    const domain = s.robAssessments[0].domains.randomisation
    expect(domain.judgement).toBe('high')
    expect(domain.verifiedByStudent).toBe(true)
  })

  it('leaves the rationale alone when only the judgement is set', () => {
    const s = reducer(
      stateWith({ robAssessments: [assessment()] }),
      { type: 'UPDATE_ROB_DOMAIN', paperId: 'a', domainId: 'randomisation', judgement: 'high' },
    )
    expect(s.robAssessments[0].domains.randomisation.rationale).toBe('r')
  })

  it('ignores an update for a domain the assessment does not have', () => {
    const before = stateWith({ robAssessments: [assessment()] })
    const s = reducer(before, { type: 'UPDATE_ROB_DOMAIN', paperId: 'a', domainId: 'nope', judgement: 'high' })
    expect(s.robAssessments[0].domains).toEqual(before.robAssessments[0].domains)
  })
})

describe('appraisals do not outlive their papers', () => {
  const assessment = (paperId: string) => ({
    paperId, toolId: 'rob2' as const,
    domains: { randomisation: { judgement: 'low', rationale: '', supportQuote: '', aiGenerated: true, verifiedByStudent: false } },
    overall: 'low', overallRationale: '', assessedAt: '2026-01-01T00:00:00Z',
  })

  it('drops the appraisal when the paper leaves the review list', () => {
    // Otherwise the panel reads "2 of 1 appraised" and the orphan is carried
    // into the synthesis payload.
    const s = reducer(
      stateWith({
        results: [paper('a'), paper('b')],
        reviewList: [paper('a'), paper('b')],
        robAssessments: [assessment('a'), assessment('b')],
      }),
      { type: 'REMOVE_FROM_REVIEW', paperId: 'b' },
    )
    expect(s.robAssessments.map(a => a.paperId)).toEqual(['a'])
  })

  it('drops the appraisal when the paper is excluded', () => {
    const s = reducer(
      stateWith({
        results: [paper('a')], reviewList: [paper('a')], criteria: [],
        robAssessments: [assessment('a')],
      }),
      { type: 'EXCLUDE_PAPER', paperId: 'a', reasonId: 'ex-design' },
    )
    expect(s.robAssessments).toEqual([])
  })

  it('drops the appraisal when the search result is deleted', () => {
    const s = reducer(
      stateWith({
        results: [paper('a')], reviewList: [paper('a')], robAssessments: [assessment('a')],
      }),
      { type: 'REMOVE_RESULTS', paperIds: ['a'] },
    )
    expect(s.robAssessments).toEqual([])
  })

  it('keeps appraisals of papers that stay in the review list', () => {
    const s = reducer(
      stateWith({
        results: [paper('a'), paper('b')],
        reviewList: [paper('a'), paper('b')],
        robAssessments: [assessment('a'), assessment('b')],
      }),
      { type: 'REMOVE_FROM_REVIEW', paperId: 'zzz' },
    )
    expect(s.robAssessments).toHaveLength(2)
  })
})

// ── Reviewer verification ─────────────────────────────────────────────────────

function aiCell(value: string, verified = false): MatrixCell {
  return { ...cell(value), verifiedByStudent: verified }
}

describe('matrix cell verification', () => {
  it('verifies a cell and stamps when', () => {
    const s = reducer(
      stateWith({ matrixRows: [row('a', { Method: aiCell('RCT') })] }),
      { type: 'REVIEW_MATRIX_CELL', matrix: 'literature', rowId: 'a', column: 'Method', verified: true },
    )
    const c = s.matrixRows[0].cells.Method
    expect(c.verifiedByStudent).toBe(true)
    expect(c.verifiedAt).toBeTruthy()
    expect(c.value).toBe('RCT')
  })

  it('keeps the AI value when the reviewer corrects it', () => {
    const s = reducer(
      stateWith({ matrixRows: [row('a', { Method: aiCell('RCT') })] }),
      { type: 'REVIEW_MATRIX_CELL', matrix: 'literature', rowId: 'a', column: 'Method', verified: true, value: 'Cluster RCT' },
    )
    expect(s.matrixRows[0].cells.Method).toMatchObject({ value: 'Cluster RCT', originalValue: 'RCT', verifiedByStudent: true })
  })

  it('lets the reviewer fill a cell the extractor left empty', () => {
    const s = reducer(
      stateWith({ systemMatrixRows: [{ systemId: 's1', name: 'Sys', vendor: '', category: '', url: null, cells: {} } as unknown as SystemMatrixRow] }),
      { type: 'REVIEW_MATRIX_CELL', matrix: 'system', rowId: 's1', column: 'Pricing', verified: true, value: 'Free tier' },
    )
    expect(s.systemMatrixRows[0].cells.Pricing).toMatchObject({ value: 'Free tier', aiGenerated: false, verifiedByStudent: true })
  })

  it('does not let a re-run of auto-fill overwrite a verified cell', () => {
    const s = reducer(
      stateWith({ matrixRows: [row('a', { Method: aiCell('Cluster RCT', true), Sample: aiCell('40') })] }),
      { type: 'UPDATE_MATRIX_ROW_CELLS', paperId: 'a', cells: { Method: aiCell('RCT'), Sample: aiCell('42') } },
    )
    expect(s.matrixRows[0].cells.Method.value).toBe('Cluster RCT')
    expect(s.matrixRows[0].cells.Sample.value).toBe('42')
  })

  it('verifies only the listed rows of a column', () => {
    const s = reducer(
      stateWith({ matrixRows: [row('a', { Method: aiCell('RCT') }), row('b', { Method: aiCell('?') })] }),
      { type: 'VERIFY_MATRIX_CELLS', matrix: 'literature', column: 'Method', rowIds: ['a'] },
    )
    expect(s.matrixRows.map(r => r.cells.Method.verifiedByStudent)).toEqual([true, false])
  })
})
