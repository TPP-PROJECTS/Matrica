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

/**
 * A text a quote might have come from.
 *
 * There is more than one: extraction reads the abstract *and*, when an
 * open-access copy exists, the full text. Checking only the abstract flagged
 * every value legitimately drawn from the full text as unverifiable — which
 * made a successful full-text extraction look like a fabrication, the exact
 * opposite of the truth.
 */
export interface SourceCandidate {
  /** Shown to the reader: "abstract", "full text". */
  label: string
  text: string
}

/** What a cell's provenance amounts to, once the quote has been checked. */
export type ProvenanceVerdict =
  | { kind: 'verified'; match: QuoteMatch; source: SourceCandidate }
  | { kind: 'not_found' }
  | { kind: 'no_quote' }
  | { kind: 'no_source' }

/**
 * Locate `quote` in whichever of `sources` contains it.
 *
 * Sources are tried in order, so pass the most specific first: a quote present
 * in both the abstract and the full text should be reported against the
 * abstract, which is the shorter and more readable of the two.
 */
export function checkProvenance(sources: SourceCandidate[], quote: string): ProvenanceVerdict {
  if (!quote?.trim()) return { kind: 'no_quote' }
  const usable = sources.filter(s => s.text?.trim())
  if (usable.length === 0) return { kind: 'no_source' }

  for (const source of usable) {
    const match = locateQuote(source.text, quote)
    if (match) return { kind: 'verified', match, source }
  }
  return { kind: 'not_found' }
}

/** The sources a matrix cell or appraisal judgement may have been read from. */
export function paperSources(abstract: string | undefined, fullText: string | undefined): SourceCandidate[] {
  return [
    { label: 'abstract', text: abstract ?? '' },
    { label: 'full text', text: fullText ?? '' },
  ]
}

/**
 * A readable window of `text` around `match`.
 *
 * A full text runs to tens of thousands of characters. Rendering all of it to
 * show one highlighted sentence buries the very thing the reader opened the
 * panel for, so the passage is shown with enough surrounding text to judge it
 * in context and no more. Offsets are rebased onto the excerpt.
 */
export function excerptAround(
  text: string,
  match: QuoteMatch,
  radius = 320,
): { text: string; match: QuoteMatch } {
  if (text.length <= radius * 2 + (match.end - match.start)) {
    return { text, match }
  }

  // Snap outwards to whitespace so the excerpt does not begin or end mid-word.
  let start = Math.max(0, match.start - radius)
  let end = Math.min(text.length, match.end + radius)
  while (start > 0 && !/\s/.test(text[start - 1])) start--
  while (end < text.length && !/\s/.test(text[end])) end++

  const prefix = start > 0 ? '… ' : ''
  const suffix = end < text.length ? ' …' : ''
  return {
    text: prefix + text.slice(start, end) + suffix,
    match: {
      start: match.start - start + prefix.length,
      end: match.end - start + prefix.length,
    },
  }
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
