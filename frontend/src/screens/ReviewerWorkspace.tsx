import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  getWorkspace,
  saveDecisions,
  submitReview,
  type ReviewWorkspace,
} from '../lib/reviewApi'
import type { DecisionJournalEntry, MatrixCell, SessionSnapshot } from '../types'
import { STEPS, migrateStep } from '../lib/steps'
import { EDIT_REASON_LABEL } from '../lib/matrixVerification'

interface ResultGroup {
  label: string
  value: unknown
  /** A readable rendering in place of the raw JSON. */
  render?: ReactNode
}

function resultGroups(snapshot: SessionSnapshot, step: number): ResultGroup[] {
  switch (step) {
    case 1:
      return [
        { label: 'Research profile', value: snapshot.profile },
        { label: 'Conversation used to define the topic', value: snapshot.chatMessages },
      ]
    case 2:
      return [
        { label: 'Literature-matrix column suggestions', value: snapshot.matrixColumnSuggestions },
        { label: 'Literature-column descriptions', value: snapshot.columnDescriptions },
        { label: 'System matrix enabled', value: snapshot.systemMatrixEnabled },
        { label: 'System-matrix column suggestions', value: snapshot.systemMatrixColumnSuggestions },
        { label: 'System-column descriptions', value: snapshot.systemColumnDescriptions },
      ]
    case 3:
      return [
        { label: 'Topic candidates and AI rationales', value: snapshot.topics },
        { label: 'Search queries', value: snapshot.queries },
        { label: 'Search limits', value: snapshot.searchFilters },
        { label: 'Search results returned', value: snapshot.results },
        { label: 'Systems found and retained', value: snapshot.systemItems },
      ]
    case 4:
      return [
        { label: 'Screening protocol', value: snapshot.criteria },
        { label: 'All paper decisions, reasons and source metadata', value: snapshot.results },
        { label: 'Papers retained for review', value: snapshot.reviewList },
        { label: 'Screening-flow counts', value: snapshot.screening },
      ]
    case 5: {
      const literature = cellVerificationRows(snapshot.matrixRows.map(r => ({ label: r.title, cells: r.cells })), snapshot.matrixColumns)
      const system = cellVerificationRows((snapshot.systemMatrixRows ?? []).map(r => ({ label: r.name, cells: r.cells })), snapshot.systemMatrixColumns)
      return [
        { label: 'Literature matrix: user verification of AI-extracted cells', value: literature, render: <CellVerificationTable rows={literature} /> },
        ...(system.length > 0
          ? [{ label: 'System matrix: user verification of AI-extracted cells', value: system, render: <CellVerificationTable rows={system} /> }]
          : []),
        { label: 'Literature matrix columns', value: snapshot.matrixColumns },
        { label: 'Literature matrix rows, evidence and reasoning', value: snapshot.matrixRows },
        { label: 'System matrix columns', value: snapshot.systemMatrixColumns },
        { label: 'System matrix rows, evidence and reasoning', value: snapshot.systemMatrixRows },
      ]
    }
    case 6:
      return [
        { label: 'Synthesis themes and blocks', value: snapshot.themes },
        { label: 'Theme selected in the workspace', value: snapshot.activeThemeId },
        { label: 'Certainty-of-evidence assessments', value: snapshot.certaintyAssessments },
        { label: 'Gap dimensions', value: snapshot.gaps },
        { label: 'Overall gap statement', value: snapshot.gapStatement },
        { label: 'Per-column gap analyses', value: snapshot.axisGaps },
        { label: 'Research-question options', value: snapshot.rqOptions },
        { label: 'Selected research-question option', value: snapshot.selectedRQId },
      ]
    case 7:
      return [
        { label: 'Final topic candidates and research questions', value: snapshot.finalTopicOptions },
        { label: 'Selected final topic', value: snapshot.selectedFinalTopicId },
        { label: 'Study-design catalog and AI match reasons', value: snapshot.studyDesignOptions },
        { label: 'Selected study design', value: snapshot.selectedStudyDesignId },
        { label: 'Paper structures generated for each topic', value: snapshot.topicFinalData },
      ]
    default:
      return []
  }
}

// ── Matrix cell verification ─────────────────────────────────────────────────

type CellStatus = 'confirmed' | 'edited' | 'edited_unconfirmed' | 'filled' | 'unconfirmed'

interface CellVerificationRow {
  row: string
  column: string
  status: CellStatus
  aiValue: string | null
  confidence: number | null
  quote: string
  finalValue: string
  reason?: string
  reference?: string
}

