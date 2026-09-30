import { useEffect, useState } from 'react'
import type { CellEditExplanation, CellEditReason } from '../../types'
import type { PendingEdit } from '../../lib/useCellReview'
import { EDIT_REASON_LABEL } from '../../lib/matrixVerification'

const REASONS: { id: CellEditReason; hint: string }[] = [
  { id: 'minor_revision', hint: 'Wording, units, precision or a missing detail' },
  { id: 'partial_disagreement', hint: 'Some of the AI value is right, some is not' },
  { id: 'full_disagreement', hint: 'The AI value is wrong or not supported by the source' },
]

/**
 * Asked after a reviewer changes an AI-extracted value: what changed, how far
 * they disagreed with the AI, and where the corrected value comes from. The
 * whole step can be skipped — the edit is saved either way.
 */
export function EditExplanationModal({
  pending,
  rowLabel,
  onSubmit,
  onSkip,
  onBack,
}: {
  pending: PendingEdit
  rowLabel: string
  onSubmit: (explanation: CellEditExplanation) => void
  onSkip: () => void
  onBack: () => void
}) {
  const [reason, setReason] = useState<CellEditReason | undefined>()
  const [reference, setReference] = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onBack() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const { ref, value, previous, aiValue, confirm } = pending
  const filled = !reason && !reference.trim()
  const saveLabel = confirm ? 'Save & confirm' : 'Save'
  // Show the AI's value on its own only when an earlier edit sits between it
  // and what is being replaced now.
  const showAi = aiValue !== undefined && aiValue !== previous

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onBack}>
      <div
        role="dialog"
        aria-label="Explain this edit"
        className="w-[520px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-zinc-100 px-5 py-4">
          <h2 className="text-[14px] font-bold text-zinc-900">Explain this edit</h2>
          <p className="mt-0.5 truncate text-[11px] text-zinc-500">{rowLabel} — {ref.column}</p>
          <p className="mt-1.5 text-[10px] text-zinc-400">
            Optional. Your explanation goes into the decision log that peer reviewers read. You can skip it.
          </p>
        </div>

        <div className="space-y-5 px-5 py-4">
          <section>
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500">1 · What changed</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-red-700">
                  {aiValue !== undefined && !showAi ? 'AI value' : 'Previous value'}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-zinc-800">{previous || <span className="italic text-zinc-400">Not reported</span>}</p>
                {showAi && (
                  <p className="mt-1 text-[10px] text-zinc-500">AI originally extracted: {aiValue || 'Not reported'}</p>
                )}
              </div>
              <div className="rounded-md border border-green-100 bg-green-50 px-3 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-green-700">Your value</p>
                <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-zinc-800">{value || <span className="italic text-zinc-400">Not reported</span>}</p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500">2 · Reason</h3>
            <div className="space-y-1.5" role="radiogroup">
              {REASONS.map(r => (
                <label
                  key={r.id}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors ${
                    reason === r.id ? 'border-violet-400 bg-violet-50' : 'border-zinc-200 hover:bg-zinc-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="edit-reason"
                    checked={reason === r.id}
                    onChange={() => setReason(r.id)}
                    className="mt-0.5 accent-violet-600"
                  />
                  <span>
                    <span className="block text-[12px] font-medium text-zinc-800">{EDIT_REASON_LABEL[r.id]}</span>
                    <span className="block text-[10px] text-zinc-500">{r.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500">3 · Reference / source</h3>
            <textarea
              value={reference}
              onChange={e => setReference(e.target.value)}
              rows={3}
              placeholder="Where the corrected value comes from — e.g. p. 4, Table 2, or a quote from the paper"
              className="w-full resize-y rounded-md border border-zinc-300 px-2.5 py-1.5 text-[12px] leading-snug text-zinc-800 outline-none focus:border-violet-500"
            />
          </section>
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-100 bg-zinc-50 px-5 py-3">
          <button onClick={onBack} className="text-[11px] text-zinc-500 hover:text-zinc-800">← Back to editing</button>
          <span className="flex-1" />
          <button
            onClick={onSkip}
            className="h-8 rounded-md border border-zinc-300 bg-white px-3 text-[11px] text-zinc-700 hover:bg-zinc-100"
            title={`${saveLabel} without an explanation`}
          >
            Skip
          </button>
          <button
            onClick={() => onSubmit({ reason, reference: reference.trim() || undefined })}
            disabled={filled}
            title={filled ? 'Choose a reason or add a reference, or skip' : undefined}
            className="h-8 rounded-md bg-zinc-900 px-4 text-[11px] font-semibold text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            {saveLabel} with explanation
          </button>
        </div>
      </div>
    </div>
  )
}
