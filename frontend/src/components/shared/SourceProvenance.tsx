import { useMemo } from 'react'
import { checkProvenance, excerptAround, segmentForHighlight, type SourceCandidate } from '../../lib/provenance'

/**
 * Where a matrix cell's value came from, shown against the source text.
 *
 * The panel below the AI's reasoning explains a value; this one *grounds* it.
 * The quote was captured when the cell was filled and is located in the source
 * here, so the reviewer sees the supporting sentence in place rather than a
 * second-hand account of it.
 *
 * The case that earns this component is `not_found`: a quote the model produced
 * but that is in none of the texts it was given means the value was
 * reconstructed, not read. That is the single most useful thing to put in front
 * of someone deciding whether to trust an extraction, so it is stated plainly
 * rather than softened.
 *
 * Several sources are checked, not just the abstract. Extraction also reads the
 * open-access full text where one exists, and checking the abstract alone
 * marked every value legitimately drawn from the full text as unverifiable —
 * making a successful extraction look like a fabrication.
 */
export function SourceProvenance({
  sources,
  quote,
}: {
  sources: SourceCandidate[]
  quote: string
}) {
  const verdict = useMemo(() => checkProvenance(sources, quote), [sources, quote])

  const shown = verdict.kind === 'verified'
    ? verdict.source
    // Nothing matched: show the fullest text available, so the reader can see
    // for themselves what the quote was checked against.
    : sources.filter(s => s.text?.trim()).sort((a, b) => b.text.length - a.text.length)[0]

  const segments = useMemo(() => {
    if (verdict.kind !== 'verified') {
      // Nothing to centre on; a long text is truncated rather than dumped whole.
      const text = shown?.text ?? ''
      return segmentForHighlight(text.length > 1200 ? `${text.slice(0, 1200)} …` : text, null)
    }
    const windowed = excerptAround(shown!.text, verdict.match)
    return segmentForHighlight(windowed.text, windowed.match)
  }, [shown, verdict])

  const checkedLabels = sources.filter(s => s.text?.trim()).map(s => s.label).join(' or ')

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Source</p>
        {verdict.kind === 'verified' && (
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">
            ✓ FOUND IN {verdict.source.label.toUpperCase()}
          </span>
        )}
        {verdict.kind === 'not_found' && (
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
            ✕ NOT IN {checkedLabels.toUpperCase()}
          </span>
        )}
        {verdict.kind === 'no_quote' && (
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
            INFERRED — NO QUOTE
          </span>
        )}
      </div>

      {verdict.kind === 'not_found' && (
        <p className="text-[10px] text-red-700 leading-snug mb-1.5">
          The quote given for this value does not appear in the {checkedLabels}. Treat the value as
          unverified and check the paper before relying on it.
        </p>
      )}

      {verdict.kind === 'no_quote' && (
        <p className="text-[10px] text-amber-700 leading-snug mb-1.5">
          This value was reasoned from context rather than read from a specific passage.
        </p>
      )}

      {verdict.kind === 'no_source' && (
        <p className="text-[10px] text-zinc-500 leading-snug mb-1.5">
          No source text is stored for this row, so the quote cannot be checked.
        </p>
      )}

      {verdict.kind === 'not_found' && quote && (
        <blockquote className="text-[10px] text-zinc-600 italic border-l-2 border-red-200 pl-2 mb-1.5">
          “{quote}”
        </blockquote>
      )}

      {shown?.text && (
        <>
          <p className="text-[8px] text-zinc-400 mb-0.5">{shown.label}</p>
          <div className="max-h-32 overflow-y-auto rounded bg-zinc-50 border border-zinc-100 p-2">
            <p className="text-[10px] text-zinc-600 leading-relaxed whitespace-pre-wrap">
              {segments.map((segment, i) =>
                segment.highlighted ? (
                  <mark key={i} className="bg-yellow-200 text-zinc-900 rounded px-0.5">
                    {segment.text}
                  </mark>
                ) : (
                  <span key={i}>{segment.text}</span>
                ),
              )}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
