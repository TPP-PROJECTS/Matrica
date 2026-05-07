export function StaleStepBanner() {
  return (
    <div className="w-full border-y-2 border-amber-400 bg-amber-50 px-4 py-2 flex items-center gap-4 shrink-0" style={{ minHeight: 88 }}>
      <div className="flex-1">
        <p className="text-[14px] font-bold text-amber-800 leading-tight">
          ⚠ This step is outdated
        </p>
        <p className="text-[10px] text-amber-700 mt-0.5">
          Your upstream step changed. This content was generated from old data.
        </p>
        <p className="text-[10px] italic text-amber-600 mt-0.5">
          It is still visible below, but should be regenerated before you continue.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button className="h-[26px] px-3 bg-zinc-900 text-white rounded text-[10px] font-semibold hover:bg-zinc-700 transition-colors">
          ↺ Regenerate Now
        </button>
        <button className="h-[26px] px-3 border border-zinc-400 text-zinc-700 rounded text-[10px] hover:bg-zinc-100 transition-colors">
          Keep old version
        </button>
        <button className="h-[26px] px-3 bg-amber-50 border border-amber-500 text-amber-700 rounded text-[10px] hover:bg-amber-100 transition-colors">
          See what changed
        </button>
      </div>
    </div>
  )
}
