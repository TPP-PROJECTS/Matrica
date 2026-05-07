interface Props {
  label?: string
  className?: string
}

export function AIBadge({ label = 'AI-generated', className = '' }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[10px] bg-violet-50 border border-violet-200 text-violet-600 text-[9px] font-medium ${className}`}
    >
      <span>✦</span>
      <span>{label}</span>
    </span>
  )
}

export function PresetBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[10px] bg-zinc-100 border border-zinc-300 text-zinc-500 text-[7px] ${className}`}
    >
      <span>🗂</span>
      <span>pre-set type</span>
    </span>
  )
}
