import { describe, it, expect } from 'vitest'
import { checkProvenance, locateQuote, paperSources, segmentForHighlight } from './provenance'

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

const FULL_TEXT =
  'Methods. Participants were recruited from twelve primary care practices between ' +
  'March 2018 and June 2019. Allocation was concealed using sequentially numbered ' +
  'opaque sealed envelopes. Outcome assessors remained blinded throughout.'

describe('checkProvenance', () => {
  it('reports a locatable quote as verified', () => {
    const v = checkProvenance(paperSources(ABSTRACT, ''), 'HbA1c fell by 0.8% in the treatment arm')
    expect(v.kind).toBe('verified')
  })

  it('reports a quote that is in neither source as not_found', () => {
    // The signal that matters: the model produced a quote it could not have read.
    const v = checkProvenance(paperSources(ABSTRACT, FULL_TEXT), 'Participants were followed for five years')
    expect(v.kind).toBe('not_found')
  })

  it('verifies a quote that is only in the full text', () => {
    // This is the case that used to be flagged as fabricated: extraction reads
    // the PDF, quotes the Methods section, and the abstract does not contain it.
    const v = checkProvenance(
      paperSources(ABSTRACT, FULL_TEXT),
      'Allocation was concealed using sequentially numbered opaque sealed envelopes.',
    )
    expect(v.kind).toBe('verified')
    if (v.kind === 'verified') expect(v.source.label).toBe('full text')
  })

  it('names the abstract when the quote is there, since it is the shorter read', () => {
    const v = checkProvenance(paperSources(ABSTRACT, FULL_TEXT), 'HbA1c fell by 0.8% in the treatment arm')
    expect(v.kind).toBe('verified')
    if (v.kind === 'verified') expect(v.source.label).toBe('abstract')
  })

  it('still rejects a paraphrase even with the full text available', () => {
    const v = checkProvenance(
      paperSources(ABSTRACT, FULL_TEXT),
      'Allocation was hidden using numbered sealed envelopes.',
    )
    expect(v.kind).toBe('not_found')
  })

  it('distinguishes an inferred value from a fabricated quote', () => {
    expect(checkProvenance(paperSources(ABSTRACT, FULL_TEXT), '').kind).toBe('no_quote')
  })

  it('reports having no text to check against separately from having no quote', () => {
    expect(checkProvenance(paperSources('', ''), 'HbA1c fell by 0.8% in the treatment arm').kind)
      .toBe('no_source')
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
