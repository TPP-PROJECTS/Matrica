/**
 * RIS and BibTeX import.
 *
 * This tool searches OpenAlex and PubMed. A review that has to satisfy a peer
 * reviewer will usually also have to search Scopus, Web of Science, Embase,
 * CINAHL or PsycINFO, and none of those has a free API this tool could call.
 * What every one of them does have is an export button, and RIS or BibTeX is
 * what comes out of it.
 *
 * Parsing those files here is what lets records from any database enter the
 * same de-duplication, screening and PRISMA accounting as the records this tool
 * retrieved itself. The alternative — a review whose Scopus arm is screened in
 * a spreadsheet on the side — is where the reported counts stop reconciling.
 *
 * Both parsers are deliberately tolerant. An export file is written by someone
 * else's software against a loosely-followed convention, so one malformed entry
 * in three hundred should cost the user that entry, not the import.
 */

/** One bibliographic record, before it becomes a paper in the review. */
export interface ImportedRecord {
  title: string
  /** Authors in citation order, each already normalised to "First Last". */
  authors: string[]
  year: number
  abstract: string
  doi: string
  url: string
  journal: string
  /** The source format's own type tag ("JOUR", "article"), for reporting. */
  entryType: string
}

export type ReferenceFormat = 'ris' | 'bibtex'

export interface ParsedImport {
  format: ReferenceFormat
  records: ImportedRecord[]
  /** Entries present in the file that carried no usable title. */
  skipped: number
}

// ── Shared normalisation ──────────────────────────────────────────────────────

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * "Smith, John A." → "John A. Smith".
 *
 * Databases export surname-first; the rest of this tool renders and re-exports
 * authors as a comma-separated display string, so a surname-first name would be
 * split back into two people the next time it is read.
 */
export function normaliseAuthor(raw: string): string {
  const name = squash(raw)
  if (!name) return ''
  // Only the first comma is the surname/given-name boundary; anything after it
  // (a "Jr.", a second set of initials) stays with the given names, which is
  // the reading that leaves a name recognisable when the convention is unclear.
  const comma = name.indexOf(',')
  if (comma === -1) return name
  const surname = name.slice(0, comma).trim()
  const given = name.slice(comma + 1).trim()
  if (!given || !surname) return name.replace(',', ' ').trim()
  return `${given} ${surname}`
}

/** First plausible publication year in a date string ("2020///", "2020-05"). */
export function parseYear(raw: string): number {
  for (const match of squash(raw).matchAll(/\d{4}/g)) {
    const year = Number(match[0])
    if (year >= 1500 && year <= 2100) return year
  }
  return 0
}

