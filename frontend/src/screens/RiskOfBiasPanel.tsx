import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store/AppContext'
import { API, apiFetch } from '../lib/api'
import { runPool } from '../lib/runPool'
import { checkProvenance, paperSources } from '../lib/provenance'
import { SourceProvenance } from '../components/shared/SourceProvenance'
import type { RobAssessment, RobRecommendation, RobTool, RobToolId, ResultCard } from '../types'

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
  fullText,
  assessment,
}: {
  tool: RobTool
  domainId: string
  paper: ResultCard
  fullText: string | undefined
  assessment: RobAssessment
}) {
  const { dispatch } = useApp()
  const [open, setOpen] = useState(false)
  const spec = tool.domains.find(d => d.id === domainId)!
  const result = assessment.domains[domainId]
  if (!result) return null

  const tone = toneOf(tool, result.judgement)
  const needsReview = result.aiGenerated && !result.verifiedByStudent
  const quoteVerdict = checkProvenance(paperSources(paper.abstract, fullText), result.supportQuote)

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
              ✕ supporting quote is not in the paper text
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
          <SourceProvenance
            sources={paperSources(paper.abstract, fullText)}
            quote={result.supportQuote}
          />
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
  fullText,
  assessment,
  onAssess,
  busy,
}: {
  tool: RobTool
  paper: ResultCard
  fullText: string | undefined
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
          <p className="text-[9px] text-zinc-400">
            {paper.authors} · {paper.year || '—'}
            {/* Whether a full text was available largely determines what this
                appraisal could possibly establish, so it is stated up front. */}
            {fullText
              ? <span className="ml-1.5 text-green-700 font-semibold">full text</span>
              : <span className="ml-1.5 text-amber-700 font-semibold">abstract only</span>}
          </p>
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
              fullText={fullText}
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
  const [recommendation, setRecommendation] = useState<RobRecommendation | null>(null)
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

  // The step already knows which study design the reviewer chose, so asking
  // them to pick an instrument unaided is a question the tool can answer. It is
  // not a small choice either: appraising a machine-learning model with RoB 2
  // produces five domains of "no information" about a randomisation that never
  // happened.
  useEffect(() => {
    const designId = state.selectedStudyDesignId
    let cancelled = false
    const load = designId
      ? apiFetch(`${API}/rob/recommend/${designId}`)
          .then(res => (res.ok ? res.json() : Promise.reject(new Error())))
      : Promise.resolve(null)
    load
      .then(rec => { if (!cancelled) setRecommendation(rec) })
      .catch(() => { if (!cancelled) setRecommendation(null) })
    return () => { cancelled = true }
  }, [state.selectedStudyDesignId])

  // Pre-select the expected instrument, but only when the reviewer has not
  // already chosen one — overriding their choice would be worse than not
  // helping at all.
  useEffect(() => {
    const suggested = recommendation?.recommended?.[0]?.id
    if (suggested && !state.robToolId) {
      dispatch({ type: 'SET_ROB_TOOL', toolId: suggested })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendation])

  const tool = useMemo(
    () => tools.find(t => t.id === state.robToolId) ?? null,
    [tools, state.robToolId],
  )
  const recommendedIds = new Set((recommendation?.recommended ?? []).map(t => t.id))
  const guidance = recommendation?.guidance ?? null
  const designHasNoInstrument = Boolean(recommendation && recommendation.recommended.length === 0)
  const byPaper = useMemo(
    () => new Map((state.robAssessments ?? []).map(a => [a.paperId, a])),
    [state.robAssessments],
  )
  const fullTextFor = (paperId: string) => state.paperFullTexts?.[paperId] ?? ''
  const withFullText = state.reviewList.filter(p => fullTextFor(p.id)).length

  async function assessOne(paper: ResultCard, activeTool: RobTool): Promise<void> {
    const res = await apiFetch(`${API}/rob/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolId: activeTool.id,
        paper: {
          title: paper.title, abstract: paper.abstract ?? '',
          authors: paper.authors, year: paper.year || null,
          // Most risk-of-bias domains are simply not answerable from an
          // abstract — allocation concealment, blinding and pre-specified
          // analysis plans live in the Methods section. Sending the full text
          // the matrix step already fetched is the difference between an
          // appraisal and a page of "no information".
          fullText: state.paperFullTexts?.[paper.id] ?? '',
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
            {recommendedIds.size > 0 && (
              <optgroup label="Suited to your study design">
                {tools.filter(t => recommendedIds.has(t.id)).map(t => (
                  <option key={t.id} value={t.id}>{t.name} — {t.appliesTo}</option>
                ))}
              </optgroup>
            )}
            <optgroup label={recommendedIds.size > 0 ? 'Other instruments' : 'All instruments'}>
              {tools.filter(t => !recommendedIds.has(t.id)).map(t => (
                <option key={t.id} value={t.id}>{t.name} — {t.appliesTo}</option>
              ))}
            </optgroup>
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
            {tool.fullName} · {tool.reference}. Drafts read the open-access full text where the
            matrix step retrieved one, and the abstract otherwise — and from an abstract most
            domains genuinely cannot be judged, where “no information” is the correct answer rather
            than a failure. Every judgement is yours until you confirm it.
            {` ${withFullText} of ${state.reviewList.length} papers have a full text available.`}
          </p>
        )}
        {loadError && <p className="text-[10px] text-red-600 mt-1.5">{loadError}</p>}
      </div>

      {/* Papers */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* No validated instrument covers this design. Saying so plainly, with the
            concerns the field does raise, is the honest alternative to offering
            an instrument that does not fit — which a reviewer would then cite. */}
        {guidance && (
          <div className="mb-4 border border-amber-200 bg-amber-50/40 rounded-lg p-3">
            <p className="text-[11px] font-semibold text-amber-900 mb-1">
              {designHasNoInstrument
                ? 'No validated appraisal instrument covers this study design'
                : 'Additional appraisal notes for this design'}
            </p>
            <p className="text-[10px] text-amber-800 leading-snug mb-2">{guidance.note}</p>
            <p className="text-[8px] font-bold text-amber-700 uppercase tracking-widest mb-1">
              What reviewers in this field ask instead
            </p>
            <ul className="space-y-1">
              {guidance.concerns.map((c, i) => (
                <li key={i} className="flex gap-1.5 text-[10px] text-amber-900 leading-snug">
                  <span className="text-amber-400 shrink-0">·</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
            <p className="text-[9px] text-amber-700 mt-2 leading-snug">
              This is an informal checklist, not a validated instrument — use it to structure your
              own appraisal, but do not cite it in a methods section as one.
            </p>
          </div>
        )}

        {!state.robToolId && !designHasNoInstrument && (
          <div className="text-center py-10 max-w-md mx-auto">
            <p className="text-[12px] text-zinc-600 font-medium">No appraisal instrument chosen</p>
            <p className="text-[10px] text-zinc-400 mt-1.5 leading-relaxed">
              Reviews that report an appraisal are expected to name the instrument, and it has to
              match what you included: RoB 2 for randomised trials, ROBINS-I for non-randomised
              studies of interventions, PROBAST for prediction and machine-learning models,
              CASP or MMAT for qualitative work, AXIS for surveys, QUADAS-2 for diagnostic
              accuracy, AMSTAR 2 for appraising other reviews.
              {state.selectedStudyDesignId
                ? ' The list above is ordered so the ones suited to your chosen study design come first.'
                : ' Choose a study design first and this list will be narrowed for you.'}
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
              fullText={fullTextFor(paper.id)}
              assessment={byPaper.get(paper.id)}
              busy={busy}
              onAssess={() => { void assessOne(paper, tool) }}
            />
          ))}
      </div>
    </div>
  )
}
