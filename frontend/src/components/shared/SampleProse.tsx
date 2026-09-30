import { useState } from 'react'

/**
 * Draft prose for one subsection.
 *
 * The outline above it says what belongs under the heading; this is an attempt
 * at actually saying it, written from the review's own matrix, synthesis, gap
 * statement and appraisal. It exists so the author starts from a draft that
 * already marshals their evidence rather than a blank page.
 *
 * Three rules shape the interaction:
 *
 * - Regenerating is always explicit. Once the author has edited a paragraph it
 *   is theirs, and silently replacing it would destroy work — so an edited
 *   sample warns before it is overwritten.
 * - The draft is labelled as a draft. Prose that cites real papers in a real
 *   format reads as finished long before it is, and the one thing the author
 *   must not do is paste it in unread.
 * - [EVIDENCE NEEDED] markers from the generator are highlighted rather than
 *   buried: they are the places the review does not actually support the claim
 *   the outline asked for, which is exactly what the author needs to see.
 */
export function SampleProse({
  sample,
  edited,
  busy,
  error,
  onGenerate,
  onChange,
  onClear,
}: {
  sample: string | undefined
  edited: boolean
  busy: boolean
  error: string | null
  onGenerate: () => void
  onChange: (text: string) => void
  onClear: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirmRegen, setConfirmRegen] = useState(false)

  function startEdit() {
    setDraft(sample ?? '')
    setEditing(true)
  }

  function save() {
    onChange(draft)
    setEditing(false)
  }

  function requestRegenerate() {
    // An untouched draft can be replaced freely; the author's own words cannot.
    if (edited && sample) setConfirmRegen(true)
    else onGenerate()
  }

  if (!sample && !busy && !error) {
    return (
      <div className="ml-[26px] mt-1.5">
        <button
          onClick={onGenerate}
          className="text-[9px] px-2 py-1 rounded border border-zinc-200 text-zinc-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
          title="Draft the paragraphs for this heading from your matrix, synthesis and gap statement"
        >
          ✎ Draft sample text
        </button>
      </div>
    )
  }

  return (
    <div className="ml-[26px] mt-2 border-l-2 border-blue-200 pl-2.5">
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className="text-[8px] font-bold text-blue-500 uppercase tracking-widest">
          Sample text
        </span>
        <span
          className={`text-[8px] font-bold px-1 py-0.5 rounded ${
            edited ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}
          title={edited
            ? 'You have edited this text'
            : 'Generated draft — rewrite it in your own voice and verify every citation before use'}
        >
          {edited ? 'YOUR TEXT' : 'AI DRAFT'}
        </span>

        <span className="flex-1" />

        {!editing && !busy && (
          <>
            <button
              onClick={startEdit}
              className="text-[9px] text-zinc-400 hover:text-blue-600"
            >
              Edit
            </button>
            <button
              onClick={requestRegenerate}
              className="text-[9px] text-zinc-400 hover:text-blue-600"
            >
              Regenerate
            </button>
            <button
              onClick={onClear}
              className="text-[9px] text-zinc-400 hover:text-red-500"
            >
              Clear
            </button>
          </>
        )}
      </div>

      {confirmRegen && (
        <div className="mb-1.5 flex items-center gap-2 text-[9px] bg-amber-50 border border-amber-200 rounded px-2 py-1">
          <span className="text-amber-800 flex-1">
            This will discard the text you wrote and replace it with a new draft.
          </span>
          <button
            onClick={() => { setConfirmRegen(false); onGenerate() }}
            className="font-semibold text-amber-800 hover:underline"
          >
            Replace
          </button>
          <button
            onClick={() => setConfirmRegen(false)}
            className="text-zinc-400 hover:underline"
          >
            Cancel
          </button>
        </div>
      )}

      {busy && (
        <p className="text-[10px] text-zinc-400 italic flex items-center gap-1.5 py-1">
          Drafting from your evidence…
        </p>
      )}

      {error && !busy && (
        <p className="text-[10px] text-red-600 py-1">
          {error}{' '}
          <button onClick={onGenerate} className="underline hover:no-underline">Retry</button>
        </p>
      )}

      {editing ? (
        <div className="space-y-1.5">
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={Math.max(6, Math.min(24, draft.split('\n').length + 3))}
            className="w-full border border-zinc-200 rounded px-2 py-1.5 text-[10px] text-zinc-700 leading-relaxed outline-none focus:border-blue-400 resize-y bg-white"
          />
          <div className="flex gap-1.5 justify-end">
            <button
              onClick={() => setEditing(false)}
              className="px-2.5 h-6 border border-zinc-300 rounded text-[10px] text-zinc-500 hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="px-2.5 h-6 bg-blue-600 text-white rounded text-[10px] font-medium hover:bg-blue-700"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        sample && !busy && (
          <>
            <div className="text-[10px] text-zinc-700 leading-relaxed whitespace-pre-wrap">
              {highlightGaps(sample)}
            </div>
            {!edited && (
              <p className="text-[8px] text-zinc-400 mt-1.5 leading-snug">
                A draft, not a finished paragraph. It may only cite papers in your review — check
                every citation against the matrix before this goes anywhere near a submission.
              </p>
            )}
          </>
        )
      )}
    </div>
  )
}

/**
 * Mark the generator's [EVIDENCE NEEDED: …] flags.
 *
 * These are where the outline asked for a claim the review does not support.
 * The generator is instructed to flag rather than invent, and the flag is only
 * useful if it is impossible to miss when skim-reading.
 */
function highlightGaps(text: string) {
  const parts = text.split(/(\[EVIDENCE NEEDED:[^\]]*\])/g)
  return parts.map((part, i) =>
    part.startsWith('[EVIDENCE NEEDED:') ? (
      <mark
        key={i}
        className="bg-red-100 text-red-800 rounded px-1 font-medium not-italic"
        title="The review does not contain evidence for this claim"
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}
