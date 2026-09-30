import { getAiCancelEpoch } from './aiActivity'

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
 *
 * Pressing Stop on the AI loading overlay also ends the run: no new item
 * starts after it, whether or not the caller passed `shouldAbort`.
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
  const epoch = getAiCancelEpoch()

  async function worker(): Promise<void> {
    for (;;) {
      if (shouldAbort?.() || getAiCancelEpoch() !== epoch) return
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

/**
 * A shared gate that lets at most `limit` tasks run at once, however many
 * callers queue work through it. Unlike runPool, the work does not have to be
 * known up front: relevance scoring is fired from searches, citation chasing
 * and imports independently, and several searches in a row would otherwise put
 * every result on the wire at the same time.
 */
export function createLimiter(limit: number) {
  let active = 0
  const waiting: (() => void)[] = []

  return async function run<R>(task: () => Promise<R>): Promise<R> {
    if (active >= limit) await new Promise<void>(resolve => waiting.push(resolve))
    active++
    try {
      return await task()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}
