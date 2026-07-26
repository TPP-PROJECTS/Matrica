/**
 * Run an async task over each item with a bounded number in flight.
 *
 * Matrix auto-fill is one LLM call per row, and running them strictly one after
 * another makes a 30-paper matrix take as long as 30 round trips. A small pool
 * cuts that to a fraction while staying well short of anything the API would
 * rate-limit.
 *
 * `onProgress` fires once per completed item, in completion order rather than
 * input order. A task that throws is reported as done and otherwise ignored —
 * one unparseable row must not abandon the rest of the matrix.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
  opts: { onProgress?: (done: number, total: number) => void; shouldAbort?: () => boolean } = {},
): Promise<void> {
  const { onProgress, shouldAbort } = opts
  const total = items.length
  let done = 0
  let next = 0

  async function worker(): Promise<void> {
    for (;;) {
      if (shouldAbort?.()) return
      const i = next++
      if (i >= total) return
      try {
        await task(items[i])
      } catch {
        // Reported as done below; the caller decides what a gap means.
      }
      done++
      onProgress?.(done, total)
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, total)) }, worker)
  await Promise.all(workers)
}
