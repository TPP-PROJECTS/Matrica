/**
 * Checking an extracted value against the text it claims to come from.
 *
 * The matrix records a `sourceRef` quote captured at the moment a cell is
 * filled. That quote is only worth anything if it can be found in the source —
 * a quote that is *not* in the abstract means the value was reconstructed
 * rather than read, which is precisely the failure a reviewer needs flagged.
 * So the quote is located here rather than trusted.
 *
 * Matching is tolerant of the ways a model reformats text it is copying —
 * collapsed whitespace, smart quotes, an added or dropped trailing full stop —
 * but not of changed words. Tolerating rewording would defeat the point.
 */

/** Characters a model commonly substitutes when echoing text back. */
const EQUIVALENT: Record<string, string> = {
  '‘': "'", '’': "'", '‛': "'",
  '“': '"', '”': '"',
  '–': '-', '—': '-', '−': '-',
  ' ': ' ', ' ': ' ', ' ': ' ',
  '…': '...',
}

/**
 * Normalise for comparison, and record where each normalised character came
 * from in the original. The index map is what lets a match found in normalised
 * space be highlighted at the right offsets in the text the user actually sees.
 */
function normalise(text: string): { text: string; indexMap: number[] } {
  const out: string[] = []
  const indexMap: number[] = []
  let lastWasSpace = true   // leading whitespace is dropped

  for (let i = 0; i < text.length; i++) {
    const raw = text[i]
    const mapped = EQUIVALENT[raw] ?? raw

    if (/\s/.test(mapped)) {
      if (!lastWasSpace) {
        out.push(' ')
        indexMap.push(i)
        lastWasSpace = true
      }
      continue
    }

    lastWasSpace = false
    for (const char of mapped.toLowerCase()) {
      out.push(char)
      indexMap.push(i)
    }
  }

  while (out.length > 0 && out[out.length - 1] === ' ') {
    out.pop()
    indexMap.pop()
  }

  return { text: out.join(''), indexMap }
}

/** Trailing punctuation a quote may gain or lose without changing its content. */
function trimEdgePunctuation(text: string): string {
  return text.replace(/^["'“”‘’\s.,;:]+/, '').replace(/["'“”‘’\s.,;:]+$/, '')
}

export interface QuoteMatch {
  /** Offsets into the ORIGINAL source string, ready to slice for highlighting. */
  start: number
  end: number
}

/**
 * Locate `quote` inside `source`, or null if it is not really there.
 *
 * Returns offsets into `source` as given, not into the normalised form, so the
 * caller can highlight the passage in the text the reader sees.
 */
export function locateQuote(source: string, quote: string): QuoteMatch | null {
  const cleanedQuote = trimEdgePunctuation(quote ?? '')
  if (!source || cleanedQuote.length < 12) return null   // too short to be evidence

  const haystack = normalise(source)
  const needle = normalise(cleanedQuote)
  if (!needle.text) return null

  const at = haystack.text.indexOf(needle.text)
  if (at === -1) return null

  return {
    start: haystack.indexMap[at],
    // The map holds the start offset of each normalised character, so the end
    // of the match is one past the origin of its final character.
    end: haystack.indexMap[at + needle.text.length - 1] + 1,
  }
}

/** What a cell's provenance amounts to, once the quote has been checked. */
export type ProvenanceVerdict =
  | { kind: 'verified'; match: QuoteMatch }
  | { kind: 'not_found' }
  | { kind: 'no_quote' }
  | { kind: 'no_source' }

export function checkProvenance(source: string, quote: string): ProvenanceVerdict {
  if (!quote?.trim()) return { kind: 'no_quote' }
  if (!source?.trim()) return { kind: 'no_source' }
  const match = locateQuote(source, quote)
  return match ? { kind: 'verified', match } : { kind: 'not_found' }
}

export interface HighlightSegment {
  text: string
  highlighted: boolean
}

/** Split `source` into segments so the matched span can be rendered marked up. */
export function segmentForHighlight(source: string, match: QuoteMatch | null): HighlightSegment[] {
  if (!match) return [{ text: source, highlighted: false }]
  return [
    { text: source.slice(0, match.start), highlighted: false },
    { text: source.slice(match.start, match.end), highlighted: true },
    { text: source.slice(match.end), highlighted: false },
  ].filter(segment => segment.text.length > 0)
}
