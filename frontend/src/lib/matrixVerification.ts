import type { CellEditExplanation, CellEditReason, MatrixCell } from '../types'
import { checkProvenance, type SourceCandidate } from './provenance'

// ── Reviewer verification of matrix cells ─────────────────────────────────────
// Every AI-extracted cell starts unverified. The reviewer confirms it, corrects
// it, or fills in what the extractor missed; a confirmed cell is then theirs,
// and a later auto-fill does not write over it.

/** A row of either matrix, reduced to what verification needs. */
export interface VerifiableRow {
  id: string
  cells: Record<string, MatrixCell>
}

/**
 * Apply one reviewer decision to a cell. Returns the new cell, or undefined
 * when there is nothing to record (confirming a cell that does not exist).
 *
 * - `value` given and different from the current value: an edit. The cell
 *   becomes the reviewer's (no longer AI-generated, no AI quote), verified
 *   only if asked — saving a correction and confirming it are separate — and
 *   carries the reviewer's explanation, if given. The AI's value is kept in
 *   `originalValue` the first time it is replaced.
 * - otherwise: sets the verified flag as asked.
 */
export function reviewCell(
  existing: MatrixCell | undefined,
  verified: boolean,
  value: string | undefined,
  now: string,
  explanation?: CellEditExplanation,
): MatrixCell | undefined {
  const next = value?.trim()
  const edited = next !== undefined && next !== (existing?.value ?? '').trim()

  if (!edited) {
    if (!existing) return undefined
    return verified
      ? { ...existing, verifiedByStudent: true, verifiedAt: now }
      : { ...existing, verifiedByStudent: false, verifiedAt: undefined }
  }

  const originalValue = existing?.originalValue ?? (existing?.aiGenerated ? existing.value : undefined)
  const originalCell = existing?.originalCell ?? (existing?.aiGenerated ? aiSnapshot(existing) : undefined)
  const signOff = {
    verifiedByStudent: verified,
    verifiedAt: verified ? now : undefined,
    originalValue,
    originalCell,
    editExplanation: hasExplanation(explanation) ? explanation : undefined,
  }
  if (!next) {
    // Cleared: the reviewer is recording that the paper does not report it.
    return {
      value: '',
      aiGenerated: existing?.aiGenerated ?? false,
      confidenceScore: existing?.confidenceScore ?? 0,
      confidenceLevel: existing?.confidenceLevel ?? 'none',
      evidenceType: 'not_available',
      sourceRef: '',
      extractionMethod: 'not_available',
      ...signOff,
    }
  }
  if (!existing || existing.evidenceType === 'not_available') {
    // Filling a gap the extractor left: nothing of the AI's survives in it.
    return {
      value: next,
      aiGenerated: false,
      confidenceScore: 100,
      confidenceLevel: 'high',
      evidenceType: 'extracted',
      sourceRef: '',
      extractionMethod: 'summarised',
      ...signOff,
    }
  }
  // A corrected value is the reviewer's, not the extractor's: the AI's quote
  // supported the old value, and left in place it would flag the new one as
  // unsupported. The AI's value survives in originalValue.
  return {
    ...existing,
    value: next,
    aiGenerated: false,
    sourceRef: '',
    ...signOff,
  }
}

function hasExplanation(e: CellEditExplanation | undefined): e is CellEditExplanation {
  return !!e && (!!e.reason || !!e.reference?.trim())
}

function aiSnapshot(cell: MatrixCell): NonNullable<MatrixCell['originalCell']> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { originalValue, originalCell, editExplanation, ...rest } = cell
  return rest
}

/**
 * Undo the reviewer's edits and put back what the AI extracted, unverified.
 * Undefined when the cell was never edited away from an AI value.
 */
export function resetCell(existing: MatrixCell | undefined): MatrixCell | undefined {
  if (!existing || existing.originalValue === undefined) return undefined
  if (existing.originalCell) return { ...existing.originalCell, verifiedByStudent: false, verifiedAt: undefined }
  // Edited before the full snapshot was kept: only the value survives.
  return {
    ...existing,
    value: existing.originalValue,
    aiGenerated: true,
    evidenceType: existing.originalValue ? 'extracted' : 'not_available',
    extractionMethod: existing.originalValue ? existing.extractionMethod : 'not_available',
    verifiedByStudent: false,
    verifiedAt: undefined,
    originalValue: undefined,
    editExplanation: undefined,
  }
}

/**
 * Fold freshly extracted cells into a row, leaving verified cells alone. A
 * re-run of auto-fill (or a PDF attached after the fact) re-extracts the whole
 * row, and it must not quietly undo what the reviewer has signed off.
 */
export function mergeExtractedCells(
  current: Record<string, MatrixCell>,
  incoming: Record<string, MatrixCell>,
): Record<string, MatrixCell> {
  const merged = { ...current }
  for (const [col, cell] of Object.entries(incoming)) {
    if (current[col]?.verifiedByStudent) continue
    merged[col] = cell
  }
  return merged
}

