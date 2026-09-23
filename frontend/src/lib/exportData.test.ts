import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportBibTeX, exportRIS, exportPrismaCSV, exportSearchStrategyCSV} from './exportData'
import type { AppState, ResultCard, ScreeningCriterion } from '../types'

// The export functions build a Blob and click a synthetic <a> to download it.
// Capture the text that would have been written instead of touching the DOM.
let written: { filename: string; content: string }[] = []
let lastBlobText = ''

beforeEach(() => {
  written = []
  lastBlobText = ''
  vi.stubGlobal('Blob', class {
    constructor(parts: string[]) { lastBlobText = parts.join('') }
  })
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:stub',
    revokeObjectURL: () => {},
  })
  vi.stubGlobal('document', {
    createElement(tag: string) {
      if (tag !== 'a') throw new Error(`unexpected element ${tag}`)
      return {
        href: '',
        download: '',
        click() { written.push({ filename: this.download, content: lastBlobText }) },
      }
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function paper(over: Partial<ResultCard>): ResultCard {
  return {
    id: 'p1', title: 'A Study of Things', authors: 'Jane Smith, John Doe',
    year: 2021, source: 'https://doi.org/10.1234/abc', relevanceScore: 80,
    abstract: 'An abstract.', topicId: 't1', queryId: 'q1',
    confidence: 'high', isDuplicate: false, status: 'included', notes: '',
    ...over,
  }
}

function appState(over: Partial<AppState>): AppState {
  return {
    sessionTitle: 'My Review',
    results: [],
    reviewList: [],
    criteria: [],
    screening: { identifiedByQuery: {}, retrievedByQuery: {} },
    queries: [],
    topics: [],
    matrixColumns: [],
    matrixRows: [],
    ...over,
  } as unknown as AppState
}

function contentOf(): string {
  return written[0]?.content ?? ''
}

describe('exportBibTeX', () => {
  it('emits one entry per kept paper, with author names joined by "and"', () => {
    exportBibTeX(appState({ reviewList: [paper({})] }))
    const out = contentOf()
    expect(out).toContain('@article{')
    expect(out).toContain('title = {A Study of Things}')
    expect(out).toContain('author = {Jane Smith and John Doe}')
    expect(out).toContain('year = {2021}')
    expect(out).toContain('doi = {10.1234/abc}')
  })

  it('gives colliding papers distinct citation keys', () => {
    exportBibTeX(appState({
      reviewList: [
        paper({ id: 'a', title: 'Machine learning one' }),
        paper({ id: 'b', title: 'Machine learning two' }),
      ],
    }))
    const keys = [...contentOf().matchAll(/@article\{([^,]+),/g)].map(m => m[1])
    expect(new Set(keys).size).toBe(2)
  })

  it('skips papers that were excluded rather than kept', () => {
    exportBibTeX(appState({ reviewList: [paper({ status: 'excluded' })] }))
    expect(contentOf()).not.toContain('@article{')
  })
})

describe('exportRIS', () => {
  it('writes one AU line per author and terminates the record', () => {
    exportRIS(appState({ reviewList: [paper({})] }))
    const out = contentOf()
    expect(out).toContain('TY  - JOUR')
    expect(out).toContain('AU  - Jane Smith')
    expect(out).toContain('AU  - John Doe')
    expect(out).toContain('DO  - 10.1234/abc')
    expect(out.trimEnd().endsWith('ER  -')).toBe(true)
  })
})

describe('exportPrismaCSV', () => {
  const criteria: ScreeningCriterion[] = [
    { id: 'ex-pop', kind: 'exclusion', label: 'Wrong population' },
    { id: 'ex-des', kind: 'exclusion', label: 'Wrong study design' },
    { id: 'in-adults', kind: 'inclusion', label: 'Adults only' },
  ]

  it('reports the database total, not just what was retrieved', () => {
    exportPrismaCSV(appState({
      results: [paper({ id: 'a' }), paper({ id: 'b' })],
      screening: { identifiedByQuery: { q1: 4000, q2: 213 }, retrievedByQuery: { q1: 6, q2: 3 } },
    }))
    const out = contentOf()
    expect(out).toContain('4213')
    // 9 records retrieved, 2 unique held ⇒ 7 removed as duplicates.
    expect(out).toContain('Duplicate records removed before screening,7')
  })

  it('reports the imported arm separately from what the tool retrieved itself', () => {
    exportPrismaCSV(appState({
      results: [paper({ id: 'a' }), paper({ id: 'b', origin: 'import', importedFrom: 'Scopus' })],
      screening: { identifiedByQuery: { q1: 4000 }, retrievedByQuery: { q1: 6 } },
      importedSearches: [
        { id: 'i1', database: 'Scopus', queryAsRun: 'TITLE-ABS-KEY(x)', searchedAt: '2026-03-01',
          recordsInFile: 40, recordsAdded: 31, recordsUnreadable: 0,
          importedAt: '2026-03-02T00:00:00Z', format: 'ris' as const, filename: 'scopus.ris' },
      ],
    }))
    const out = contentOf()
    expect(out).toContain('imported files),40')
    expect(out).toContain('Records added to the review — imported files,31')
    expect(out).toContain('Duplicate records removed — imported files,9')
    // The imported record must not also be counted as retrieved by the tool.
    expect(out).toContain('Records retrieved into the review tool — database searching,1')
    expect(out).toContain('  Scopus,40')
  })

  it('reports web records on their own PRISMA pathway, not as database records', () => {
    exportPrismaCSV(appState({
      results: [
        paper({ id: 'a' }),
        paper({ id: 'b' }),
        paper({ id: 'w1', origin: 'web' }),
        paper({ id: 'w2', origin: 'web' }),
      ],
      screening: { identifiedByQuery: { q1: 4000 }, retrievedByQuery: { q1: 6 } },
    }))
    const out = contentOf()
    expect(out).toContain('websites and organisations (grey literature),2')
    // The two web pages are neither database records…
    expect(out).toContain('Records retrieved into the review tool — database searching,2')
    // …nor duplicates: 6 retrieved against 2 unique database papers held.
    expect(out).toContain('Duplicate records removed before screening,4')
    // They are still screened.
    expect(out).toContain('Records screened,4')
  })

  it('falls back to the stored duplicate counter for a pre-fix session', () => {
    exportPrismaCSV(appState({
      results: [paper({ id: 'a' }), paper({ id: 'b' })],
      screening: { identifiedByQuery: { q1: 4213 }, retrievedByQuery: {}, duplicatesRemoved: 7 },
    }))
    expect(contentOf()).toContain('Duplicate records removed before screening,7')
  })

  it('itemises exclusions by reason', () => {
    exportPrismaCSV(appState({
      criteria,
      results: [
        paper({ id: 'a', status: 'excluded', exclusionReasonId: 'ex-pop' }),
        paper({ id: 'b', status: 'excluded', exclusionReasonId: 'ex-pop' }),
        paper({ id: 'c', status: 'excluded', exclusionReasonId: 'ex-des' }),
      ],
      screening: { identifiedByQuery: { q1: 3 }, retrievedByQuery: {} },
    }))
    const out = contentOf()
    expect(out).toContain('Wrong population,2')
    expect(out).toContain('Wrong study design,1')
  })

  it('does not silently drop an exclusion whose criterion was deleted', () => {
    exportPrismaCSV(appState({
      criteria: [],
      results: [paper({ id: 'a', status: 'excluded', exclusionReasonId: 'ex-gone' })],
      screening: { identifiedByQuery: { q1: 1 }, retrievedByQuery: {} },
    }))
    expect(contentOf()).toContain('Reason no longer defined,1')
  })

  it('groups exclusions with no criterion under "did not meet inclusion"', () => {
    // The AI can exclude a paper for failing the inclusion criteria without
    // naming a specific exclusion reason (criterionId null). That must read as
    // a real PRISMA reason, not fall through as "no longer defined".
    exportPrismaCSV(appState({
      criteria,
      results: [
        paper({ id: 'a', status: 'excluded', exclusionReasonId: null }),
        paper({ id: 'b', status: 'excluded', exclusionReasonId: null }),
      ],
      screening: { identifiedByQuery: { q1: 2 }, retrievedByQuery: {} },
    }))
    expect(contentOf()).toContain('Did not meet inclusion criteria,2')
  })

  it('counts snowballed records as their own identification pathway', () => {
    exportPrismaCSV(appState({
      results: [
        paper({ id: 'a', origin: 'search' }),
        paper({ id: 'b', origin: 'snowball' }),
        paper({ id: 'c', origin: 'snowball' }),
      ],
      screening: { identifiedByQuery: { q1: 1 }, retrievedByQuery: {} },
    }))
    const out = contentOf()
    expect(out).toContain('citation searching (snowballing),2')
  })

  it('lists the eligibility criteria the screening ran against', () => {
    exportPrismaCSV(appState({ criteria, screening: { identifiedByQuery: {}, retrievedByQuery: {} } }))
    const out = contentOf()
    expect(out).toContain('Adults only,inclusion')
    expect(out).toContain('Wrong population,exclusion')
  })
})


describe('exportSearchStrategyCSV', () => {
  const ranQuery = {
    id: 'q1', queryN: 1, topicId: 't1', text: 'diabetes AND (insulin OR metformin)',
    qualityScore: 80, priority: 'high' as const, databases: ['OpenAlex', 'PubMed'],
    resultCount: 12, stale: false,
    lastRunAt: '2026-03-04T09:30:00.000Z',
    lastRunFilters: { yearFrom: 2015, yearTo: null, openAccessOnly: true, excludePreprints: false, language: 'en' },
    sourceQueries: [
      { source: 'OpenAlex', queryAsRun: 'diabetes insulin metformin  [filter: is_oa:true]', hits: 4000 },
      { source: 'PubMed', queryAsRun: 'diabetes AND (insulin OR metformin) AND english[lang]', hits: 213 },
    ],
  }

  it('reports the strategy each database actually ran, not the query as typed', () => {
    exportSearchStrategyCSV(appState({
      queries: [ranQuery],
      topics: [{ id: 't1', title: 'Glycaemic control' }],
      screening: { identifiedByQuery: { q1: 4213 }, retrievedByQuery: { q1: 22 } },
    } as unknown as Partial<AppState>))
    const out = contentOf()
    expect(out).toContain('diabetes insulin metformin')      // OpenAlex rewrite
    expect(out).toContain('english[lang]')                    // PubMed rewrite
    expect(out).toContain('diabetes AND (insulin OR metformin)') // as entered
    expect(out).toContain('4000')
    expect(out).toContain('213')
  })

  it('records the search date and the limits in force', () => {
    exportSearchStrategyCSV(appState({ queries: [ranQuery], topics: [] } as unknown as Partial<AppState>))
    const out = contentOf()
    expect(out).toContain('2026-03-04')
    expect(out).toContain('Years 2015')
    expect(out).toContain('Open access only')
  })

  it('reports a search run in another database and imported as a file', () => {
    exportSearchStrategyCSV(appState({
      queries: [],
      topics: [],
      importedSearches: [
        { id: 'i1', database: 'Embase', queryAsRun: "'sepsis'/exp AND 'machine learning'",
          searchedAt: '2026-02-14', recordsInFile: 212, recordsAdded: 180, recordsUnreadable: 3,
          importedAt: '2026-02-15T00:00:00Z', format: 'ris' as const, filename: 'embase.ris' },
      ],
    } as unknown as Partial<AppState>))
    const out = contentOf()
    expect(out).toContain('Imported — Embase')
    expect(out).toContain("'sepsis'/exp AND 'machine learning'")
    expect(out).toContain('2026-02-14')
    expect(out).toContain('Records in file,212')
    expect(out).toContain('could not be read,3')
  })

  it('omits queries that were never run, since they have no strategy to report', () => {
    exportSearchStrategyCSV(appState({
      queries: [{ ...ranQuery, id: 'q2', queryN: 2, lastRunAt: undefined, sourceQueries: undefined }],
      topics: [],
    } as unknown as Partial<AppState>))
    expect(contentOf()).toContain('No searches have been run yet')
  })
})
