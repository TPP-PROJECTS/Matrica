import type { AppState, ResultCard } from '../types'

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
  let key = `${surname.toLowerCase().replace(/[^a-z]/g, '')}${paper.year || ''}${word}`
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
  const headers = ['Title', 'Authors', 'Year', ...cols]
  const rows = state.matrixRows.map(row => [
    row.title,
    row.authors,
    String(row.year || ''),
    ...cols.map(c => row.cells[c]?.value ?? ''),
  ])
  downloadText(`${safeBase(state)}_matrix.csv`, 'text/csv', toCsv(headers, rows))
}

// ── PRISMA flow data ──────────────────────────────────────────────────────────
// Screening funnel derived from the tool's own data, in the PRISMA 2020 shape.

export function exportPrismaCSV(state: AppState): void {
  const identified = state.results.length
  const duplicates = state.results.filter(r => r.isDuplicate).length
  const screened = identified - duplicates
  const inReview = state.reviewList.length
  const excluded = Math.max(screened - inReview, 0)
  const included = state.reviewList.filter(r => r.status === 'included').length

  const rows: string[][] = [
    ['Records identified through database searching', String(identified)],
    ['Duplicate records removed', String(duplicates)],
    ['Records screened', String(screened)],
    ['Records excluded', String(excluded)],
    ['Reports assessed (added to review list)', String(inReview)],
    ['Studies included in review', String(included)],
  ]
  downloadText(`${safeBase(state)}_prisma_flow.csv`, 'text/csv', toCsv(['PRISMA stage', 'Count'], rows))
}