export interface VerificationStats {
  /** Cells holding an extraction decision (a value, or "not reported"). */
  total: number
  verified: number
}

export function verificationStats(rows: VerifiableRow[], columns: string[]): VerificationStats {
  let total = 0
  let verified = 0
  for (const row of rows) {
    for (const col of columns) {
      const cell = row.cells[col]
      if (!cell) continue
      total++
      if (cell.verifiedByStudent) verified++
    }
  }
  return { total, verified }
}

export interface CellRef {
  rowId: string
  column: string
}

/**
 * The next unverified cell after `from`, reading row by row, left to right,
 * wrapping round to the top. Null when every cell is verified.
 */
export function nextUnverified(
  rows: VerifiableRow[],
  columns: string[],
  from: CellRef | null,
): CellRef | null {
  const order: CellRef[] = []
  for (const row of rows) {
    for (const col of columns) {
      const cell = row.cells[col]
      if (cell && !cell.verifiedByStudent) order.push({ rowId: row.id, column: col })
    }
  }
  if (order.length === 0) return null
  if (!from) return order[0]

  // Position of `from` in reading order, whether or not it is still unverified.
  const rowIndex = rows.findIndex(r => r.id === from.rowId)
  const colIndex = columns.indexOf(from.column)
  const pos = (ref: CellRef) =>
    rows.findIndex(r => r.id === ref.rowId) * columns.length + columns.indexOf(ref.column)
  const here = rowIndex * columns.length + colIndex
  return order.find(ref => pos(ref) > here) ?? order[0]
}

/** DOM id for a matrix cell, so the review card can find and scroll to it. */
export function cellDomId(matrix: string, ref: CellRef): string {
  return `cell-${matrix}-${encodeURIComponent(ref.rowId)}-${encodeURIComponent(ref.column)}`
}

/** True when a cell cites a quote that none of its source texts contain. */
export function quoteMissingFor(cell: MatrixCell | undefined, sources: SourceCandidate[]): boolean {
  return Boolean(
    cell?.sourceRef && sources.some(s => s.text) &&
    checkProvenance(sources, cell.sourceRef).kind === 'not_found',
  )
}

// ── Audit trail ───────────────────────────────────────────────────────────────

const METHOD_WORDS: Record<MatrixCell['extractionMethod'], string> = {
  verbatim: 'quoted verbatim',
  summarised: 'summarised',
  inferred: 'inferred',
  not_available: 'not reported',
}

/**
 * What the AI extracted for a cell, for the decision journal. A peer reviewer
 * judging a confirmation needs to see what was confirmed: the AI's value, how
 * sure it was, and the quote it rested on.
 */
export function describeAiExtraction(cell: MatrixCell | undefined): string | undefined {
  if (!cell) return undefined
  const ai = cell.originalCell ?? (cell.aiGenerated ? cell : undefined)
  if (!ai) return 'Value entered by the user; no AI extraction.'
  return [
    `AI extraction: ${ai.value || 'Not reported'}`,
    `Confidence: ${ai.confidenceScore}% (${ai.confidenceLevel}) · ${METHOD_WORDS[ai.extractionMethod]}`,
    ai.sourceRef ? `Supporting quote: "${ai.sourceRef}"` : 'Supporting quote: none given',
  ].join('\n')
}

export const EDIT_REASON_LABEL: Record<CellEditReason, string> = {
  minor_revision: 'Agree, but it needed a minor revision',
  partial_disagreement: 'Partly disagree with the AI',
  full_disagreement: 'Completely disagree with the AI',
}

/** The reviewer's explanation for an edit, for the decision journal. */
export function describeEditExplanation(e: CellEditExplanation | undefined): string | undefined {
  if (!e) return undefined
  const parts = [
    e.reason && `Reason: ${EDIT_REASON_LABEL[e.reason]}`,
    e.reference?.trim() && `Reference / source: ${e.reference.trim()}`,
  ].filter(Boolean)
  return parts.length ? parts.join('\n') : undefined
}

// ── Export ────────────────────────────────────────────────────────────────────

/** Marks a value in exported tables that no reviewer has checked. */
export const UNVERIFIED_MARK = '†'

/** A cell as it appears in an exported table: unverified values are marked. */
export function exportCellValue(cell: MatrixCell | undefined): string {
  if (!cell) return '—'
  const value = cell.value || '—'
  return cell.verifiedByStudent ? value : `${value} ${UNVERIFIED_MARK}`
}

/** The footnote explaining the mark, or null when every cell is verified. */
export function unverifiedFootnote(rows: VerifiableRow[], columns: string[]): string | null {
  const { total, verified } = verificationStats(rows, columns)
  if (total === verified) return null
  return `${UNVERIFIED_MARK} Extracted by AI and not yet verified by the reviewer (${total - verified} of ${total} cells).`
}
