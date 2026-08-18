import { describe, it, expect } from 'vitest'
import { checkProvenance, locateQuote, segmentForHighlight } from './provenance'

const ABSTRACT =
  'Background: Diabetes affects millions. Methods: We randomised 240 adults to ' +
  'either metformin or placebo over 12 months. Results: HbA1c fell by 0.8% in ' +
  'the treatment arm. Conclusion: Metformin is effective.'

describe('locateQuote', () => {
  it('finds an exact quote and reports offsets into the original text', () => {
    const match = locateQuote(ABSTRACT, 'We randomised 240 adults to either metformin or placebo over 12 months.')
    expect(match).not.toBeNull()
    // Edge punctuation is trimmed off the quote before matching, so the span
    // covers the sentence without its full stop.
    expect(ABSTRACT.slice(match!.start, match!.end))
      .toBe('We randomised 240 adults to either metformin or placebo over 12 months')
  })

  it('tolerates collapsed whitespace and line breaks', () => {
    const match = locateQuote(ABSTRACT, 'We randomised 240 adults\n  to either metformin\tor placebo over 12 months')
    expect(match).not.toBeNull()
    expect(ABSTRACT.slice(match!.start, match!.end)).toContain('240 adults')
  })

  it('tolerates smart quotes and dashes being swapped for plain ones', () => {
    const source = 'The authors’ approach — described below — was pre-registered.'
    const match = locateQuote(source, "The authors' approach - described below - was pre-registered")
    expect(match).not.toBeNull()
  })

  it('tolerates a difference in case', () => {
    expect(locateQuote(ABSTRACT, 'HBA1C FELL BY 0.8% IN THE TREATMENT ARM')).not.toBeNull()
  })

  it('tolerates surrounding quotation marks and a trailing full stop', () => {
    expect(locateQuote(ABSTRACT, '"HbA1c fell by 0.8% in the treatment arm."')).not.toBeNull()
  })

  it('rejects a quote whose wording was changed', () => {
    // A paraphrase is exactly what must not pass: the value was not read off
    // the source, it was reconstructed.
    expect(locateQuote(ABSTRACT, 'We randomly assigned 240 patients to metformin or placebo')).toBeNull()
  })

  it('rejects a number the source does not contain', () => {
    expect(locateQuote(ABSTRACT, 'We randomised 420 adults to either metformin or placebo')).toBeNull()
  })

  it('rejects a quote assembled from separated passages', () => {
    expect(locateQuote(ABSTRACT, 'Diabetes affects millions. HbA1c fell by 0.8%')).toBeNull()
  })

  it('rejects a fragment too short to be evidence', () => {
    expect(locateQuote(ABSTRACT, 'Methods')).toBeNull()
  })

  it('returns null rather than throwing on empty input', () => {
    expect(locateQuote('', 'anything at all here')).toBeNull()
    expect(locateQuote(ABSTRACT, '')).toBeNull()
  })
})

describe('checkProvenance', () => {
  it('reports a locatable quote as verified', () => {
    expect(checkProvenance(ABSTRACT, 'HbA1c fell by 0.8% in the treatment arm').kind).toBe('verified')
  })

  it('reports a quote that is not in the source as not_found', () => {
    // The signal that matters: the model produced a quote it could not have read.
    expect(checkProvenance(ABSTRACT, 'Participants were followed for five years').kind).toBe('not_found')
  })

  it('distinguishes an inferred value from a fabricated quote', () => {
    expect(checkProvenance(ABSTRACT, '').kind).toBe('no_quote')
  })

  it('reports a missing abstract separately from a missing quote', () => {
    expect(checkProvenance('', 'HbA1c fell by 0.8% in the treatment arm').kind).toBe('no_source')
  })
})

describe('segmentForHighlight', () => {
  it('splits the source around the matched span', () => {
    const match = locateQuote(ABSTRACT, 'HbA1c fell by 0.8% in the treatment arm')!
    const segments = segmentForHighlight(ABSTRACT, match)
    expect(segments.filter(s => s.highlighted)).toHaveLength(1)
    expect(segments.map(s => s.text).join('')).toBe(ABSTRACT)
    expect(segments.find(s => s.highlighted)!.text).toBe('HbA1c fell by 0.8% in the treatment arm')
  })

  it('returns the whole source unhighlighted when there is no match', () => {
    expect(segmentForHighlight(ABSTRACT, null)).toEqual([{ text: ABSTRACT, highlighted: false }])
  })
})