/** Columns the extractor fills; the identifying ones come from the paper record. */
const IDENTITY_COLUMNS = new Set(['#', 'Title', 'Authors', 'Year'])

function cellVerificationRows(
  rows: { label: string; cells: Record<string, MatrixCell> }[],
  columns: string[],
): CellVerificationRow[] {
  const out: CellVerificationRow[] = []
  for (const row of rows) {
    for (const column of columns) {
      if (IDENTITY_COLUMNS.has(column)) continue
      const cell = row.cells[column]
      if (!cell) continue
      const ai = cell.originalCell ?? (cell.aiGenerated ? cell : undefined)
      const status: CellStatus = cell.originalValue !== undefined
        ? (cell.verifiedByStudent ? 'edited' : 'edited_unconfirmed')
        : !cell.verifiedByStudent ? 'unconfirmed'
        : !ai ? 'filled'
        : 'confirmed'
      out.push({
        row: row.label,
        column,
        status,
        aiValue: ai ? ai.value || 'Not reported' : null,
        confidence: ai ? ai.confidenceScore : null,
        quote: ai?.sourceRef ?? '',
        finalValue: cell.value || 'Not reported',
        reason: cell.editExplanation?.reason && EDIT_REASON_LABEL[cell.editExplanation.reason],
        reference: cell.editExplanation?.reference,
      })
    }
  }
  return out
}

