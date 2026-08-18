import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store/AppContext'
import { API, apiFetch } from '../lib/api'
import { runPool } from '../lib/runPool'
import { checkProvenance } from '../lib/provenance'
import { SourceProvenance } from '../components/shared/SourceProvenance'
import type { RobAssessment, RobTool, RobToolId, ResultCard } from '../types'

/**
 * Quality appraisal of the included studies.
 *
 * This is the step between "these studies are eligible" and "this is what the
 * evidence says", and skipping it is why a review gets asked how it can report
 * a confounded cohort study and a well-conducted trial as equal evidence.
 *
 * The AI drafts; the reviewer signs off. That split is enforced in the UI
 * rather than suggested: an unconfirmed judgement is visibly unconfirmed, and
 * the running count of what still needs review is always on screen. Most
 * domains will come back "no information" from an abstract alone, which is the
 * correct answer and is displayed as such rather than hidden.
 */

const TONE_STYLES: Record<string, string> = {
  good: 'bg-green-100 text-green-800 border-green-200',
  warn: 'bg-amber-100 text-amber-800 border-amber-200',
  bad: 'bg-red-100 text-red-800 border-red-200',
  unknown: 'bg-zinc-100 text-zinc-500 border-zinc-200',
}

function toneOf(tool: RobTool, judgement: string): string {
  return tool.judgements.find(j => j.value === judgement)?.tone ?? 'unknown'
}

function labelOf(tool: RobTool, judgement: string): string {
  return tool.judgements.find(j => j.value === judgement)?.label ?? '—'
}

// ── One domain row ────────────────────────────────────────────────────────────