/** A bare DOI, however the field wrapped it. */
function cleanDoi(raw: string): string {
  // The character class stops at the delimiters a DOI may be wrapped in, so a
  // BibTeX `{...}` or a `\url{...}` does not leave its closing brace attached.
  const match = squash(raw).match(/10\.\d{4,9}\/[^\s"'<>{}]+/)
  return match ? match[0].replace(/[.,;)]+$/, '') : ''
}

/** A URL freed from a `\url{}` wrapper and any delimiters left around it. */
function cleanUrl(raw: string): string {
  return squash(raw.replace(/\\url\s*\{([^}]*)\}/g, '$1')).replace(/^[{"']+|[}"']+$/g, '')
}

// ── RIS ───────────────────────────────────────────────────────────────────────

// `TY  - JOUR`: a two-to-four character tag, spaces, a hyphen, then the value.
// Anything that does not match is a continuation of the field above it, which
// is how long abstracts are wrapped by most exporters.
const RIS_LINE = /^([A-Z][A-Z0-9]{1,3})\s{1,3}-\s?(.*)$/

/** Tags that carry the same meaning, best first. */
const RIS_FIELDS = {
  title: ['TI', 'T1', 'TT', 'BT'],
  abstract: ['AB', 'N2'],
  year: ['PY', 'Y1', 'DA'],
  doi: ['DO', 'DI'],
  url: ['UR'],
  journal: ['JO', 'JF', 'J2', 'T2'],
} as const

function firstOf(fields: Record<string, string[]>, tags: readonly string[]): string {
  for (const tag of tags) {
    const values = fields[tag]
    if (values && values.length > 0 && values[0].trim()) return squash(values[0])
  }
  return ''
}

function risRecord(fields: Record<string, string[]>): ImportedRecord | null {
  const title = firstOf(fields, RIS_FIELDS.title)
  if (!title) return null
  // AU is the standard author tag; A1 is the older primary-author tag. A2 and
  // below are editors and secondary contributors, so they are left out.
  const authors = [...(fields.AU ?? []), ...(fields.A1 ?? [])]
    .map(normaliseAuthor)
    .filter(Boolean)
  const url = firstOf(fields, RIS_FIELDS.url)
  return {
    title,
    authors,
    year: parseYear(firstOf(fields, RIS_FIELDS.year)),
    abstract: firstOf(fields, RIS_FIELDS.abstract),
    doi: cleanDoi(firstOf(fields, RIS_FIELDS.doi) || url),
    url,
    journal: firstOf(fields, RIS_FIELDS.journal),
    entryType: firstOf(fields, ['TY']),
  }
}

export function parseRis(text: string): { records: ImportedRecord[]; skipped: number } {
  const records: ImportedRecord[] = []
  let skipped = 0
  let fields: Record<string, string[]> | null = null
  let lastTag = ''

  const flush = () => {
    if (!fields) return
    const record = risRecord(fields)
    if (record) records.push(record)
    else skipped++
    fields = null
    lastTag = ''
  }

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const match = rawLine.match(RIS_LINE)
    if (!match) {
      // A wrapped continuation line. Ignore anything before the first record —
      // exporters put headers and blank lines there.
      const continuation = rawLine.trim()
      if (fields && lastTag && continuation) {
        const held = fields[lastTag]
        held[held.length - 1] = `${held[held.length - 1]} ${continuation}`
      }
      continue
    }
    const [, tag, value] = match
    if (tag === 'ER') { flush(); continue }
    // A new TY before the previous ER: the file omitted the terminator, which
    // is common enough that dropping every record but the last would be a poor
    // way to find out.
    if (tag === 'TY') flush()
    if (!fields) fields = {}
    ;(fields[tag] ??= []).push(value)
    lastTag = tag
  }
  flush()   // an unterminated final record is still a record

  return { records, skipped }
}

// ── BibTeX ────────────────────────────────────────────────────────────────────

// Accents are written as a command plus a letter (`\'e`, `\"{o}`, `{\c c}`).
// Mapping the command to its Unicode combining mark and normalising rebuilds
// the real character, rather than dropping the accent and misspelling a name.
const COMBINING: Record<string, string> = {
  "'": '́', '`': '̀', '"': '̈', '^': '̂', '~': '̃',
  '=': '̄', '.': '̇', 'v': '̌', 'u': '̆', 'H': '̋',
  'c': '̧', 'k': '̨', 'r': '̊', 'd': '̣', 'b': '̱',
}

/** Commands that stand for a letter in their own right. */
const LATEX_LETTERS: Record<string, string> = {
  o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', ss: 'ß', ae: 'æ', AE: 'Æ',
  aa: 'å', AA: 'Å', oe: 'œ', OE: 'Œ', i: 'i', j: 'j',
}

/** Plain text from a BibTeX field value. */
export function deLatex(raw: string): string {
  let text = raw

  const applyAccent = (whole: string, accent: string, braced?: string, bare?: string) => {
    let letter = braced ?? bare ?? ''
    if (letter.startsWith('\\')) letter = LATEX_LETTERS[letter.slice(1)] ?? ''
    if (!letter) return whole
    return (letter + COMBINING[accent]).normalize('NFC')
  }

  // Punctuation accents (\"o, \'e, \~n) cannot begin a longer command name, so
  // the letter they mark is free to be followed by the rest of its word.
  text = text.replace(
    /\\(['`"^~=.])\s*(?:\{\s*(\\?[a-zA-Z]{1,2})\s*\}|(\\?[a-zA-Z]))/g,
    applyAccent,
  )

  // Letter accents (\c c, \v{s}) are ambiguous with real commands: `\url{...}`
  // would otherwise read as a breve over an "r" and swallow the URL after it.
  // Unbraced, they count as an accent only when no more of a word follows.
  text = text.replace(
    /\\([vuHckrdb])\s*(?:\{\s*(\\?[a-zA-Z]{1,2})\s*\}|(\\?[a-zA-Z])(?![a-zA-Z]))/g,
    applyAccent,
  )

  // Standalone letter commands, longest name first so \AE beats \A.
  for (const name of Object.keys(LATEX_LETTERS).sort((a, b) => b.length - a.length)) {
    text = text.replace(new RegExp(`\\\\${name}(\\{\\}|\\b)`, 'g'), LATEX_LETTERS[name])
  }

  text = text
    .replace(/\\([&%$#_{}])/g, '$1')      // escaped punctuation
    .replace(/\\[a-zA-Z]+\s*/g, '')       // any remaining command
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/[{}]/g, '')
    .replace(/~/g, ' ')

  return squash(text)
}

/**
 * Read one brace- or quote-delimited value starting at `start`, returning the
 * value and the index just past it. Nested braces are what a naive split on
 * commas gets wrong: `title = {A study of {Ca}{2+} uptake}` is one field.
 */
function readValue(text: string, start: number): { value: string; end: number } {
  let i = start
  while (i < text.length && /\s/.test(text[i])) i++

  if (text[i] === '{' || text[i] === '"') {
    const open = text[i]
    const close = open === '{' ? '}' : '"'
    let depth = 0
    const from = i + 1
    for (; i < text.length; i++) {
      const ch = text[i]
      if (ch === '\\') { i++; continue }              // an escaped delimiter is data
      if (open === '{') {
        if (ch === '{') depth++
        else if (ch === '}' && --depth === 0) return { value: text.slice(from, i), end: i + 1 }
      } else if (i > from - 1 && ch === close && text[i - 1] !== '\\') {
        return { value: text.slice(from, i), end: i + 1 }
      }
    }
    return { value: text.slice(from), end: text.length }   // unterminated
  }

  // A bare value: a number, or a @string macro name we cannot resolve.
  const rest = text.slice(i)
  const match = rest.match(/^[^,}]*/)
  const value = match ? match[0] : ''
  return { value: value.trim(), end: i + value.length }
}

function bibtexRecord(entryType: string, body: string): ImportedRecord | null {
  const fields: Record<string, string> = {}
  let i = 0
  // Skip the citation key: everything up to the first comma.
  const firstComma = body.indexOf(',')
  if (firstComma !== -1) i = firstComma + 1

  while (i < body.length) {
    const rest = body.slice(i)
    const nameMatch = rest.match(/^\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*=/)
    if (!nameMatch) break
    const name = nameMatch[1].toLowerCase()
    const { value, end } = readValue(body, i + nameMatch[0].length)
    if (!(name in fields)) fields[name] = value
    i = end
    const comma = body.indexOf(',', i)
    if (comma === -1) break
    i = comma + 1
  }

  const title = deLatex(fields.title ?? '')
  if (!title) return null

  const authors = deLatex(fields.author ?? '')
    .split(/\s+and\s+/i)
    .map(normaliseAuthor)
    .filter(Boolean)

  const url = cleanUrl(fields.url ?? '')
  return {
    title,
    authors,
    year: parseYear(fields.year ?? fields.date ?? ''),
    abstract: deLatex(fields.abstract ?? ''),
    doi: cleanDoi(fields.doi ?? url),
    url,
    journal: deLatex(fields.journal ?? fields.journaltitle ?? fields.booktitle ?? ''),
    entryType,
  }
}

/** Entry types that hold no reference of their own. */
const BIBTEX_NON_ENTRIES = new Set(['comment', 'string', 'preamble'])

export function parseBibtex(text: string): { records: ImportedRecord[]; skipped: number } {
  const records: ImportedRecord[] = []
  let skipped = 0

  const entryStart = /@([a-zA-Z]+)\s*[{(]/g
  let match: RegExpExecArray | null
  while ((match = entryStart.exec(text)) !== null) {
    const entryType = match[1].toLowerCase()
    const openIndex = match.index + match[0].length - 1
    const close = text[openIndex] === '{' ? '}' : ')'
    // Walk to the matching close so a brace inside a title cannot end the entry.
    let depth = 0
    let end = text.length
    for (let i = openIndex; i < text.length; i++) {
      const ch = text[i]
      if (ch === '\\') { i++; continue }
      if (ch === text[openIndex]) depth++
      else if (ch === close && --depth === 0) { end = i; break }
    }
    const body = text.slice(openIndex + 1, end)
    entryStart.lastIndex = end

    if (BIBTEX_NON_ENTRIES.has(entryType)) continue
    const record = bibtexRecord(entryType, body)
    if (record) records.push(record)
    else skipped++
  }

  return { records, skipped }
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Which format a file is, from its content rather than its extension: exporters
 * disagree about extensions (`.txt`, `.bib`, `.ris`, `.nbib`) and users rename
 * downloads, but the two syntaxes are not mistakable for one another.
 */
export function detectFormat(text: string): ReferenceFormat | null {
  if (RIS_LINE.test(text.split(/\r\n|\r|\n/).find(l => l.trim()) ?? '')) return 'ris'
  if (/^\s*TY\s{1,3}-/m.test(text)) return 'ris'
  if (/@[a-zA-Z]+\s*[{(]/.test(text)) return 'bibtex'
  return null
}

export function parseReferenceFile(text: string): ParsedImport {
  // A leading byte-order mark would otherwise make the first tag unmatchable.
  const clean = text.replace(/^\uFEFF/, '')
  const format = detectFormat(clean)
  if (format === null) {
    throw new Error('Not a recognisable RIS or BibTeX file.')
  }
  const { records, skipped } = format === 'ris' ? parseRis(clean) : parseBibtex(clean)
  return { format, records, skipped }
}