const STATUS_STYLE: Record<CellStatus, { label: string; className: string }> = {
  confirmed: { label: 'Confirmed as extracted', className: 'bg-green-50 text-green-700 border-green-200' },
  edited: { label: 'Edited and confirmed', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  edited_unconfirmed: { label: 'Edited, not confirmed', className: 'bg-orange-50 text-orange-700 border-orange-200' },
  filled: { label: 'Filled in by user', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  unconfirmed: { label: 'Not confirmed', className: 'bg-zinc-50 text-zinc-500 border-zinc-200' },
}

function CellVerificationTable({ rows }: { rows: CellVerificationRow[] }) {
  if (rows.length === 0) {
    return <p className="px-3 py-3 text-[11px] italic text-zinc-400">No extracted cells were recorded.</p>
  }
  const count = (s: CellStatus) => rows.filter(r => r.status === s).length
  return (
    <div className="px-3 py-3">
      <p className="mb-2 text-[11px] text-zinc-700">
        {count('confirmed') + count('edited') + count('filled')} of {rows.length} cells confirmed by the user ·{' '}
        {count('confirmed')} as extracted · {count('edited') + count('edited_unconfirmed')} edited ({count('edited_unconfirmed')} not confirmed) ·{' '}
        {count('filled')} filled in · {count('unconfirmed')} untouched and not confirmed
      </p>
      <div className="max-h-[420px] overflow-auto rounded border border-zinc-200">
        <table className="w-full border-collapse text-[10px]">
          <thead className="sticky top-0 bg-zinc-100 text-left text-zinc-600">
            <tr>
              <th className="px-2 py-1.5 font-semibold">Row</th>
              <th className="px-2 py-1.5 font-semibold">Column</th>
              <th className="px-2 py-1.5 font-semibold">User action</th>
              <th className="px-2 py-1.5 font-semibold">AI extracted</th>
              <th className="px-2 py-1.5 font-semibold">Final value</th>
              <th className="px-2 py-1.5 font-semibold">User&rsquo;s reason and source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-zinc-100 align-top">
                <td className="max-w-[180px] px-2 py-1.5 text-zinc-700">{r.row}</td>
                <td className="px-2 py-1.5 text-zinc-700">{r.column}</td>
                <td className="px-2 py-1.5">
                  <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[9px] font-semibold ${STATUS_STYLE[r.status].className}`}>
                    {STATUS_STYLE[r.status].label}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-zinc-700">
                  {r.aiValue === null ? <span className="italic text-zinc-400">—</span> : (
                    <>
                      <span className={r.status.startsWith('edited') ? 'line-through decoration-zinc-300' : ''}>{r.aiValue}</span>
                      <span className="ml-1 text-zinc-400">({r.confidence}%)</span>
                      {r.quote && <p className="mt-0.5 italic text-zinc-400">“{r.quote}”</p>}
                    </>
                  )}
                </td>
                <td className="px-2 py-1.5 text-zinc-900">{r.finalValue}</td>
                <td className="px-2 py-1.5 text-zinc-700">
                  {!r.reason && !r.reference ? <span className="italic text-zinc-400">—</span> : (
                    <>
                      {r.reason && <p>{r.reason}</p>}
                      {r.reference && <p className="mt-0.5 text-zinc-500">Source: {r.reference}</p>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function isEmpty(value: unknown): boolean {
  if (value == null || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  return typeof value === 'object' && Object.keys(value).length === 0
}

function ResultValue({ value }: { value: unknown }) {
  if (isEmpty(value)) {
    return <p className="px-3 py-3 text-[11px] italic text-zinc-400">No result was recorded for this item.</p>
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <p className="px-3 py-3 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-800">{String(value)}</p>
  }
  return (
    <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-[10px] leading-relaxed text-zinc-700">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function entryKindLabel(entry: DecisionJournalEntry): string {
  if (entry.kind === 'ai_explanation_view') return 'AI explanation/evidence viewed'
  if (entry.kind === 'justification') return 'User decision with optional justification'
  if (entry.kind === 'automated_check') return 'Automated check'
  return 'User operation'
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

interface CommentBoxProps {
  itemKey: string
  label: string
  value: string
  disabled: boolean
  failed: boolean
  onChange: (itemKey: string, value: string) => void
}

function CommentBox({ itemKey, label, value, disabled, failed, onChange }: CommentBoxProps) {
  return (
    <div className="border-t border-violet-100 bg-violet-50/50 p-3">
      <label htmlFor={`comment-${itemKey}`} className="mb-1.5 block text-[10px] font-semibold text-violet-900">
        {label}
      </label>
      <textarea
        id={`comment-${itemKey}`}
        value={value}
        disabled={disabled}
        onChange={event => onChange(itemKey, event.target.value)}
        rows={3}
        placeholder="Optional reviewer comment…"
        className="w-full resize-y rounded-md border border-violet-200 bg-white px-2.5 py-2 text-[11px] leading-relaxed text-zinc-800 outline-none focus:border-violet-500 disabled:bg-zinc-100"
      />
      {failed && <p className="mt-1 text-[10px] text-red-600">This comment has not been saved. Use “Retry unsaved comments”.</p>}
    </div>
  )
}

export function ReviewerWorkspace({ token }: { token: string }) {
  const [workspace, setWorkspace] = useState<ReviewWorkspace | null>(null)
  const [comments, setComments] = useState<Record<string, string>>({})
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [savingCount, setSavingCount] = useState(0)
  const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const pendingRef = useRef(new Map<string, string>())
  const activeRef = useRef(new Set<Promise<boolean>>())
  const failedKeysRef = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    getWorkspace(token)
      .then(next => {
        if (cancelled) return
        setWorkspace(next)
        setSubmitted(next.submittedAt != null)
        setComments(Object.fromEntries(
          next.decisions
            .filter(decision => decision.scope === 'process')
            .map(decision => [decision.itemKey, decision.note ?? '']),
        ))
      })
      .catch(error => {
        if (!cancelled) setLoadingError(error instanceof Error ? error.message : 'Could not load this review.')
      })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) clearTimeout(timer)
  }, [])

  const persist = useCallback(async (itemKey: string, note: string): Promise<boolean> => {
    setSavingCount(count => count + 1)
    try {
      await saveDecisions(token, 'process', [{ itemKey, value: null, note: note.trim() || null }])
      failedKeysRef.current.delete(itemKey)
      setFailedKeys(new Set(failedKeysRef.current))
      return true
    } catch {
      failedKeysRef.current.add(itemKey)
      setFailedKeys(new Set(failedKeysRef.current))
      return false
    } finally {
      setSavingCount(count => Math.max(0, count - 1))
    }
  }, [token])

  const launchSave = useCallback((itemKey: string, note: string): Promise<boolean> => {
    const request = persist(itemKey, note)
    activeRef.current.add(request)
    void request.finally(() => activeRef.current.delete(request))
    return request
  }, [persist])

  const changeComment = useCallback((itemKey: string, value: string) => {
    setComments(current => ({ ...current, [itemKey]: value }))
    pendingRef.current.set(itemKey, value)
    const existing = timersRef.current.get(itemKey)
    if (existing) clearTimeout(existing)
    timersRef.current.set(itemKey, setTimeout(() => {
      timersRef.current.delete(itemKey)
      const latest = pendingRef.current.get(itemKey)
      pendingRef.current.delete(itemKey)
      if (latest !== undefined) void launchSave(itemKey, latest)
    }, 700))
  }, [launchSave])

  const flushComments = useCallback(async (): Promise<boolean> => {
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
    const queued = Array.from(pendingRef.current.entries())
    pendingRef.current.clear()
    const launched = queued.map(([itemKey, note]) => launchSave(itemKey, note))
    const requests = Array.from(new Set([...activeRef.current, ...launched]))
    const outcomes = await Promise.all(requests)
    return outcomes.every(Boolean) && failedKeysRef.current.size === 0
  }, [launchSave])

  const retryFailed = useCallback(async () => {
    const keys = Array.from(failedKeysRef.current)
    await Promise.all(keys.map(key => launchSave(key, comments[key] ?? '')))
  }, [comments, launchSave])

  const handleSubmit = useCallback(async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const saved = await flushComments()
      if (!saved) {
        setSubmitError('Some comments could not be saved. Retry them before submitting.')
        return
      }
      await submitReview(token)
      setSubmitted(true)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not submit this review.')
    } finally {
      setSubmitting(false)
    }
  }, [flushComments, token])

  const entriesByStep = useMemo(() => {
    const grouped = new Map<number, DecisionJournalEntry[]>()
    const schema = workspace?.snapshot.stepSchema
    for (const entry of workspace?.snapshot.decisionJournal ?? []) {
      // A project saved under the old 9-step layout still numbers its entries
      // that way; file them under the step they belong to now.
      const step = migrateStep(entry.step, schema)
      const entries = grouped.get(step) ?? []
      entries.push(entry)
      grouped.set(step, entries)
    }
    return grouped
  }, [workspace])

  if (loadingError) {
    return (
      <main className="min-h-screen bg-zinc-50 p-8">
        <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-white p-6">
          <h1 className="text-base font-bold text-zinc-900">Review unavailable</h1>
          <p className="mt-2 text-sm text-red-700">{loadingError}</p>
        </div>
      </main>
    )
  }

  if (!workspace) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50">
        <p className="text-sm text-zinc-500">Loading complete research-process review…</p>
      </main>
    )
  }

  const readOnly = submitted || workspace.submittedAt != null

  return (
    <main className="min-h-screen bg-zinc-100">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 px-5 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-bold text-zinc-950">Complete research-process review</h1>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {workspace.snapshot.sessionTitle} · Review every result, operation, justification and AI-evidence interaction.
            </p>
          </div>
          <div className="text-right text-[10px] text-zinc-500">
            <p>{workspace.reviewerName || 'Reviewer'}</p>
            <p>
              {readOnly ? 'Submitted · read only' : savingCount > 0 ? `Saving ${savingCount} comment${savingCount === 1 ? '' : 's'}…` : 'Comments autosave'}
            </p>
          </div>
          {!readOnly && (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="h-8 rounded-md bg-zinc-900 px-4 text-[11px] font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit comments'}
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-6">
        <div className="mb-5 rounded-lg border border-violet-200 bg-violet-50 p-4">
          <p className="text-[12px] font-semibold text-violet-950">Your role is evaluation only</p>
          <p className="mt-1 text-[11px] leading-relaxed text-violet-800">
            You cannot include, exclude, approve or alter the project. Comment on the quality of each step’s result and on
            whether the user’s actions, optional justifications and use of AI evidence demonstrate sound critical thinking.
          </p>
        </div>

        {readOnly && (
          <div className="mb-5 rounded-lg border border-green-200 bg-green-50 p-3 text-[11px] font-semibold text-green-800">
            Review submitted. The project owner can now read these comments.
          </div>
        )}
        {submitError && <p className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">{submitError}</p>}
        {failedKeys.size > 0 && !readOnly && (
          <div className="mb-4 flex items-center gap-3 rounded border border-red-200 bg-red-50 p-3">
            <p className="flex-1 text-[11px] text-red-700">{failedKeys.size} comment{failedKeys.size === 1 ? '' : 's'} could not be saved.</p>
            <button onClick={retryFailed} className="text-[11px] font-semibold text-red-700 underline">Retry unsaved comments</button>
          </div>
        )}

        <div className="space-y-6">
          {STEPS.map(step => {
            const operations = entriesByStep.get(step.id) ?? []
            return (
              <section key={step.id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
                <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-bold text-white">
                    {step.id}
                  </span>
                  <div className="flex-1">
                    <h2 className="text-[13px] font-bold text-zinc-900">{step.label}</h2>
                    <p className="text-[10px] text-zinc-500">
                      Complete recorded result · {operations.length} recorded user/AI-evidence operation{operations.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>

                <div className="p-4">
                  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500">Results produced in this step</h3>
                  <div className="space-y-2">
                    {resultGroups(workspace.snapshot, step.id).map(group => (
                      <details key={group.label} open className="overflow-hidden rounded-lg border border-zinc-200">
                        <summary className="cursor-pointer bg-zinc-50 px-3 py-2 text-[11px] font-semibold text-zinc-800">
                          {group.label}
                        </summary>
                        {group.render ?? <ResultValue value={group.value} />}
                      </details>
                    ))}
                  </div>
                </div>

                <CommentBox
                  itemKey={`step-result:${step.id}`}
                  label="Evaluate this step’s results"
                  value={comments[`step-result:${step.id}`] ?? ''}
                  disabled={readOnly}
                  failed={failedKeys.has(`step-result:${step.id}`)}
                  onChange={changeComment}
                />

                <div className="border-t border-zinc-200 p-4">
                  <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    Operations, justifications and viewed AI evidence
                  </h3>
                  {operations.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-[11px] italic text-zinc-400">
                      No journalled operation was recorded in this step.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {operations.map(entry => (
                        <article key={entry.id} className="overflow-hidden rounded-lg border border-zinc-200">
                          <div className="p-3">
                            <div className="flex flex-wrap items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-semibold text-zinc-900">{entry.action}</p>
                                <p className="mt-0.5 text-[10px] text-zinc-500">{entry.entityType} · {entry.entityLabel}</p>
                              </div>
                              <span className="rounded bg-violet-100 px-2 py-0.5 text-[9px] font-semibold text-violet-700">
                                {entryKindLabel(entry)}
                              </span>
                              <time className="text-[9px] text-zinc-400">{formatTime(entry.createdAt)}</time>
                            </div>
                            <dl className="mt-3 grid gap-2 text-[10px] sm:grid-cols-2">
                              {entry.previousValue !== undefined && (
                                <div className="rounded bg-red-50 p-2">
                                  <dt className="font-semibold text-red-700">Before</dt>
                                  <dd className="mt-0.5 whitespace-pre-wrap text-zinc-700">{entry.previousValue || 'Empty'}</dd>
                                </div>
                              )}
                              {entry.newValue !== undefined && (
                                <div className="rounded bg-green-50 p-2">
                                  <dt className="font-semibold text-green-700">After</dt>
                                  <dd className="mt-0.5 whitespace-pre-wrap text-zinc-700">{entry.newValue || 'Empty'}</dd>
                                </div>
                              )}
                              {entry.justification && (
                                <div className="rounded bg-amber-50 p-2 sm:col-span-2">
                                  <dt className="font-semibold text-amber-800">User-provided justification</dt>
                                  <dd className="mt-0.5 whitespace-pre-wrap text-zinc-700">{entry.justification}</dd>
                                </div>
                              )}
                              {entry.details && (
                                <div className="rounded bg-blue-50 p-2 sm:col-span-2">
                                  <dt className="font-semibold text-blue-800">Evidence / interaction details</dt>
                                  <dd className="mt-0.5 whitespace-pre-wrap text-zinc-700">{entry.details}</dd>
                                </div>
                              )}
                            </dl>
                          </div>
                          <CommentBox
                            itemKey={`journal:${entry.id}`}
                            label="Comment on this operation or critical-thinking evidence"
                            value={comments[`journal:${entry.id}`] ?? ''}
                            disabled={readOnly}
                            failed={failedKeys.has(`journal:${entry.id}`)}
                            onChange={changeComment}
                          />
                        </article>
                      ))}
                    </div>
                  )}
                </div>

                <CommentBox
                  itemKey={`step-actions:${step.id}`}
                  label="Overall evaluation of the user’s actions and critical thinking in this step"
                  value={comments[`step-actions:${step.id}`] ?? ''}
                  disabled={readOnly}
                  failed={failedKeys.has(`step-actions:${step.id}`)}
                  onChange={changeComment}
                />
              </section>
            )
          })}
        </div>

        {!readOnly && (
          <div className="mt-6 flex items-center justify-end gap-3 rounded-xl border border-zinc-200 bg-white p-4">
            <p className="flex-1 text-[11px] text-zinc-500">
              Submission locks the review. Empty comments are allowed; all written comments are saved first.
            </p>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="h-9 rounded-md bg-zinc-900 px-5 text-[11px] font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit comments'}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
