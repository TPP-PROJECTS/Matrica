import { useRef, useState } from 'react'
import { useApp } from '../../store/AppContext'
import { parseReferenceFile, type ImportedRecord, type ParsedImport } from '../../lib/importRecords'
import { scorePaperRelevance } from '../../lib/scorePaper'
import { runPool } from '../../lib/runPool'
import { newId } from '../../lib/ids'
import type { ResultCard } from '../../types'

/** Databases users most often have to search outside this tool. */
const COMMON_DATABASES = [
  'Scopus', 'Web of Science', 'Embase', 'CINAHL', 'PsycINFO',
  'Cochrane Library', 'ERIC', 'IEEE Xplore', 'ACM Digital Library',
  'ProQuest', 'Google Scholar',
]

/** Relevance scoring costs one call per record, so it is bounded and opt-in. */
const SCORE_CONCURRENCY = 4
const SCORE_BY_DEFAULT_UP_TO = 50

function toCard(record: ImportedRecord, database: string): ResultCard {
  // `source` is the field the rest of the tool reads a DOI out of — for
  // de-duplication, for the BibTeX/RIS re-export, and for full-text lookup — so
  // the DOI form wins over a database's own permalink where both exist.
  const source = record.doi ? `https://doi.org/${record.doi}` : record.url
  const authors = record.authors.length > 3
    ? `${record.authors.slice(0, 3).join(', ')} et al.`
    : record.authors.join(', ')

  return {
    id: newId('imp'),
    title: record.title,
    authors,
    year: record.year,
    source,
    relevanceScore: 0,
    abstract: record.abstract,
    topicId: '',
    queryId: 'import',
    confidence: 'none',
    isDuplicate: false,
    status: null,
    notes: '',
    origin: 'import',
    importedFrom: database,
  }
}

