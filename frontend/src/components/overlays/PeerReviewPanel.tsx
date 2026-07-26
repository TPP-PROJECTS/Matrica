import { useEffect, useState } from 'react'
import { useApp } from '../../store/AppContext'
import { pushSessionNow, toSnapshot } from '../../lib/sessionStorage'
import type { AppState } from '../../types'
import {
  createReview, listReviews, revokeReview, getComparison,
  SCOPE_LABELS, type ReviewScope, type ReviewMeta, type Comparison,
} from '../../lib/reviewApi'

function when(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

// ── Invitation creator ────────────────────────────────────────────────────────

function NewInvite({ state, onCreated }: { state: AppState; onCreated: () => void }) {
  const scopes: ReviewScope[] = ['process']
  const [name, setName] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function create() {
    setBusy(true); setError(null)
    try {
      // The reviewer reads the project from the server, so make sure the
      // current state is there first. Autosave only pushes after an edit, so a
      // session the user has not yet touched would otherwise not exist at all —
      // and the link would be created against nothing.
      await pushSessionNow(toSnapshot(state))
      const res = await createReview(state.sessionId, scopes, name.trim() || null)
      setLink(`${window.location.origin}${window.location.pathname}${res.url}`)
      onCreated()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (link) return (
    <div className="border border-green-200 bg-green-50 rounded-lg p-3">
      <p className="text-[11px] font-semibold text-green-900 mb-1.5">Review link created</p>
      <p className="text-[10px] text-green-800 mb-2 leading-relaxed">
        Anyone with this link can read the complete project process and leave comments. It is shown once — copy it now.
      </p>
      <div className="flex gap-1.5">
        <input
          readOnly
          value={link}
          onFocus={e => e.currentTarget.select()}
          className="flex-1 h-7 border border-green-300 rounded px-2 text-[10px] text-zinc-700 bg-white font-mono"
        />
        <button
          onClick={() => { navigator.clipboard.writeText(link); setCopied(true) }}
          className="px-2.5 h-7 bg-green-700 text-white rounded text-[10px] font-semibold hover:bg-green-800"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <button onClick={() => { setLink(null); setCopied(false); setName('') }}
              className="text-[10px] text-green-700 hover:underline mt-2">
        Create another
      </button>
    </div>
  )

  return (
    <div className="border border-zinc-200 rounded-lg p-3">
      <p className="text-[11px] font-semibold text-zinc-800 mb-2">Invite a reviewer</p>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Reviewer name (optional, for your own records)"
        className="w-full h-7 border border-zinc-300 rounded px-2 text-[11px] text-zinc-700 outline-none focus:border-zinc-500 mb-2"
      />
      <div className="mb-2.5 rounded border border-violet-100 bg-violet-50 p-2">
        <p className="text-[10px] font-semibold text-violet-800">Critical-thinking process review</p>
        <p className="text-[10px] text-violet-700 leading-snug mt-0.5">
          The reviewer can read the complete research-process audit trail and leave comments on each recorded action.
          They cannot include, exclude, approve, or replace the user's decisions.
        </p>
      </div>
      {error && <p className="text-[10px] text-red-600 mb-2">{error}</p>}
      <button
        onClick={create}
        disabled={busy || scopes.length === 0}
        className="px-3 h-7 bg-zinc-900 text-white rounded text-[11px] font-semibold hover:bg-zinc-700 disabled:opacity-40"
      >
        {busy ? 'Creating…' : 'Create review link'}
      </button>
    </div>
  )
}

// ── Reviewer comment read-out ─────────────────────────────────────────────────

function ComparisonView({ reviewId }: { reviewId: string }) {
  const [cmp, setCmp] = useState<Comparison | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getComparison(reviewId).then(setCmp).catch(e => setError(e.message))
  }, [reviewId])

  if (error) return <p className="text-[11px] text-red-600 py-3">{error}</p>
  if (!cmp) return <p className="text-[11px] text-zinc-400 py-3">Loading comparison…</p>

  return (
    <div className="pt-2">
      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-1.5">
        Reviewer comments on research process
      </p>
      {(cmp.processComments ?? []).length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic">No comments provided yet.</p>
      ) : cmp.processComments?.map(comment => (
        <div key={comment.entryId} className="border border-violet-200 bg-violet-50/30 rounded-lg p-2.5 mb-1.5">
          <p className="text-[11px] font-semibold text-zinc-800">{comment.action}</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">{comment.entityLabel}</p>
          <p className="text-[11px] text-violet-900 leading-relaxed mt-2">{comment.comment}</p>
        </div>
      ))}
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function PeerReviewPanel({ onClose }: { onClose: () => void }) {
  const { state } = useApp()
  const [reviews, setReviews] = useState<ReviewMeta[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function refresh() {
    listReviews(state.sessionId)
      .then(setReviews)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [state.sessionId])

  async function handleRevoke(id: string) {
    setError(null)
    try {
      await revokeReview(id)
      refresh()
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke this review link.')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[640px] flex flex-col"
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-zinc-200 shrink-0 flex items-start justify-between">
          <div>
            <h2 className="text-[14px] font-bold text-zinc-950">Peer review</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Invite a reviewer to evaluate every result and the user's critical-thinking process.
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-[18px] leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <NewInvite state={state} onCreated={refresh} />

          {error && <p className="text-[11px] text-red-600">{error}</p>}
          {loading && <p className="text-[11px] text-zinc-400">Loading reviews…</p>}

          {!loading && reviews.length === 0 && (
            <p className="text-[11px] text-zinc-400 italic text-center py-4">
              No reviewers invited yet.
            </p>
          )}

          {reviews.map(r => (
            <div key={r.id} className={`border rounded-lg ${r.revoked ? 'border-zinc-200 opacity-50' : 'border-zinc-200'}`}>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-zinc-900">
                    {r.reviewerName || 'Unnamed reviewer'}
                    {r.revoked && <span className="ml-2 text-[9px] font-bold text-zinc-400">REVOKED</span>}
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    {r.scopes.map(s => SCOPE_LABELS[s].title).join(' · ')}
                  </p>
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    Sent {when(r.createdAt)}
                    {r.openedAt ? ` · opened ${when(r.openedAt)}` : ' · not opened yet'}
                    {r.submittedAt ? ` · submitted ${when(r.submittedAt)}` : ''}
                  </p>
                </div>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${
                  r.submittedAt ? 'bg-green-100 text-green-700'
                  : r.openedAt ? 'bg-amber-100 text-amber-700'
                  : 'bg-zinc-100 text-zinc-500'
                }`}>
                  {r.submittedAt ? 'SUBMITTED' : r.openedAt ? 'IN PROGRESS' : 'SENT'}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 pb-2">
                <button
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  disabled={r.decisionCount === 0}
                  className="text-[10px] text-blue-600 hover:underline disabled:text-zinc-300 disabled:no-underline"
                >
                  {expanded === r.id ? '▴ Hide comments' : `▾ Comments (${r.decisionCount})`}
                </button>
                <div className="flex-1" />
                {!r.revoked && (
                  <button onClick={() => handleRevoke(r.id)} className="text-[10px] text-red-500 hover:text-red-700">
                    Revoke link
                  </button>
                )}
              </div>
              {expanded === r.id && (
                <div className="px-3 pb-3 border-t border-zinc-100">
                  <ComparisonView reviewId={r.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
