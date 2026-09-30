import { describe, it, expect } from 'vitest'
import { aiLabelFor, beginAiRequest, cancelAiRequests, getAiActivity } from './aiActivity'
import { runPool } from './runPool'

const API = 'http://localhost:8001/api'

describe('aiLabelFor', () => {
  it('labels AI endpoints', () => {
    expect(aiLabelFor(`${API}/topics/generate-profile`, API)).toBe('Generating research topics')
    expect(aiLabelFor(`${API}/matrix/autofill-row?x=1`, API)).toBe('Extracting data into the matrix')
  })

  it('ignores persistence, analytics and chat', () => {
    expect(aiLabelFor(`${API}/projects/abc`, API)).toBeNull()
    expect(aiLabelFor(`${API}/analytics/event`, API)).toBeNull()
    expect(aiLabelFor(`${API}/chat/assistant`, API)).toBeNull()
    expect(aiLabelFor(`${API}/search/sources`, API)).toBeNull()
  })

  it('ignores other hosts', () => {
    expect(aiLabelFor('https://example.org/api/search', API)).toBeNull()
  })
})

describe('beginAiRequest', () => {
  it('tracks requests until each one ends, and ending twice is harmless', () => {
    const a = beginAiRequest('A')
    const b = beginAiRequest('B', { background: true })
    expect(getAiActivity().requests.map(r => [r.label, r.background])).toEqual([['A', false], ['B', true]])
    a.end()
    a.end()
    expect(getAiActivity().requests.map(r => r.label)).toEqual(['B'])
    b.end()
    expect(getAiActivity().requests).toEqual([])
  })

  it('follows the caller\'s own abort signal', () => {
    const caller = new AbortController()
    const r = beginAiRequest('A', { signal: caller.signal })
    caller.abort()
    expect(r.signal.aborted).toBe(true)
    r.end()
  })
})

describe('cancelAiRequests', () => {
  it('aborts foreground requests and leaves background ones running', () => {
    const fg = beginAiRequest('Generating')
    const bg = beginAiRequest('Scoring', { background: true })
    cancelAiRequests()
    expect(fg.signal.aborted).toBe(true)
    expect((fg.signal.reason as DOMException).name).toBe('AbortError')
    expect(bg.signal.aborted).toBe(false)
    fg.end()
    bg.end()
  })

  it('stops a batch before its next item', async () => {
    const started: number[] = []
    await runPool([1, 2, 3, 4], 1, async n => {
      started.push(n)
      if (n === 2) cancelAiRequests()
    })
    expect(started).toEqual([1, 2])
  })

  it('does not stop a batch that starts afterwards', async () => {
    cancelAiRequests()
    const started: number[] = []
    await runPool([1, 2, 3], 1, async n => { started.push(n) })
    expect(started).toEqual([1, 2, 3])
  })
})
