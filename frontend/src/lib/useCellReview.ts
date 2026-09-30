import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../store/AppContext'
import type { CellEditExplanation, MatrixKind } from '../types'
import { journalEntry } from './decisionJournal'
import { cellDomId, describeAiExtraction, nextUnverified, type CellRef, type VerifiableRow } from './matrixVerification'

/**
 * Bring a cell into view inside the matrix's own scroll area. scrollIntoView
 * would also scroll every ancestor — including the app shell, which is
 * overflow-hidden and would then sit shifted with no way to scroll it back.
 * The sticky title columns cover the left edge, so that is where "in view"
 * starts horizontally.
 */
function scrollWithinTable(el: HTMLElement) {
  const box = el.closest<HTMLElement>('.overflow-auto')
  if (!box) return
  const b = box.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const sticky = Array.from(el.parentElement?.querySelectorAll<HTMLElement>('td.sticky') ?? [])
  const leftEdge = Math.max(b.left, ...sticky.map(td => td.getBoundingClientRect().right))
  if (r.top < b.top) box.scrollTop -= b.top - r.top
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom
  if (r.left < leftEdge) box.scrollLeft -= leftEdge - r.left
  else if (r.right > b.right) box.scrollLeft += r.right - b.right
}

export interface PendingEdit {
  ref: CellRef
  value: string
  /** Save & confirm, rather than save only. */
  confirm: boolean
  previous: string
  /** What the AI extracted, when the cell has an AI value. */
  aiValue?: string
}

export interface ReviewTarget {
  ref: CellRef
  rect: DOMRect
}

const same = (a: CellRef | null, b: CellRef | null) =>
  !!a && !!b && a.rowId === b.rowId && a.column === b.column

/**
 * The reviewer's three separate actions on a cell — confirm it, edit it in
 * place, or open its source and confidence details — plus a keyboard walk
 * through the unverified cells. Kept per matrix: the literature and system
 * matrices are reviewed independently.
 *
 * Keyboard, once a cell is focused (via "Review N →"): Enter confirms and
 * moves on, E edits, Esc leaves.
 */
export function useCellReview(matrix: MatrixKind, rows: VerifiableRow[], columns: string[]) {
  const { state, dispatch } = useApp()
  /** The cell whose details card (source, confidence, Ask AI why) is open. */
  const [target, setTarget] = useState<ReviewTarget | null>(null)
  /** The cell the keyboard walk is on. */
  const [focused, setFocused] = useState<CellRef | null>(null)
  /** The cell being edited in place. */
  const [editing, setEditing] = useState<CellRef | null>(null)
  /** A changed value waiting on the reviewer's explanation. */
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null)

  const openDetails = (ref: CellRef, rowLabel: string) => {
    const el = document.getElementById(cellDomId(matrix, ref))
    if (!el) return
    scrollWithinTable(el)
    // Measuring forces layout, so this already sees the scrolled position.
    setTarget({ ref, rect: el.getBoundingClientRect() })

    // Checking the evidence before confirming is part of what a peer reviewer
    // assesses, so the view is journalled — though not again when the same
    // cell's card is reopened straight away.
    const entityId = `${ref.rowId}:${ref.column}`
    const action = `Viewed source and confidence of ${matrix} matrix cell`
    const last = state.decisionJournal[state.decisionJournal.length - 1]
    if (last?.action === action && last.entityId === entityId) return
    dispatch({
      type: 'ADD_DECISION_JOURNAL_ENTRY',
      entry: journalEntry({
        kind: 'ai_explanation_view',
        step: 5,
        action,
        entityType: 'matrix_cell',
        entityId,
        entityLabel: `${rowLabel} — ${ref.column}`,
        details: describeAiExtraction(rows.find(r => r.id === ref.rowId)?.cells[ref.column]),
      }),
    })
  }

  const closeDetails = useCallback(() => setTarget(null), [])

  const focus = useCallback((ref: CellRef | null) => {
    setFocused(ref)
    if (!ref) return
    const el = document.getElementById(cellDomId(matrix, ref))
    if (el) scrollWithinTable(el)
  }, [matrix])

  /** Focus the unverified cell after `from`; clears focus when none remain. */
  const advance = (from: CellRef | null) => {
    const next = nextUnverified(rows, columns, from)
    // `rows` predates a confirmation just dispatched, so the cell being left
    // can come back as its own successor when it was the last one.
    focus(!next || same(next, from) ? null : next)
  }

  const setVerified = (ref: CellRef, verified: boolean) =>
    dispatch({ type: 'REVIEW_MATRIX_CELL', matrix, rowId: ref.rowId, column: ref.column, verified })

  /**
   * Save the editor's value, confirming the cell only when asked to. A changed
   * value is held until the reviewer has explained it (or skipped that), so
   * the correction and its reason land in the journal as one decision.
   */
  const saveEdit = (ref: CellRef, value: string, confirm: boolean) => {
    const cell = rows.find(r => r.id === ref.rowId)?.cells[ref.column]
    if (value.trim() === (cell?.value ?? '').trim()) {
      if (confirm && cell && !cell.verifiedByStudent) setVerified(ref, true)
      setEditing(null)
      return
    }
    setPendingEdit({ ref, value: value.trim(), confirm, previous: cell?.value ?? '', aiValue: cell?.originalValue ?? (cell?.aiGenerated ? cell.value : undefined) })
  }

  /** Commit the held edit, with the reviewer's explanation if they gave one. */
  const finishEdit = (explanation?: CellEditExplanation) => {
    if (!pendingEdit) return
    const { ref, value, confirm } = pendingEdit
    dispatch({ type: 'REVIEW_MATRIX_CELL', matrix, rowId: ref.rowId, column: ref.column, verified: confirm, value, explanation })
    setPendingEdit(null)
    setEditing(null)
  }

  const reset = (ref: CellRef) => {
    dispatch({ type: 'RESET_MATRIX_CELL', matrix, rowId: ref.rowId, column: ref.column })
    setEditing(null)
  }

  const startEdit = (ref: CellRef) => {
    setTarget(null)
    setEditing(ref)
  }

  useEffect(() => {
    if (!focused || editing || target || pendingEdit) return
    const ref = focused
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === 'Escape') { e.preventDefault(); setFocused(null) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        const row = rows.find(r => r.id === ref.rowId)
        if (row?.cells[ref.column]) setVerified(ref, true)
        advance(ref)
      } else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); startEdit(ref) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return {
    target, openDetails, closeDetails,
    focused, advance,
    editing, startEdit, cancelEdit: () => setEditing(null), saveEdit, reset, setVerified,
    pendingEdit, finishEdit, backToEditing: () => setPendingEdit(null),
    isFocused: (ref: CellRef) => same(focused, ref),
    isEditing: (ref: CellRef) => same(editing, ref),
  }
}
