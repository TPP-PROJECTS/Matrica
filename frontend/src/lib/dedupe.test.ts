import { describe, it, expect } from 'vitest'
import { extractDoi, titleKey, buildIndex, findDuplicate, partitionNewPapers } from './dedupe'
import type { ResultCard } from '../types'

function paper(over: Partial<ResultCard>): ResultCard {
  return {
    id: 'p1', title: 'A study', authors: 'Smith', year: 2020,
    source: '', relevanceScore: 0, abstract: '', topicId: 't1', queryId: 'q1',
    confidence: 'none', isDuplicate: false, status: null, notes: '',
    ...over,
  }
}

describe('extractDoi', () => {
  it('pulls a DOI out of a doi.org URL, lower-cased', () => {
    expect(extractDoi('https://doi.org/10.1234/ABC.def')).toBe('10.1234/abc.def')
  })

  it('strips trailing punctuation that is not part of the DOI', () => {
    expect(extractDoi('see 10.1234/abc.')).toBe('10.1234/abc')
  })

  it('returns null when there is no DOI', () => {
    expect(extractDoi('https://openalex.org/W123456')).toBeNull()
    expect(extractDoi('')).toBeNull()
  })
})

describe('titleKey', () => {
  it('ignores case, punctuation and spacing differences', () => {
    expect(titleKey('Machine Learning: A Review!')).toBe(titleKey('machine learning   a review'))
  })

  it('is empty for an empty title, so it never matches by accident', () => {
    expect(titleKey('')).toBe('')
    expect(titleKey('  ')).toBe('')
  })
})

describe('findDuplicate', () => {
  it('matches on DOI even when the titles are rendered differently', () => {
    const held = paper({ id: 'a', title: 'Deep learning in radiology', source: 'https://doi.org/10.1234/x' })
    const index = buildIndex([held])
    const incoming = paper({ id: 'b', title: 'Deep Learning in Radiology: a review', source: 'https://doi.org/10.1234/X' })
    expect(findDuplicate(index, incoming)?.id).toBe('a')
  })

  it('falls back to the title when neither record carries a DOI', () => {
    const held = paper({ id: 'a', title: 'A Study of Things', source: 'https://openalex.org/W1' })
    const index = buildIndex([held])
    const incoming = paper({ id: 'b', title: 'a study of things', source: 'https://pubmed.ncbi.nlm.nih.gov/9/' })
    expect(findDuplicate(index, incoming)?.id).toBe('a')
  })

  it('does not match two different papers that both lack a DOI', () => {
    const index = buildIndex([paper({ id: 'a', title: 'Alpha' })])
    expect(findDuplicate(index, paper({ id: 'b', title: 'Beta' }))).toBeNull()
  })

  it('does not treat empty titles as matching each other', () => {
    const index = buildIndex([paper({ id: 'a', title: '', source: '' })])
    expect(findDuplicate(index, paper({ id: 'b', title: '', source: '' }))).toBeNull()
  })
})

describe('partitionNewPapers', () => {
  it('keeps genuinely new papers and counts the duplicates', () => {
    const existing = [paper({ id: 'a', title: 'Alpha', source: 'https://doi.org/10.5555/a' })]
    const incoming = [
      paper({ id: 'b', title: 'Alpha reprinted', source: 'https://doi.org/10.5555/a' }),
      paper({ id: 'c', title: 'Gamma', source: 'https://doi.org/10.5555/c' }),
    ]
    const { fresh, duplicateCount } = partitionNewPapers(existing, incoming)
    expect(fresh.map(p => p.id)).toEqual(['c'])
    expect(duplicateCount).toBe(1)
  })

  it('catches repeats inside a single incoming batch', () => {
    const incoming = [
      paper({ id: 'a', title: 'Same paper', source: 'https://doi.org/10.1234/x' }),
      paper({ id: 'b', title: 'Same Paper', source: 'https://doi.org/10.1234/x' }),
    ]
    const { fresh, duplicateCount } = partitionNewPapers([], incoming)
    expect(fresh.map(p => p.id)).toEqual(['a'])
    expect(duplicateCount).toBe(1)
  })

  it('salvages an abstract from a duplicate when the kept record has none', () => {
    const existing = [paper({ id: 'a', title: 'Alpha', source: 'https://doi.org/10.5555/a', abstract: '' })]
    const incoming = [paper({ id: 'b', title: 'Alpha', source: 'https://doi.org/10.5555/a', abstract: 'The real abstract.' })]
    const { enrichments } = partitionNewPapers(existing, incoming)
    expect(enrichments).toEqual([{ id: 'a', abstract: 'The real abstract.' }])
  })

  it('leaves an existing abstract alone', () => {
    const existing = [paper({ id: 'a', title: 'Alpha', source: 'https://doi.org/10.5555/a', abstract: 'Kept.' })]
    const incoming = [paper({ id: 'b', title: 'Alpha', source: 'https://doi.org/10.5555/a', abstract: 'Other.' })]
    expect(partitionNewPapers(existing, incoming).enrichments).toEqual([])
  })

  it('reports nothing new for an empty batch', () => {
    const { fresh, duplicateCount } = partitionNewPapers([paper({})], [])
    expect(fresh).toEqual([])
    expect(duplicateCount).toBe(0)
  })
})
