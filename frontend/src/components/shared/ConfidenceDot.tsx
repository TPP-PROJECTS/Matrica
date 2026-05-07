import type { ConfidenceLevel } from '../../types'

interface Props {
  level: ConfidenceLevel
  score?: number
  size?: 'sm' | 'lg'
}

const colorMap: Record<ConfidenceLevel, string> = {
  high:   'bg-green-500',
  medium: 'bg-amber-500',
  low:    'bg-red-600',
  none:   'bg-zinc-300',
}

export function ConfidenceDot({ level, score, size = 'sm' }: Props) {
  if (level === 'none') return null
  const dim = size === 'lg' ? 'w-6 h-6' : 'w-2.5 h-2.5'
  const title = score !== undefined
    ? `${level.charAt(0).toUpperCase() + level.slice(1)} confidence (${Math.round(score * 100)}%)`
    : `${level.charAt(0).toUpperCase() + level.slice(1)} confidence`

  return (
    <span
      className={`inline-block rounded-full flex-shrink-0 ${dim} ${colorMap[level]}`}
      title={title}
    />
  )
}
