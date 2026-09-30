import { describe, it, expect } from 'vitest'
import type { IntegrityCheck } from '../types'
import { papersDueForCheck, primaryNotice } from './integrity'

const NOW = Date.parse('2026-09-28T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const p = (id: string) => ({ id, title: `Paper ${id}`, source: '' })
const check = (status: IntegrityCheck['status'], ageDays: number): IntegrityCheck =>
  ({ status, notices: [], checkedAt: new Date(NOW - ageDays * DAY).toISOString() })

describe('papersDueForCheck', () => {
  it('checks new papers, retries unresolved ones after a day, and refreshes clear ones monthly', () => {
    const due = papersDueForCheck(
      [p('new'), p('fresh'), p('unres-old'), p('unres-new'), p('clear-old'), p('retracted')],
      {
        fresh: check('clear', 3),
        'unres-old': check('unresolved', 2),
        'unres-new': check('unresolved', 0.5),
        'clear-old': check('clear', 45),
        retracted: check('retracted', 10),
      },
      NOW,
    )
    expect(due.map(x => x.id)).toEqual(['new', 'unres-old', 'clear-old'])
  })
})

describe('primaryNotice', () => {
  it('links a retracted paper to its retraction, not to a correction', () => {
    const c: IntegrityCheck = {
      status: 'retracted', checkedAt: '', notices: [
        { type: 'correction', label: 'Correction', doi: '10.1/corr' },
        { type: 'retraction', label: 'Retraction', doi: '10.1/retr' },
      ],
    }
    expect(primaryNotice(c)?.doi).toBe('10.1/retr')
  })
})
