interface Props {
  score: number   // 0–100
  label?: string
  showPercent?: boolean
  height?: string
}

function barColor(score: number) {
  if (score >= 70) return 'bg-green-500'
  if (score >= 40) return 'bg-amber-500'
  return 'bg-red-500'
}

export function QualityBar({ score, label, showPercent = true, height = 'h-1.5' }: Props) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-[9px] text-zinc-400 shrink-0">{label}</span>}
      <div className={`flex-1 bg-zinc-200 rounded ${height} overflow-hidden`}>
        <div
          className={`${height} ${barColor(score)} rounded transition-all`}
          style={{ width: `${score}%` }}
        />
      </div>
      {showPercent && (
        <span className={`text-[9px] font-medium shrink-0 ${barColor(score).replace('bg-', 'text-')}`}>
          {score}%
        </span>
      )}
    </div>
  )
}

export function WordCountBar({ count, min = 100, max = 200 }: { count: number; min?: number; max?: number }) {
  const barClass = count < min ? 'bg-amber-500' : count <= max ? 'bg-green-500' : 'bg-amber-500'
  const pct = Math.min((count / (max + 50)) * 100, 100)
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-zinc-500">Word count: {count} · Target: {min}–{max}</span>
      <div className="flex-1 bg-zinc-200 rounded h-1 overflow-hidden">
        <div className={`h-1 ${barClass} rounded`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
