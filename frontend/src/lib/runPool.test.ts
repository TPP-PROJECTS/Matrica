import { describe, it, expect } from 'vitest'
import { runPool } from './runPool'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

describe('runPool', () => {
  it('visits every item', async () => {
    const seen: number[] = []
    await runPool([1, 2, 3, 4, 5], 2, async n => { seen.push(n) })
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0
    let peak = 0
    await runPool(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 1))
      inFlight--
    })
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
  })

  it('keeps going when a task throws', async () => {
    const done: number[] = []
    await runPool([1, 2, 3], 2, async n => {
      if (n === 2) throw new Error('boom')
      done.push(n)
    })
    expect(done.sort()).toEqual([1, 3])
  })

  it('reports progress once per item, counting failures', async () => {
    const progress: number[] = []
    await runPool([1, 2, 3], 1, async n => { if (n === 2) throw new Error('boom') }, {
      onProgress: done => progress.push(done),
    })
    expect(progress).toEqual([1, 2, 3])
  })

  it('stops starting new work once shouldAbort turns true', async () => {
    const started: number[] = []
    let abort = false
    const gate = deferred()
    const run = runPool([1, 2, 3, 4, 5, 6], 1, async n => {
      started.push(n)
      if (n === 2) { abort = true; await gate.promise }
    }, { shouldAbort: () => abort })
    gate.resolve()
    await run
    // Items 1 and 2 ran; the abort is checked before each subsequent start.
    expect(started).toEqual([1, 2])
  })

  it('handles an empty input without hanging', async () => {
    let called = false
    await runPool([], 4, async () => { called = true })
    expect(called).toBe(false)
  })
})
