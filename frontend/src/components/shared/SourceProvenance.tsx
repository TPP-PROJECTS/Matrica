import { useMemo } from 'react'
import { checkProvenance, segmentForHighlight } from '../../lib/provenance'

/**
 * Where a matrix cell's value came from, shown against the source text.
 *
 * The panel below the AI's reasoning explains a value; this one *grounds* it.
 * The quote was captured when the cell was filled and is located in the
 * abstract here, so the reviewer sees the supporting sentence in place rather
 * than a second-hand account of it.
 *
 * The case that earns this component is `not_found`: a quote the model produced
 * but that is not in the source means the value was reconstructed, not read.
 * That is the single most useful thing to put in front of someone deciding
 * whether to trust an extraction, so it is stated plainly rather than softened.
 */
export function SourceProvenance({
  sourceText,
  quote,
  sourceLabel = 'Abstract',
}: {
  sourceText: string
  quote: string
  sourceLabel?: string
}) {
  const verdict = useMemo(() => checkProvenance(sourceText, quote), [sourceText, quote])
  const segments = useMemo(
    () => segmentForHighlight(sourceText, verdict.kind === 'verified' ? verdict.match : null),
    [sourceText, verdict],
  )

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Source</p>
        {verdict.kind === 'verified' && (
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">
            ✓ FOUND IN {sourceLabel.toUpperCase()}
          </span>
        )}
        {verdict.kind === 'not_found' && (
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
            ✕ NOT IN {sourceLabel.toUpperCase()}
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
          The quote given for this value does not appear in the {sourceLabel.toLowerCase()}. Treat
          the value as unverified and check the paper before relying on it.
        </p>
      )}

      {verdict.kind === 'no_quote' && (
        <p className="text-[10px] text-amber-700 leading-snug mb-1.5">
          This value was reasoned from context rather than read from a specific passage.
        </p>
      )}

      {verdict.kind === 'no_source' && (
        <p className="text-[10px] text-zinc-500 leading-snug mb-1.5">
          No {sourceLabel.toLowerCase()} is stored for this row, so the quote cannot be checked.
        </p>
      )}

      {verdict.kind === 'not_found' && quote && (
        <blockquote className="text-[10px] text-zinc-600 italic border-l-2 border-red-200 pl-2 mb-1.5">
          “{quote}”
        </blockquote>
      )}

      {sourceText && (
        <div className="max-h-32 overflow-y-auto rounded bg-zinc-50 border border-zinc-100 p-2">
          <p className="text-[10px] text-zinc-600 leading-relaxed">
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
      )}
    </div>
  )
}
