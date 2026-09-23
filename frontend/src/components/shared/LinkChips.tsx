/**
 * The topic ↔ system links, drawn on whichever side you are looking at.
 *
 * A topic card lists the systems that bear on it; a system card lists the
 * topics. Both are the same relation read from opposite ends, so they are the
 * same component — the caller only supplies the labels and which colour the
 * counterpart is drawn in.
 */

export interface LinkChipItem {
  id: string
  label: string
  strength: 'strong' | 'possible'
  reason: string
}

export function LinkChips({
  items,
  heading,
  tone,
  emptyHint,
}: {
  items: LinkChipItem[]
  heading: string
  /** The colour of the *counterpart*: systems are violet, topics are blue. */
  tone: 'blue' | 'violet'
  /** Shown instead of chips when nothing is linked; omit to render nothing. */
  emptyHint?: string
}) {
  if (items.length === 0) {
    return emptyHint
      ? <p className="text-[9px] text-zinc-300 italic mt-1">{emptyHint}</p>
      : null
  }

  const strong = tone === 'violet'
    ? 'bg-violet-100 text-violet-700 border-violet-300'
    : 'bg-blue-100 text-blue-700 border-blue-300'
  const possible = tone === 'violet'
    ? 'bg-white text-violet-500 border-violet-200 border-dashed'
    : 'bg-white text-blue-500 border-blue-200 border-dashed'

  return (
    <div className="mt-1.5">
      <p className="text-[8px] font-bold text-zinc-400 uppercase tracking-wide mb-1">{heading}</p>
      <div className="flex flex-wrap gap-1">
        {items.map(item => (
          <span
            key={item.id}
            // The reason is the whole value of the link: without it the chip is
            // an assertion the reviewer has no way to judge.
            title={item.reason
              ? `${item.strength === 'strong' ? 'Strong link' : 'Possible link'} — ${item.reason}`
              : item.strength === 'strong' ? 'Strong link' : 'Possible link'}
            className={`px-1.5 py-0.5 border rounded-full text-[9px] leading-tight max-w-[150px] truncate cursor-help ${
              item.strength === 'strong' ? strong : possible
            }`}
          >
            {item.strength === 'strong' ? '● ' : '○ '}{item.label}
          </span>
        ))}
      </div>
    </div>
  )
}
