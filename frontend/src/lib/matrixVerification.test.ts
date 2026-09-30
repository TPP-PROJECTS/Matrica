import { describe, it, expect } from 'vitest'
import type { MatrixCell } from '../types'
import { describeAiExtraction, exportCellValue, nextUnverified, resetCell, reviewCell, unverifiedFootnote, verificationStats, type VerifiableRow } from './matrixVerification'

function c(value: string, verified = false): MatrixCell {
  return {
    value, aiGenerated: true, confidenceScore: 80, confidenceLevel: 'high',
    evidenceType: 'extracted', sourceRef: '', extractionMethod: 'verbatim', verifiedByStudent: verified,
  }
}

const NOW = '2026-09-28T10:00:00.000Z'

describe('reviewCell', () => {
  it('returns nothing when confirming a cell that does not exist', () => {
    expect(reviewCell(undefined, true, undefined, NOW)).toBeUndefined()
  })

  it('treats an unchanged value as a plain confirmation', () => {
    const out = reviewCell(c('RCT'), true, ' RCT ', NOW)!
    expect(out).toMatchObject({ value: 'RCT', verifiedByStudent: true })
    expect(out.originalValue).toBeUndefined()
  })

  it('withdraws a verification', () => {
    expect(reviewCell(c('RCT', true), false, undefined, NOW)).toMatchObject({ verifiedByStudent: false, verifiedAt: undefined })
  })

  it('records a cleared value as not reported, keeping the AI value', () => {
    expect(reviewCell(c('RCT'), true, '', NOW)).toMatchObject({
      value: '', evidenceType: 'not_available', originalValue: 'RCT', verifiedByStudent: true,
    })
  })

  it('makes a corrected value the reviewer\'s, dropping the AI quote', () => {
    const out = reviewCell({ ...c('150'), sourceRef: '150 enrolled' }, true, '120', NOW)!
    expect(out).toMatchObject({ value: '120', aiGenerated: false, sourceRef: '', originalValue: '150' })
  })

  it('keeps the first AI value across repeated edits', () => {
    const once = reviewCell(c('RCT'), true, 'Cluster RCT', NOW)!
    const twice = reviewCell(once, true, 'Stepped-wedge cluster RCT', NOW)!
    expect(twice.originalValue).toBe('RCT')
  })
})

describe('reviewCell: saving versus confirming an edit', () => {
  it('saves an edit without confirming it when not asked to', () => {
    const out = reviewCell(c('RCT', true), false, 'Cluster RCT', NOW)!
    expect(out).toMatchObject({ value: 'Cluster RCT', verifiedByStudent: false, verifiedAt: undefined, originalValue: 'RCT' })
  })

  it('keeps the explanation with the edit, and drops an empty one', () => {
    const why = { reason: 'partial_disagreement' as const, reference: 'Table 2' }
    expect(reviewCell(c('RCT'), true, 'Cluster RCT', NOW, why)!.editExplanation).toEqual(why)
    expect(reviewCell(c('RCT'), true, 'Cluster RCT', NOW, { reference: '  ' })!.editExplanation).toBeUndefined()
  })

  it('does not carry the explanation into the AI snapshot, so a reset clears it', () => {
    const edited = reviewCell(c('RCT'), true, 'Cluster RCT', NOW, { reason: 'minor_revision' })!
    expect(resetCell(edited)!.editExplanation).toBeUndefined()
  })
})

describe('resetCell', () => {
  it('has nothing to reset on a cell the reviewer never edited', () => {
    expect(resetCell(c('RCT', true))).toBeUndefined()
    expect(resetCell(undefined)).toBeUndefined()
  })

  it('restores the whole AI extraction, quote included, unverified', () => {
    const ai = { ...c('150'), sourceRef: '150 enrolled', confidenceScore: 72 }
    const twice = reviewCell(reviewCell(ai, true, '120', NOW)!, true, '', NOW)!
    expect(resetCell(twice)).toEqual({ ...ai, verifiedByStudent: false, verifiedAt: undefined })
  })

  it('falls back to the AI value for cells edited before snapshots were kept', () => {
    const legacy: MatrixCell = { ...c('120'), aiGenerated: false, verifiedByStudent: true, originalValue: '150' }
    expect(resetCell(legacy)).toMatchObject({ value: '150', aiGenerated: true, verifiedByStudent: false, originalValue: undefined })
  })
})

describe('nextUnverified', () => {
  const rows: VerifiableRow[] = [
    { id: 'a', cells: { X: c('1', true), Y: c('2') } },
    { id: 'b', cells: { X: c('3'), Y: c('4', true) } },
  ]
  const cols = ['X', 'Y']

  it('starts at the first unverified cell in reading order', () => {
    expect(nextUnverified(rows, cols, null)).toEqual({ rowId: 'a', column: 'Y' })
  })

  it('moves forward and wraps round', () => {
    expect(nextUnverified(rows, cols, { rowId: 'a', column: 'Y' })).toEqual({ rowId: 'b', column: 'X' })
    expect(nextUnverified(rows, cols, { rowId: 'b', column: 'X' })).toEqual({ rowId: 'a', column: 'Y' })
  })

  it('is null when everything is verified', () => {
    expect(nextUnverified([{ id: 'a', cells: { X: c('1', true) } }], ['X'], null)).toBeNull()
  })
})

describe('export helpers', () => {
  it('marks unverified values and explains the mark', () => {
    const rows: VerifiableRow[] = [{ id: 'a', cells: { X: c('1', true), Y: c('2') } }]
    expect(verificationStats(rows, ['X', 'Y'])).toEqual({ total: 2, verified: 1 })
    expect(exportCellValue(rows[0].cells.X)).toBe('1')
    expect(exportCellValue(rows[0].cells.Y)).toBe('2 †')
    expect(exportCellValue(undefined)).toBe('—')
    expect(unverifiedFootnote(rows, ['X', 'Y'])).toContain('1 of 2 cells')
    expect(unverifiedFootnote(rows, ['X'])).toBeNull()
  })
})

describe('describeAiExtraction', () => {
  it('describes what the AI extracted, even after the user edited it', () => {
    const ai = { ...c('150'), sourceRef: '150 enrolled', confidenceScore: 72, confidenceLevel: 'medium' as const }
    const edited = reviewCell(ai, true, '120', NOW)!
    expect(describeAiExtraction(edited)).toBe(
      'AI extraction: 150\nConfidence: 72% (medium) · quoted verbatim\nSupporting quote: "150 enrolled"',
    )
  })

  it('says when there was no AI extraction', () => {
    expect(describeAiExtraction(reviewCell(undefined, true, 'Filled', NOW))).toMatch(/no AI extraction/)
  })
})
