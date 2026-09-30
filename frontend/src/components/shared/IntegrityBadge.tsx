import type { IntegrityCheck } from '../../types'
import { INTEGRITY_LABEL, primaryNotice } from '../../lib/integrity'

const STYLE = {
  retracted: 'bg-red-600 text-white border-red-700',
  concern: 'bg-amber-100 text-amber-800 border-amber-300',
  corrected: 'bg-zinc-100 text-zinc-600 border-zinc-300',
} as const

/**
 * A paper's retraction / concern / correction status, linked to the notice.
 * Renders nothing for a clear or unmatched paper: the badge exists to catch the
 * eye, and a badge on every row would stop it doing that.
 */
export function IntegrityBadge({ check }: { check: IntegrityCheck | undefined }) {
  if (!check || !(check.status in STYLE)) return null
  const status = check.status as keyof typeof STYLE
  const notice = primaryNotice(check)
  const detail = check.notices
    .map(n => `${n.label}${n.date ? ` (${n.date})` : ''}${n.source === 'retraction-watch' ? ' — Retraction Watch' : ''}`)
    .join('\n')
  const title = `${INTEGRITY_LABEL[status]} according to Crossref${detail ? `:\n${detail}` : ''}${notice?.doi ? '\n\nClick to open the notice.' : ''}`
  const className = `inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[8px] font-bold uppercase tracking-wide ${STYLE[status]}`
  const text = <>{status === 'retracted' ? '⚠ ' : ''}{INTEGRITY_LABEL[status]}</>

  return notice?.doi ? (
    <a
      href={`https://doi.org/${notice.doi}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      title={title}
      className={`${className} hover:opacity-85`}
    >
      {text}
    </a>
  ) : (
    <span title={title} className={className}>{text}</span>
  )
}
