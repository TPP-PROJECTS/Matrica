import { useEffect, useRef } from 'react'
import { useApp } from '../store/AppContext'
import { checkIntegrity, papersDueForCheck } from './integrity'

// Let a burst of review-list changes settle before looking anything up.
const SETTLE_MS = 1500

/**
 * Keeps the included papers' integrity checks current: whenever the review list
 * changes (from the paper-selection step on), papers not yet checked — or
 * checked too long ago — are looked up in the background.
 */
export function useIntegrityWatcher(): void {
  const { state, dispatch } = useApp()
  const inFlight = useRef(new Set<string>())
  const reviewListKey = state.reviewList.map(p => p.id).join('|')
  const active = state.currentStep >= 4 && !state.reviewMode

  useEffect(() => {
    if (!active) return
    const due = papersDueForCheck(state.reviewList, state.integrityChecks ?? {}, Date.now())
      .filter(p => !inFlight.current.has(p.id))
    if (due.length === 0) return
    const timer = setTimeout(() => {
      due.forEach(p => inFlight.current.add(p.id))
      void checkIntegrity(due, dispatch)
        .catch(() => { /* stays due; retried on the next change or visit */ })
        .finally(() => due.forEach(p => inFlight.current.delete(p.id)))
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  // Keyed on the list's membership: the checks it records must not re-trigger it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewListKey, active])
}
