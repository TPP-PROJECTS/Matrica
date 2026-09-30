import { useState } from 'react'
import { useApp } from '../../store/AppContext'
import type { CertaintyAssessment, CertaintyFrameworkId, CertaintyLevel, Theme } from '../../types'
import { API, apiFetch } from '../../lib/api'
import {
  FRAMEWORKS, LEVELS, LEVEL_LABEL, awaitingReview, domainApplies, downgradeReasons,
  finalLevel, frameworkPayload, levelSymbols, ruleLevel, suggestFramework, themeEvidence,
} from '../../lib/certainty'

const LEVEL_STYLE: Record<CertaintyLevel, string> = {
  high: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  moderate: 'bg-sky-50 text-sky-800 border-sky-300',
  low: 'bg-amber-50 text-amber-800 border-amber-300',
  very_low: 'bg-red-50 text-red-800 border-red-300',
}

/** The certainty level as a compact chip, for theme lists. */
export function CertaintyChip({ assessment }: { assessment: CertaintyAssessment }) {
  const level = finalLevel(assessment)
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[8px] font-semibold whitespace-nowrap ${LEVEL_STYLE[level]}`}
      title={`${FRAMEWORKS[assessment.framework].name}: ${LEVEL_LABEL[level]} certainty${assessment.override ? ' (reviewer override)' : ''}${awaitingReview(assessment) ? ' — AI draft awaiting review' : ''}`}
    >
      <span className="tracking-tighter">{levelSymbols(level)}</span>
      {LEVEL_LABEL[level]}
      {awaitingReview(assessment) && <span className="text-violet-500">•</span>}
    </span>
  )
}

/**
 * Certainty of evidence for one theme's finding. The AI drafts a judgement and
 * reason per domain; the level follows from them by the framework's rule, and
 * the reviewer confirms, changes or overrides — each recorded in the journal.
 */
export function CertaintyPanel({ theme }: { theme: Theme }) {
  const { state, dispatch } = useApp()
  const assessment = (state.certaintyAssessments ?? []).find(a => a.themeId === theme.id)
  const [framework, setFramework] = useState<CertaintyFrameworkId>(() => assessment?.framework ?? suggestFramework(state))
  const [error, setError] = useState<string | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [overriding, setOverriding] = useState(false)
  const [overrideLevel, setOverrideLevel] = useState<CertaintyLevel>('moderate')
  const [overrideReason, setOverrideReason] = useState('')

  const evidence = themeEvidence(state, theme)

  async function draft(fwId: CertaintyFrameworkId) {
    setDrafting(true)
    setError(null)
    try {
      const res = await apiFetch(`${API}/certainty/assess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          framework: frameworkPayload(fwId),
          theme: {
            name: theme.name,
            synthesis: theme.blocks.filter(b => b.content.trim()).map(b => `${b.title}: ${b.content}`).join('\n\n'),
          },
          papers: evidence,
          profile: state.profile,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(typeof body?.detail === 'string' ? body.detail : 'Could not draft the rating')
      }
      const data = await res.json() as {
        finding: string
        start_level: 'high' | 'low' | null
        domains: Record<string, { judgement: string; rationale: string }>
      }
      dispatch({
        type: 'SET_CERTAINTY_ASSESSMENT',
        assessment: {
          themeId: theme.id,
          framework: fwId,
          finding: data.finding,
          startLevel: data.start_level ?? undefined,
          domains: Object.fromEntries(Object.entries(data.domains).map(([id, d]) => [id, {
            judgement: d.judgement, rationale: d.rationale, aiGenerated: true, verifiedByStudent: false,
          }])),
          override: null,
          assessedAt: new Date().toISOString(),
        },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draft the rating')
    } finally {
      setDrafting(false)
    }
  }

  const header = (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide flex-1">Certainty of evidence</span>
      <select
        value={framework}
        onChange={e => setFramework(e.target.value as CertaintyFrameworkId)}
        disabled={drafting}
        title="GRADE for effects and associations; GRADE-CERQual for qualitative findings"
        className="h-5 border border-zinc-300 rounded text-[9px] text-zinc-600 bg-white px-1"
      >
        {Object.values(FRAMEWORKS).map(f => <option key={f.id} value={f.id} title={f.useFor}>{f.name}</option>)}
      </select>
      {assessment && (
        <button
          onClick={() => void draft(framework)}
          disabled={drafting || evidence.length === 0}
          title={framework !== assessment.framework
            ? `Replace this rating with a fresh ${FRAMEWORKS[framework].name} draft`
            : 'Replace this rating with a fresh AI draft; your changes to it are discarded'}
          className="px-2 h-5 rounded border border-zinc-300 text-[9px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
        >
          ↺ {framework !== assessment.framework ? `Switch to ${FRAMEWORKS[framework].short}` : 'Re-draft'}
        </button>
      )}
    </div>
  )

  if (!assessment) {
    return (
      <section className="mt-4">
        {header}
        <div className="border border-dashed border-zinc-300 rounded-lg px-3 py-3 flex items-center gap-3">
          <p className="text-[10px] text-zinc-500 flex-1 leading-snug">
            {evidence.length === 0
              ? 'No study has a value in this theme’s columns yet, so there is no evidence to rate.'
              : <>Rate how much confidence this theme&apos;s finding deserves, from the {evidence.length} contributing stud{evidence.length === 1 ? 'y' : 'ies'}. The AI drafts each domain; the level follows from your confirmed judgements.</>}
          </p>
          <button
            onClick={() => void draft(framework)}
            disabled={drafting || evidence.length === 0}
            className="px-3 h-7 rounded bg-zinc-900 text-white text-[10px] font-semibold hover:bg-zinc-700 disabled:opacity-40 shrink-0"
          >
            ✦ Draft {FRAMEWORKS[framework].short} rating
          </button>
        </div>
        {error && <p className="text-[10px] text-red-600 mt-1.5">{error}</p>}
      </section>
    )
  }

  const fw = FRAMEWORKS[assessment.framework]
  const rule = ruleLevel(assessment)
  const level = finalLevel(assessment)
  const reasons = downgradeReasons(assessment)
  const pending = awaitingReview(assessment)

  return (
    <section className="mt-4">
      {header}
      <div className="border border-zinc-200 rounded-lg overflow-hidden">
        {/* Rating */}
        <div className="px-3 py-2.5 flex items-start gap-3 border-b border-zinc-100 bg-zinc-50/60">
          <div className={`px-2.5 py-1.5 rounded-md border text-center shrink-0 ${LEVEL_STYLE[level]}`}>
            <p className="text-[13px] leading-none tracking-tight">{levelSymbols(level)}</p>
            <p className="text-[10px] font-bold mt-1">{LEVEL_LABEL[level]}</p>
          </div>
          <div className="flex-1 min-w-0">
            <textarea
              key={assessment.assessedAt}
              defaultValue={assessment.finding}
              onBlur={e => { if (e.target.value.trim() !== assessment.finding) dispatch({ type: 'UPDATE_CERTAINTY_ASSESSMENT', themeId: theme.id, finding: e.target.value.trim() }) }}
              rows={3}
              placeholder="The finding being rated"
              className="w-full bg-transparent text-[11px] text-zinc-800 leading-snug resize-none outline-none focus:bg-white focus:ring-1 focus:ring-zinc-300 rounded px-1 -mx-1"
            />
            <p className="text-[9px] text-zinc-500 mt-0.5">
              {fw.name}
              {assessment.override
                ? <> · overridden from {LEVEL_LABEL[rule].toLowerCase()}: {assessment.override.reason || 'no reason given'}</>
                : reasons.length > 0 ? <> · downgraded for {reasons.join(', ')}</> : null}
              {pending && <span className="text-violet-600"> · AI draft — confirm each domain</span>}
            </p>
          </div>
        </div>

        {/* Starting level (GRADE) */}
        {fw.startLevels && (
          <div className="px-3 py-1.5 border-b border-zinc-100 flex items-center gap-2">
            <span className="text-[10px] text-zinc-600 flex-1 min-w-0">Starting level</span>
            <select
              value={assessment.startLevel ?? 'high'}
              onChange={e => dispatch({ type: 'UPDATE_CERTAINTY_ASSESSMENT', themeId: theme.id, startLevel: e.target.value as 'high' | 'low' })}
              className="h-6 border border-zinc-300 rounded text-[10px] bg-white px-1"
            >
              {fw.startLevels.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        )}

        {/* Domains */}
        <div className="divide-y divide-zinc-100">
          {fw.domains.filter(d => domainApplies(d, assessment)).map(d => {
            const j = assessment.domains[d.id]
            const needsReview = !!j?.aiGenerated && !j.verifiedByStudent
            const opt = d.options.find(o => o.id === j?.judgement)
            return (
              <div key={d.id} className={`px-3 py-1.5 ${needsReview ? 'bg-violet-50/30' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium text-zinc-700 flex-1 min-w-0 cursor-help" title={d.question}>
                    {d.label}{d.upgradeOnly && <span className="text-zinc-400 font-normal"> · upgrading factor</span>}
                  </span>
                  {needsReview ? (
                    <button
                      onClick={() => dispatch({ type: 'UPDATE_CERTAINTY_DOMAIN', themeId: theme.id, domainId: d.id, verified: true })}
                      disabled={!opt}
                      title={opt ? 'Confirm this AI-drafted judgement' : 'Choose a judgement first'}
                      className="px-1.5 h-5 rounded border border-violet-300 text-[9px] text-violet-700 bg-white hover:bg-violet-50 disabled:opacity-40 shrink-0"
                    >
                      ✓ Confirm
                    </button>
                  ) : (
                    <span className="text-[9px] text-emerald-600 shrink-0" title={j?.aiGenerated ? 'AI draft confirmed by the reviewer' : 'Judged by the reviewer'}>✓ confirmed</span>
                  )}
                </div>
                <select
                  value={j?.judgement ?? ''}
                  onChange={e => dispatch({ type: 'UPDATE_CERTAINTY_DOMAIN', themeId: theme.id, domainId: d.id, judgement: e.target.value })}
                  className={`mt-1 h-6 border rounded text-[10px] bg-white px-1 w-full max-w-[200px] ${
                    !opt ? 'border-amber-400 text-amber-700' : opt.shift < 0 ? 'border-red-300 text-red-700' : opt.shift > 0 ? 'border-emerald-300 text-emerald-700' : 'border-zinc-300 text-zinc-700'
                  }`}
                >
                  <option value="" disabled>— not judged</option>
                  {d.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <textarea
                  key={`${assessment.assessedAt}-${d.id}`}
                  defaultValue={j?.rationale ?? ''}
                  onBlur={e => { if (e.target.value !== (j?.rationale ?? '')) dispatch({ type: 'UPDATE_CERTAINTY_DOMAIN', themeId: theme.id, domainId: d.id, rationale: e.target.value }) }}
                  rows={2}
                  placeholder="Reason for this judgement"
                  className="mt-1 w-full text-[10px] text-zinc-500 leading-snug resize-none outline-none bg-transparent focus:bg-white focus:ring-1 focus:ring-zinc-300 rounded px-1 -mx-1"
                />
              </div>
            )
          })}
        </div>

        {/* Override */}
        <div className="px-3 py-2 border-t border-zinc-100 bg-zinc-50/60">
          {assessment.override ? (
            <button
              onClick={() => dispatch({ type: 'UPDATE_CERTAINTY_ASSESSMENT', themeId: theme.id, override: null })}
              className="text-[9px] text-zinc-500 hover:text-zinc-800 underline underline-offset-2"
            >
              Remove override (the rule gives {LEVEL_LABEL[rule].toLowerCase()})
            </button>
          ) : overriding ? (
            <div className="flex items-center gap-2 flex-wrap">
              <select value={overrideLevel} onChange={e => setOverrideLevel(e.target.value as CertaintyLevel)} className="h-6 border border-zinc-300 rounded text-[10px] bg-white px-1">
                {[...LEVELS].reverse().map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
              </select>
              <input
                autoFocus
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                placeholder="Why the framework's rule gets this wrong (required)"
                className="flex-1 min-w-[160px] h-6 border border-zinc-300 rounded px-2 text-[10px] outline-none focus:border-zinc-500"
              />
              <button
                onClick={() => {
                  dispatch({ type: 'UPDATE_CERTAINTY_ASSESSMENT', themeId: theme.id, override: { level: overrideLevel, reason: overrideReason.trim() } })
                  setOverriding(false); setOverrideReason('')
                }}
                disabled={!overrideReason.trim()}
                className="px-2 h-6 rounded bg-zinc-900 text-white text-[10px] disabled:opacity-40"
              >Save</button>
              <button onClick={() => setOverriding(false)} className="text-[10px] text-zinc-500">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => { setOverrideLevel(rule); setOverriding(true) }}
              className="text-[9px] text-zinc-500 hover:text-zinc-800 underline underline-offset-2"
            >
              Override the rating…
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-[10px] text-red-600 mt-1.5">{error}</p>}
    </section>
  )
}