function DomainRow({
  tool,
  domainId,
  paper,
  assessment,
}: {
  tool: RobTool
  domainId: string
  paper: ResultCard
  assessment: RobAssessment
}) {
  const { dispatch } = useApp()
  const [open, setOpen] = useState(false)
  const spec = tool.domains.find(d => d.id === domainId)!
  const result = assessment.domains[domainId]
  if (!result) return null

  const tone = toneOf(tool, result.judgement)
  const needsReview = result.aiGenerated && !result.verifiedByStudent
  const quoteVerdict = checkProvenance(paper.abstract ?? '', result.supportQuote)

  return (
    <div className={`border-b border-zinc-100 ${needsReview ? 'bg-amber-50/30' : ''}`}>
      <div className="flex items-start gap-2 px-3 py-2">
        <button
          onClick={() => setOpen(v => !v)}
          className="text-zinc-300 hover:text-zinc-600 text-[10px] mt-0.5 shrink-0 w-3"
          title={open ? 'Collapse' : 'Show the signalling question and evidence'}
        >
          {open ? '▾' : '▸'}
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-zinc-800 leading-snug">
            {spec.label}
            {spec.critical && (
              <span
                className="ml-1.5 text-[8px] font-bold text-red-600"
                title="A critical item: failing it lowers the review's overall confidence rating"
              >
                CRITICAL
              </span>
            )}
          </p>
          {result.rationale && (
            <p className="text-[10px] text-zinc-500 leading-snug mt-0.5">{result.rationale}</p>
          )}
          {quoteVerdict.kind === 'not_found' && (
            <p className="text-[9px] font-bold text-red-600 mt-0.5">
              ✕ supporting quote is not in the abstract
            </p>
          )}
        </div>

        <select
          value={result.judgement}
          onChange={e =>
            dispatch({
              type: 'UPDATE_ROB_DOMAIN',
              paperId: paper.id,
              domainId,
              judgement: e.target.value,
            })
          }
          className={`shrink-0 text-[10px] font-semibold border rounded px-1.5 py-1 outline-none ${TONE_STYLES[tone]}`}
        >
          {tool.judgements.map(j => (
            <option key={j.value} value={j.value}>{j.label}</option>
          ))}
        </select>

        {needsReview ? (
          <button
            onClick={() =>
              dispatch({ type: 'UPDATE_ROB_DOMAIN', paperId: paper.id, domainId, verifiedByStudent: true })
            }
            title="Confirm this judgement as your own"
            className="shrink-0 text-[9px] font-semibold px-1.5 py-1 rounded border border-amber-300 text-amber-800 hover:bg-amber-100"
          >
            Confirm
          </button>
        ) : (
          <span
            className="shrink-0 text-[9px] text-green-600 px-1.5 py-1"
            title={result.aiGenerated ? 'You confirmed this AI draft' : 'Your judgement'}
          >
            ✓
          </span>
        )}
      </div>

      {open && (
        <div className="px-3 pb-3 pl-8 space-y-2">
          <div>
            <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mb-1">
              Signalling question
            </p>
            <p className="text-[10px] text-zinc-600 leading-relaxed">{spec.question}</p>
          </div>
          <SourceProvenance sourceText={paper.abstract ?? ''} quote={result.supportQuote} />
          <div>
            <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mb-1">
              Your rationale
            </p>
            <textarea
              value={result.rationale}
              onChange={e =>
                dispatch({
                  type: 'UPDATE_ROB_DOMAIN',
                  paperId: paper.id,
                  domainId,
                  rationale: e.target.value,
                })
              }
              rows={2}
              placeholder="What in the paper drove this judgement?"
              className="w-full border border-zinc-200 rounded px-2 py-1.5 text-[10px] outline-none focus:border-blue-400 resize-none"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── One paper ─────────────────────────────────────────────────────────────────

function PaperAppraisal({
  tool,
  paper,
  assessment,
  onAssess,
  busy,
}: {
  tool: RobTool
  paper: ResultCard
  assessment: RobAssessment | undefined
  onAssess: () => void
  busy: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const unconfirmed = assessment
    ? Object.values(assessment.domains).filter(d => d.aiGenerated && !d.verifiedByStudent).length
    : 0
  const overallTone = assessment ? toneOf(tool, assessment.overall) : 'unknown'

  return (
    <div className="border border-zinc-200 rounded-lg mb-2 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50">
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-zinc-400 hover:text-zinc-700 text-[10px] shrink-0 w-3"
        >
          {expanded ? '▾' : '▸'}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-zinc-900 truncate">{paper.title}</p>
          <p className="text-[9px] text-zinc-400">{paper.authors} · {paper.year || '—'}</p>
        </div>

        {assessment ? (
          <>
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${TONE_STYLES[overallTone]}`}
              title={tool.overallRule}
            >
              {labelOf(tool, assessment.overall) !== '—'
                ? labelOf(tool, assessment.overall)
                : assessment.overall || 'Not rated'}
            </span>
            {unconfirmed > 0 && (
              <span className="text-[9px] font-semibold text-amber-700 shrink-0">
                {unconfirmed} to confirm
              </span>
            )}
          </>
        ) : (
          <button
            onClick={onAssess}
            disabled={busy}
            className="text-[10px] px-2 py-1 rounded border border-zinc-300 text-zinc-600 hover:border-zinc-500 disabled:opacity-50 shrink-0"
          >
            Assess
          </button>
        )}
      </div>

      {expanded && assessment && (
        <>
          {tool.domains.map(domain => (
            <DomainRow
              key={domain.id}
              tool={tool}
              domainId={domain.id}
              paper={paper}
              assessment={assessment}
            />
          ))}
          {assessment.overallRationale && (
            <div className="px-3 py-2 bg-zinc-50 border-t border-zinc-100">
              <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest mb-0.5">
                Overall
              </p>
              <p className="text-[10px] text-zinc-600 leading-snug">{assessment.overallRationale}</p>
            </div>
          )}
        </>
      )}

      {expanded && !assessment && (
        <p className="px-3 py-3 text-[10px] text-zinc-400 italic">
          Not yet appraised. Assessing drafts a judgement for each domain from the abstract, for
          you to confirm or change.
        </p>
      )}
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function RiskOfBiasPanel() {
  const { state, dispatch } = useApp()
  const [tools, setTools] = useState<RobTool[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    apiFetch(`${API}/rob/tools`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(data => { if (!cancelled) setTools(data.tools ?? []) })
      .catch(() => { if (!cancelled) setLoadError('Could not load the appraisal instruments.') })
    return () => { cancelled = true }
  }, [])

  const tool = useMemo(
    () => tools.find(t => t.id === state.robToolId) ?? null,
    [tools, state.robToolId],
  )
  const byPaper = useMemo(
    () => new Map(state.robAssessments.map(a => [a.paperId, a])),
    [state.robAssessments],
  )

  async function assessOne(paper: ResultCard, activeTool: RobTool): Promise<void> {
    const res = await apiFetch(`${API}/rob/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolId: activeTool.id,
        paper: {
          title: paper.title, abstract: paper.abstract ?? '',
          authors: paper.authors, year: paper.year || null,
        },
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()

    const domains: RobAssessment['domains'] = {}
    for (const d of data.domains ?? []) {
      domains[d.domainId] = {
        judgement: d.judgement,
        rationale: d.rationale ?? '',
        supportQuote: d.supportQuote ?? '',
        aiGenerated: true,
        verifiedByStudent: false,
      }
    }
    dispatch({
      type: 'SET_ROB_ASSESSMENT',
      assessment: {
        paperId: paper.id,
        toolId: activeTool.id as RobToolId,
        domains,
        overall: data.overall ?? '',
        overallRationale: data.overallRationale ?? '',
        assessedAt: new Date().toISOString(),
      },
    })
  }

  async function assessAll() {
    if (!tool || busy) return
    const pending = state.reviewList.filter(p => !byPaper.has(p.id))
    if (pending.length === 0) return
    setBusy(true)
    setProgress({ done: 0, total: pending.length })
    // Same bounded pool the matrix autofill uses: one call per paper, a few in
    // flight, and one failure never abandons the rest of the batch.
    await runPool(pending, 4, p => assessOne(p, tool), {
      onProgress: (done, total) => setProgress({ done, total }),
    })
    setBusy(false)
    setProgress(null)
  }

  const assessed = state.reviewList.filter(p => byPaper.has(p.id)).length
  const unconfirmed = state.robAssessments.reduce(
    (n, a) => n + Object.values(a.domains).filter(d => d.aiGenerated && !d.verifiedByStudent).length,
    0,
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Instrument picker */}
      <div className="px-4 py-3 border-b border-zinc-200 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-zinc-700">Appraisal instrument</span>
          <select
            value={state.robToolId ?? ''}
            onChange={e =>
              dispatch({ type: 'SET_ROB_TOOL', toolId: (e.target.value || null) as RobToolId | null })
            }
            className="h-7 border border-zinc-200 rounded px-2 text-[11px] outline-none focus:border-blue-400"
          >
            <option value="">None selected</option>
            {tools.map(t => (
              <option key={t.id} value={t.id}>{t.name} — {t.appliesTo}</option>
            ))}
          </select>

          {tool && (
            <>
              <div className="flex-1" />
              <span className="text-[10px] text-zinc-400">
                {assessed} / {state.reviewList.length} appraised
              </span>
              {unconfirmed > 0 && (
                <span className="text-[10px] font-semibold text-amber-700">
                  {unconfirmed} judgement{unconfirmed === 1 ? '' : 's'} awaiting your confirmation
                </span>
              )}
              <button
                onClick={() => void assessAll()}
                disabled={busy || assessed === state.reviewList.length}
                className="px-2.5 h-7 bg-zinc-900 text-white text-[11px] font-semibold rounded hover:bg-zinc-700 disabled:opacity-50"
              >
                {busy && progress
                  ? `Assessing ${progress.done}/${progress.total}…`
                  : 'Draft assessments'}
              </button>
            </>
          )}
        </div>

        {tool && (
          <p className="text-[9px] text-zinc-400 mt-1.5 leading-snug">
            {tool.fullName} · {tool.reference}. Drafts are generated from the abstract, where most
            domains genuinely cannot be judged — “no information” is the correct answer there, not a
            failure. Every judgement is yours until you confirm it.
          </p>
        )}
        {loadError && <p className="text-[10px] text-red-600 mt-1.5">{loadError}</p>}
      </div>

      {/* Papers */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!state.robToolId && (
          <div className="text-center py-10 max-w-md mx-auto">
            <p className="text-[12px] text-zinc-600 font-medium">No appraisal instrument chosen</p>
            <p className="text-[10px] text-zinc-400 mt-1.5 leading-relaxed">
              Choose the one that matches your included study designs. Reviews that report an
              appraisal are expected to name the instrument, and reviewers will ask: RoB 2 for
              randomised trials, ROBINS-I for non-randomised studies of interventions, AMSTAR 2 for
              appraising other systematic reviews.
            </p>
          </div>
        )}

        {state.robToolId && state.reviewList.length === 0 && (
          <p className="text-[11px] text-zinc-400 text-center py-10">
            No papers in the review list yet.
          </p>
        )}

        {tool &&
          state.reviewList.map(paper => (
            <PaperAppraisal
              key={paper.id}
              tool={tool}
              paper={paper}
              assessment={byPaper.get(paper.id)}
              busy={busy}
              onAssess={() => { void assessOne(paper, tool) }}
            />
          ))}
      </div>
    </div>
  )
}