export function ImportRecordsModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [database, setDatabase] = useState('')
  const [queryAsRun, setQueryAsRun] = useState('')
  const [searchedAt, setSearchedAt] = useState(new Date().toISOString().slice(0, 10))
  const [score, setScore] = useState(true)

  const [importing, setImporting] = useState(false)
  const [scored, setScored] = useState(0)

  async function handleFile(files: FileList | null) {
    const picked = files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!picked) return
    setFile(picked); setParsed(null); setError(null)
    try {
      const result = parseReferenceFile(await picked.text())
      if (result.records.length === 0) {
        throw new Error(`No readable records in this ${result.format.toUpperCase()} file.`)
      }
      setParsed(result)
      setScore(result.records.length <= SCORE_BY_DEFAULT_UP_TO)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file')
    }
  }

  async function handleImport() {
    if (!parsed || !file || !database.trim() || importing) return
    setImporting(true)

    const cards = parsed.records.map(r => toCard(r, database.trim()))
    dispatch({
      type: 'IMPORT_RECORDS',
      papers: cards,
      search: {
        id: newId('imp-search'),
        database: database.trim(),
        queryAsRun: queryAsRun.trim(),
        searchedAt,
        recordsInFile: parsed.records.length,
        recordsUnreadable: parsed.skipped,
        importedAt: new Date().toISOString(),
        format: parsed.format,
        filename: file.name,
      },
    })

    if (score) {
      setScored(0)
      await runPool(cards, SCORE_CONCURRENCY,
        card => scorePaperRelevance(card, state.profile, dispatch),
        { onProgress: n => setScored(n) },
      )
    }
    onClose()
  }

  const records = parsed?.records ?? []
  const ready = records.length > 0 && database.trim().length > 0

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={importing ? undefined : onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[560px] flex flex-col" style={{ maxHeight: '86vh' }} onClick={e => e.stopPropagation()}>

        <div className="px-5 pt-4 pb-3 border-b border-zinc-200 shrink-0">
          <div className="flex items-start justify-between">
            <div className="mr-4">
              <h2 className="text-[14px] font-bold text-zinc-950">Import records (RIS / BibTeX)</h2>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Search Scopus, Web of Science, Embase or any other database in its own interface,
                export the results, and bring them in here to be de-duplicated and screened with the rest.
              </p>
            </div>
            <button onClick={onClose} disabled={importing} className="text-zinc-400 hover:text-zinc-700 text-[18px] leading-none shrink-0 disabled:opacity-40">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* ── The file ── */}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".ris,.bib,.bibtex,.txt,.nbib"
              className="hidden"
              onChange={e => void handleFile(e.target.files)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              className="w-full h-16 border-2 border-dashed border-zinc-300 rounded-lg text-[12px] text-zinc-500 hover:border-purple-400 hover:text-purple-600 transition-colors disabled:opacity-50"
            >
              {file ? `📄 ${file.name}` : '⬆ Choose a .ris or .bib export file'}
            </button>
            {error && <p className="text-[11px] text-red-600 mt-1.5">{error}</p>}
            {parsed && (
              <p className="text-[11px] text-zinc-600 mt-1.5">
                <span className="font-semibold text-emerald-700">{records.length} record{records.length === 1 ? '' : 's'}</span>
                {' '}read as {parsed.format.toUpperCase()}
                {parsed.skipped > 0 && (
                  <span className="text-amber-700">
                    {' · '}{parsed.skipped} {parsed.skipped === 1 ? 'entry had' : 'entries had'} no title and {parsed.skipped === 1 ? 'was' : 'were'} skipped
                  </span>
                )}
              </p>
            )}
          </div>

          {/* ── What a reader needs to reproduce this arm of the search ── */}
          {parsed && (
            <>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-zinc-700">Database searched</label>
                <input
                  value={database}
                  onChange={e => setDatabase(e.target.value)}
                  list="import-databases"
                  placeholder="e.g. Scopus"
                  className="w-full h-8 border border-zinc-300 rounded px-2 text-[12px] text-zinc-900 outline-none focus:border-purple-500"
                />
                <datalist id="import-databases">
                  {COMMON_DATABASES.map(d => <option key={d} value={d} />)}
                </datalist>
                <p className="text-[10px] text-zinc-400">
                  Required. An export file does not reliably say which database it came from, and identification has to be reported per database.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-zinc-700">Search strategy as run there</label>
                <textarea
                  value={queryAsRun}
                  onChange={e => setQueryAsRun(e.target.value)}
                  rows={3}
                  placeholder={'TITLE-ABS-KEY ( sepsis AND "machine learning" ) AND PUBYEAR > 2014'}
                  className="w-full border border-zinc-300 rounded px-2 py-1.5 text-[11px] font-mono text-zinc-800 outline-none focus:border-purple-500 resize-none"
                />
                <p className="text-[10px] text-zinc-400">
                  Paste it from that database's search history. PRISMA item 7 asks for the full strategy for every database — without it, this arm of the review is not reproducible.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-zinc-700">Date the search was run</label>
                <input
                  type="date"
                  value={searchedAt}
                  onChange={e => setSearchedAt(e.target.value)}
                  className="h-8 border border-zinc-300 rounded px-2 text-[12px] text-zinc-900 outline-none focus:border-purple-500"
                />
                <p className="text-[10px] text-zinc-400">The date it was run in that database, not the date of this import.</p>
              </div>

              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={score} onChange={e => setScore(e.target.checked)} className="mt-0.5" />
                <span className="text-[11px] text-zinc-700">
                  Assess relevance on import
                  <span className="text-zinc-400"> — one AI call per record ({records.length} total). Leave this off to import now and use Auto-screen instead.</span>
                </span>
              </label>

              {/* ── A look at what is about to enter the review ── */}
              <div>
                <p className="text-[11px] font-semibold text-zinc-700 mb-1">Preview</p>
                <ul className="border border-zinc-200 rounded divide-y divide-zinc-100 max-h-[150px] overflow-y-auto">
                  {records.slice(0, 8).map((r, i) => (
                    <li key={i} className="px-2 py-1.5">
                      <p className="text-[11px] text-zinc-800 leading-tight line-clamp-2">{r.title}</p>
                      <p className="text-[10px] text-zinc-400">
                        {r.authors.slice(0, 3).join(', ') || 'No authors in record'}
                        {r.year ? ` · ${r.year}` : ''}
                        {r.doi ? ` · ${r.doi}` : ''}
                        {!r.abstract && <span className="text-amber-600"> · no abstract</span>}
                      </p>
                    </li>
                  ))}
                </ul>
                {records.length > 8 && (
                  <p className="text-[10px] text-zinc-400 mt-1">and {records.length - 8} more</p>
                )}
                {records.some(r => !r.abstract) && (
                  <p className="text-[10px] text-amber-700 mt-1">
                    {records.filter(r => !r.abstract).length} record{records.filter(r => !r.abstract).length === 1 ? ' has' : 's have'} no abstract.
                    Screening reads the abstract, so these will come back as uncertain and need a human decision.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-200 shrink-0">
          <span className="text-[10px] text-zinc-400 flex-1">
            {importing && score ? `Assessing relevance ${scored}/${records.length}…` : ''}
          </span>
          <button onClick={onClose} disabled={importing} className="px-3 h-7 border border-zinc-300 rounded text-[11px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40">
            Cancel
          </button>
          <button
            onClick={() => void handleImport()}
            disabled={!ready || importing}
            className="px-3 h-7 bg-purple-600 text-white rounded text-[11px] font-medium hover:bg-purple-700 disabled:opacity-40 flex items-center gap-1.5"
          >
            {importing && <span className="w-2.5 h-2.5 border border-purple-300 border-t-white rounded-full animate-spin" />}
            Import {records.length > 0 ? records.length : ''} record{records.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}
