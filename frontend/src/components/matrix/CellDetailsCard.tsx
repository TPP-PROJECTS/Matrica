import { useEffect } from 'react'
import type { MatrixCell } from '../../types'
import { SourceProvenance } from '../shared/SourceProvenance'
import type { SourceCandidate } from '../../lib/provenance'
import { EDIT_REASON_LABEL, quoteMissingFor } from '../../lib/matrixVerification'
import type { ReviewTarget } from '../../lib/useCellReview'

const METHOD_LABEL: Record<MatrixCell['extractionMethod'], string> = {
  verbatim: 'Quoted verbatim',
  summarised: 'Summarised',
  inferred: 'Inferred',
  not_available: 'Not reported',
}

const CONFIDENCE_BAR: Record<string, string> = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-500',
  low: 'bg-red-500',
  none: 'bg-zinc-300',
}

/**
 * Where a cell's value came from: the supporting quote located in the source,
 * how the AI extracted it and how sure it was, and a way to ask it why.
 * Confirming and editing live on the cell itself.
 */
export function CellDetailsCard({
  target,
  rowLabel,
  cell,
  sources,
  onClose,
  onAskAi,
}: {
  target: ReviewTarget
  rowLabel: string
  cell: MatrixCell | undefined
  /** Texts the quote is checked against; empty for system rows. */
  sources: SourceCandidate[]
  onClose: () => void
  onAskAi?: () => void
}) {
  const { ref } = target
  const notReported = !cell || cell.evidenceType === 'not_available' || !cell.value
  const flagged = quoteMissingFor(cell, sources)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const W = 360
  const left = target.rect.right + 8 + W > window.innerWidth
    ? Math.max(8, target.rect.left - W - 8)
    : target.rect.right + 8
  const top = Math.max(8, Math.min(target.rect.top, window.innerHeight - 440))

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-label={`Source and reasoning for ${ref.column}`}
        className="fixed z-50 bg-white border border-zinc-200 rounded-xl shadow-2xl flex flex-col"
        style={{ left, top, width: W, maxHeight: 430 }}
      >
        <div className="flex items-start gap-2 px-3 py-2.5 border-b border-zinc-100 shrink-0">
          <span className="w-5 h-5 rounded-full bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">?</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-zinc-800 truncate">{ref.column}</p>
            <p className="text-[9px] text-zinc-400 truncate">{rowLabel}</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-[14px] leading-none shrink-0" aria-label="Close">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-3">
          <p className={`text-[12px] leading-snug ${notReported ? 'italic text-zinc-400' : 'text-zinc-800'}`}>
            {notReported ? 'Not reported in the source' : cell!.value}
          </p>

          {cell && (
            cell.aiGenerated ? (
              <div>
                <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Confidence</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-zinc-100 rounded overflow-hidden">
                    <div className={`h-full rounded ${CONFIDENCE_BAR[cell.confidenceLevel] ?? 'bg-zinc-300'}`} style={{ width: `${cell.confidenceScore}%` }} />
                  </div>
                  <span className="text-[10px] text-zinc-600 tabular-nums">{cell.confidenceScore}%</span>
                </div>
                <p className="text-[9px] text-zinc-400 mt-1">
                  AI extraction · {METHOD_LABEL[cell.extractionMethod]}
                  {cell.verifiedAt && <> · verified {new Date(cell.verifiedAt).toLocaleDateString()}</>}
                </p>
              </div>
            ) : (
              <p className="text-[9px] text-zinc-400">
                Entered by the reviewer
                {cell.verifiedAt && <> · verified {new Date(cell.verifiedAt).toLocaleDateString()}</>}
              </p>
            )
          )}

          {cell?.originalValue !== undefined && (
            <div className="rounded-md bg-zinc-50 border border-zinc-200 px-2 py-1.5">
              <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mb-0.5">AI originally extracted</p>
              <p className="text-[10px] text-zinc-500 line-through decoration-zinc-300">{cell.originalValue || 'Not reported'}</p>
            </div>
          )}

          {cell?.editExplanation && (
            <div className="rounded-md bg-amber-50 border border-amber-200 px-2 py-1.5 space-y-0.5">
              <p className="text-[8px] font-bold text-amber-700 uppercase tracking-widest">Your explanation</p>
              {cell.editExplanation.reason && (
                <p className="text-[10px] text-zinc-700">{EDIT_REASON_LABEL[cell.editExplanation.reason]}</p>
              )}
              {cell.editExplanation.reference && (
                <p className="text-[10px] text-zinc-600 whitespace-pre-wrap">Source: {cell.editExplanation.reference}</p>
              )}
            </div>
          )}

          {flagged && !cell?.verifiedByStudent && (
            <p className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded-md px-2 py-1.5 leading-snug">
              The supporting quote is not in the paper text we hold. Check the value against the paper before confirming it.
            </p>
          )}

          {cell && sources.length > 0 && (
            <SourceProvenance sources={sources} quote={cell.sourceRef} />
          )}
        </div>

        {onAskAi && (
          <div className="px-3 py-2 border-t border-zinc-100 bg-zinc-50 rounded-b-xl shrink-0">
            <button
              onClick={onAskAi}
              className="px-3 h-7 rounded bg-violet-600 text-white text-[11px] font-medium hover:bg-violet-700"
            >
              Ask AI why
            </button>
          </div>
        )}
      </div>
    </>
  )
}
