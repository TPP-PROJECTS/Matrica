import { totalIdentified, duplicatesRemoved, totalImported } from '../types'
import type { AppState, ImportedSearch, ResultCard, RobTool, SearchFilters } from '../types'

/** Imports, defaulting for sessions and review snapshots saved before they existed. */
function importedSearches(state: AppState): ImportedSearch[] {
  return state.importedSearches ?? []
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function downloadText(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function safeBase(state: AppState): string {
  return (state.sessionTitle || 'research_export').replace(/[^a-z0-9]/gi, '_')
}

/** Papers a researcher has kept — the ones worth citing / exporting. */
function citablePapers(state: AppState): ResultCard[] {
  return state.reviewList.filter(r => r.status === 'included' || r.status === 'maybe' || r.status === 'saved')
}

/** Split a display author string ("John Smith, Jane Doe et al.") into names. */
function splitAuthors(authors: string): string[] {
  return (authors || '')
    .replace(/\bet al\.?/gi, '')
    .split(',')
    .map(a => a.trim())
    .filter(Boolean)
}

/** Extract a bare DOI from a URL/source string, if present. */
function extractDoi(source: string): string | null {
  const m = (source || '').match(/10\.\d{4,9}\/[^\s"<>]+/)
  return m ? m[0].replace(/[.,;)]+$/, '') : null
}

// ── BibTeX ────────────────────────────────────────────────────────────────────

function bibKey(paper: ResultCard, used: Set<string>): string {
  const first = splitAuthors(paper.authors)[0] || 'anon'
  const surname = first.split(/\s+/).pop() || 'anon'
  const word = (paper.title.match(/[A-Za-z]{4,}/) || ['ref'])[0].toLowerCase()
  const key = `${surname.toLowerCase().replace(/[^a-z]/g, '')}${paper.year || ''}${word}`
  let candidate = key
  let n = 1
  while (used.has(candidate)) candidate = `${key}${String.fromCharCode(96 + ++n)}`
  used.add(candidate)
  return candidate
}

function bibField(name: string, value: string): string {
  const clean = (value || '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
  return clean ? `  ${name} = {${clean}},\n` : ''
}

export function exportBibTeX(state: AppState): void {
  const used = new Set<string>()
  const entries = citablePapers(state).map(p => {
    const key = bibKey(p, used)
    const authors = splitAuthors(p.authors).join(' and ')
    const doi = extractDoi(p.source)
    let e = `@article{${key},\n`
    e += bibField('title', p.title)
    e += bibField('author', authors)
    if (p.year) e += `  year = {${p.year}},\n`
    e += bibField('abstract', p.abstract)
    if (doi) e += bibField('doi', doi)
    else if (/^https?:\/\//.test(p.source)) e += bibField('url', p.source)
    e += bibField('note', p.notes)
    e += '}\n'
    return e
  })
  downloadText(`${safeBase(state)}.bib`, 'application/x-bibtex', entries.join('\n'))
}

// ── RIS ───────────────────────────────────────────────────────────────────────

export function exportRIS(state: AppState): void {
  const chunks = citablePapers(state).map(p => {
    const lines = ['TY  - JOUR', `TI  - ${p.title}`]
    for (const a of splitAuthors(p.authors)) lines.push(`AU  - ${a}`)
    if (p.year) lines.push(`PY  - ${p.year}`)
    if (p.abstract) lines.push(`AB  - ${p.abstract.replace(/\s+/g, ' ').trim()}`)
    const doi = extractDoi(p.source)
    if (doi) lines.push(`DO  - ${doi}`)
    if (/^https?:\/\//.test(p.source)) lines.push(`UR  - ${p.source}`)
    if (p.notes) lines.push(`N1  - ${p.notes.replace(/\s+/g, ' ').trim()}`)
    lines.push('ER  - ')
    return lines.join('\r\n')
  })
  downloadText(`${safeBase(state)}.ris`, 'application/x-research-info-systems', chunks.join('\r\n\r\n') + '\r\n')
}

// ── CSV (literature matrix) ───────────────────────────────────────────────────

function csvCell(value: string): string {
  const v = value ?? ''
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map(r => r.map(csvCell).join(','))
  // Prepend a UTF-8 BOM so Excel opens accented characters correctly.
  return '﻿' + lines.join('\r\n')
}

export function exportMatrixCSV(state: AppState): void {
  const cols = state.matrixColumns
  // Values stay clean for analysis; verification gets its own columns so a
  // reader can filter to what the reviewer has checked.
  const headers = ['Title', 'Authors', 'Year', ...cols, 'Cells verified', 'Awaiting verification']
  const rows = state.matrixRows.map(row => {
    const held = cols.filter(c => row.cells[c])
    const unverified = held.filter(c => !row.cells[c].verifiedByStudent)
    return [
      row.title,
      row.authors,
      String(row.year || ''),
      ...cols.map(c => row.cells[c]?.value ?? ''),
      `${held.length - unverified.length}/${held.length}`,
      unverified.join('; '),
    ]
  })
  downloadText(`${safeBase(state)}_matrix.csv`, 'text/csv', toCsv(headers, rows))
}

// ── PRISMA flow data ──────────────────────────────────────────────────────────
// Screening funnel derived from the tool's own data, in the PRISMA 2020 shape.

export function exportPrismaCSV(state: AppState): void {
  // PRISMA separates the two identification pathways, so database searching and
  // citation chasing are reported as their own lines.
  // Imported records are database searching too, but they are counted on their
  // own lines below: a reader has to be able to tell what this tool retrieved
  // from what a reviewer searched elsewhere and carried in.
  const fromSearch = state.results.filter(r => {
    const origin = r.origin ?? 'search'
    return origin !== 'snowball' && origin !== 'import' && origin !== 'web'
  }).length
  // PRISMA's second identification pathway. A page found by web search is not a
  // database record, and adding it to the database line would misstate both
  // that line and the duplicate figure derived against it.
  const fromWeb = state.results.filter(r => r.origin === 'web').length
  const imports = importedSearches(state)
  const importIdentified = totalImported(imports)
  const importAdded = imports.reduce((n, i) => n + i.recordsAdded, 0)
  // Duplicates are derived against the database-search corpus only —
  // snowballed and uploaded papers were never counted as retrieved.
  const searchHeld = state.results.filter(r => (r.origin ?? 'search') === 'search').length
  const fromSnowball = state.results.filter(r => r.origin === 'snowball').length
  const identifiedTotal = totalIdentified(state.screening)
  const duplicates = duplicatesRemoved(state.screening, searchHeld)
  const retrieved = state.results.length
  const excludedPapers = state.results.filter(r => r.status === 'excluded')
  const inReview = state.reviewList.length
  const included = state.reviewList.filter(r => r.status === 'included').length

  const rows: string[][] = [
    ['Records identified — database searching (total hits reported)', String(identifiedTotal)],
    ['Records retrieved into the review tool — database searching', String(fromSearch)],
    ['Records identified — databases searched outside the tool (imported files)', String(importIdentified)],
    ['Records added to the review — imported files', String(importAdded)],
    ['Duplicate records removed — imported files', String(importIdentified - importAdded)],
    ['Records identified — citation searching (snowballing)', String(fromSnowball)],
    ['Records identified — websites and organisations (grey literature)', String(fromWeb)],
    ['Duplicate records removed before screening', String(duplicates)],
    ['Records screened', String(retrieved)],
    ['Records excluded (with reasons, itemised below)', String(excludedPapers.length)],
    ['Reports assessed for eligibility (added to review list)', String(inReview)],
    ['Studies included in review', String(included)],
  ]

  // "Excluded, with reasons" — the breakdown journals require, which the tool
  // can only produce because every exclusion had to name a criterion.
  const byReason = new Map<string, number>()
  for (const p of excludedPapers) {
    const label = p.exclusionReasonId
      ? state.criteria.find(c => c.id === p.exclusionReasonId)?.label ?? 'Reason no longer defined'
      : 'Did not meet inclusion criteria'
    byReason.set(label, (byReason.get(label) ?? 0) + 1)
  }
  if (byReason.size > 0) {
    rows.push(['', ''])
    rows.push(['Excluded — reason', 'Count'])
    for (const [label, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
      rows.push([`  ${label}`, String(n)])
    }
  }

  // Identification has to be reportable per database, and for imported sets the
  // database is only knowable from what the reviewer said at import time.
  if (imports.length > 0) {
    const byDatabase = new Map<string, number>()
    for (const i of imports) {
      byDatabase.set(i.database, (byDatabase.get(i.database) ?? 0) + i.recordsInFile)
    }
    rows.push(['', ''])
    rows.push(['Imported — records identified per database', 'Count'])
    for (const [database, n] of [...byDatabase].sort((a, b) => b[1] - a[1])) {
      rows.push([`  ${database}`, String(n)])
    }
  }

  // The eligibility criteria the screening was carried out against.
  if (state.criteria.length > 0) {
    rows.push(['', ''])
    rows.push(['Eligibility criteria', 'Type'])
    for (const c of state.criteria) {
      rows.push([`  ${c.label}`, c.kind])
    }
  }

  downloadText(`${safeBase(state)}_prisma_flow.csv`, 'text/csv', toCsv(['PRISMA stage', 'Count'], rows))
}

// ── Search strategy appendix ──────────────────────────────────────────────────
//
// PRISMA 2020 item 7: "Present the full search strategies for all databases,
// registers and websites, including any filters and limits used." Journals
// expect this as an appendix, and a review that cannot produce it is not
// reproducible — a reader has no way to tell whether a different result set
// would have been retrieved.
//
// Everything here is recorded at search time rather than reconstructed, because
// the query the user typed is not the query that ran: OpenAlex has no boolean
// syntax, and PubMed carries the date/language/access limits as query terms.

/** Human-readable rendering of the limits in force for one run. */
function describeFilters(filters: SearchFilters | undefined): string {
  if (!filters) return 'None recorded'
  const parts: string[] = []
  if (filters.yearFrom !== null || filters.yearTo !== null) {
    parts.push(`Years ${filters.yearFrom ?? 'any'}–${filters.yearTo ?? 'any'}`)
  }
  if (filters.openAccessOnly) parts.push('Open access only')
  if (filters.excludePreprints) parts.push('Preprints excluded')
  if (filters.language) parts.push(`Language: ${filters.language}`)
  return parts.length > 0 ? parts.join('; ') : 'None'
}

export function exportSearchStrategyCSV(state: AppState): void {
  const rows: string[][] = []

  // Only queries that were actually executed can be reported; an unrun draft
  // has no strategy, no date and no hit count to give.
  const executed = state.queries.filter(q => q.lastRunAt)

  for (const query of executed) {
    const topic = state.topics.find(t => t.id === query.topicId)
    rows.push([`Query ${query.queryN}`, topic?.title ?? '—', '', '', ''])
    rows.push(['  As entered by the reviewer', query.text, '', '', ''])
    rows.push(['  Limits applied', describeFilters(query.lastRunFilters), '', '', ''])
    rows.push([
      '  Date last run',
      query.lastRunAt ? new Date(query.lastRunAt).toISOString().slice(0, 10) : '—',
      '', '', '',
    ])

    for (const sq of query.sourceQueries ?? []) {
      rows.push(['  Database', sq.source, 'Strategy as run', sq.queryAsRun, `${sq.hits} hits`])
    }

    const retrieved = state.screening.retrievedByQuery?.[query.id]
    if (retrieved !== undefined) {
      rows.push(['  Records retrieved into the review', String(retrieved), '', '', ''])
    }
    rows.push(['', '', '', '', ''])
  }

  // A search run in another database's interface is no less part of the strategy
  // for having been executed outside this tool — PRISMA item 7 asks for all of
  // them, and a review whose Scopus arm is undocumented is not reproducible.
  for (const imported of importedSearches(state)) {
    rows.push([`Imported — ${imported.database}`, imported.filename, '', '', ''])
    rows.push(['  Strategy as run in that database', imported.queryAsRun || 'Not recorded', '', '', ''])
    rows.push(['  Date searched', imported.searchedAt || '—', '', '', ''])
    rows.push(['  Records in file', String(imported.recordsInFile), 'Format', imported.format.toUpperCase(), ''])
    rows.push(['  Records new to this review', String(imported.recordsAdded), '', '', ''])
    if (imported.recordsUnreadable > 0) {
      rows.push(['  Entries the file carried that could not be read', String(imported.recordsUnreadable), '', '', ''])
    }
    rows.push(['', '', '', '', ''])
  }

  if (rows.length === 0) {
    rows.push(['No searches have been run yet.', '', '', '', ''])
  } else {
    rows.push(['Total records identified across all queries', String(totalIdentified(state.screening)), '', '', ''])
    const imported = totalImported(importedSearches(state))
    if (imported > 0) {
      rows.push(['Total records identified in imported files', String(imported), '', '', ''])
    }
  }

  downloadText(
    `${safeBase(state)}_search_strategy.csv`,
    'text/csv',
    toCsv(['Item', 'Value', 'Field', 'Detail', 'Count'], rows),
  )
}

// ── Risk of bias ──────────────────────────────────────────────────────────────
//
// A "risk of bias table" is an expected element of a systematic review report,
// and reviewers read it before they read the findings. The export deliberately
// records who made each judgement: an appraisal drafted by a model and never
// confirmed by a human is not an appraisal the review can claim to have done,
// and hiding that distinction in an export would be the most consequential
// thing this tool could get wrong.

export function exportRiskOfBiasCSV(state: AppState, tool: RobTool): void {
  const byPaper = new Map(state.robAssessments.map(a => [a.paperId, a]))
  const judgementLabel = (value: string) =>
    tool.judgements.find(j => j.value === value)?.label ?? value

  const headers = [
    'Study', 'Year',
    ...tool.domains.map(d => d.label + (d.critical ? ' (critical)' : '')),
    'Overall', 'Confirmed by reviewer',
  ]

  const rows = state.reviewList.map(paper => {
    const assessment = byPaper.get(paper.id)
    if (!assessment) {
      return [
        paper.title, String(paper.year || ''),
        ...tool.domains.map(() => 'Not appraised'),
        'Not appraised', 'n/a',
      ]
    }
    const results = tool.domains.map(d => assessment.domains[d.id])
    const confirmed = results.filter(r => r && (!r.aiGenerated || r.verifiedByStudent)).length
    return [
      paper.title, String(paper.year || ''),
      ...results.map(r => (r ? judgementLabel(r.judgement) : '—')),
      judgementLabel(assessment.overall) || assessment.overall || '—',
      `${confirmed} of ${tool.domains.length}`,
    ]
  })

  rows.push(new Array(headers.length).fill(''))
  rows.push(['Instrument', tool.fullName, ...new Array(headers.length - 2).fill('')])
  rows.push(['Reference', tool.reference, ...new Array(headers.length - 2).fill('')])
  // The links, so a reader of the export can check the criteria the judgements
  // were made against rather than taking the instrument's name on trust.
  if (tool.referenceUrl) {
    rows.push(['Reference URL', tool.referenceUrl, ...new Array(headers.length - 2).fill('')])
  }
  if (tool.toolUrl) {
    rows.push(['Instrument guidance', tool.toolUrl, ...new Array(headers.length - 2).fill('')])
  }
  rows.push(['Overall rule', tool.overallRule, ...new Array(headers.length - 2).fill('')])

  // Per-domain rationales, which are the part a reader actually weighs.
  const withRationale = state.reviewList.filter(p => byPaper.has(p.id))
  if (withRationale.length > 0) {
    rows.push(new Array(headers.length).fill(''))
    rows.push(['Study', 'Domain', 'Judgement', 'Rationale', ...new Array(headers.length - 4).fill('')])
    for (const paper of withRationale) {
      const assessment = byPaper.get(paper.id)!
      for (const domain of tool.domains) {
        const result = assessment.domains[domain.id]
        if (!result) continue
        rows.push([
          paper.title, domain.label, judgementLabel(result.judgement), result.rationale || '—',
          ...new Array(headers.length - 4).fill(''),
        ])
      }
    }
  }

  downloadText(`${safeBase(state)}_risk_of_bias.csv`, 'text/csv', toCsv(headers, rows))
}
