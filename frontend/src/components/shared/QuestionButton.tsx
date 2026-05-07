interface Props {
  onClick?: () => void
  size?: 'sm' | 'lg'
  className?: string
}

export function QuestionButton({ onClick, size = 'sm', className = '' }: Props) {
  const dim = size === 'lg' ? 'w-6 h-6 text-[10px]' : 'w-5 h-5 text-[9px]'
  return (
    <button
      onClick={onClick}
      className={`${dim} rounded-full bg-violet-600 text-white font-bold flex items-center justify-center flex-shrink-0 hover:bg-violet-700 transition-colors cursor-pointer ${className}`}
      title="Ask about this"
      aria-label="Ask about this"
    >
      ?
    </button>
  )
}
