import { describe, it, expect } from 'vitest'
import type { CertaintyAssessment } from '../types'
import { awaitingReview, downgradeReasons, finalLevel, levelSymbols, ruleLevel } from './certainty'

function grade(start: 'high' | 'low', judgements: Record<string, string>, over: Partial<CertaintyAssessment> = {}): CertaintyAssessment {
  return {
    themeId: 't', framework: 'grade', finding: '', startLevel: start, assessedAt: '',
    domains: Object.fromEntries(Object.entries(judgements).map(([k, v]) => [k, { judgement: v, rationale: '', aiGenerated: false, verifiedByStudent: true }])),
    ...over,
  }
}

describe('GRADE rule', () => {
  it('starts randomised evidence at high and moves down per concern', () => {
    expect(ruleLevel(grade('high', {}))).toBe('high')
    expect(ruleLevel(grade('high', { risk_of_bias: 'serious' }))).toBe('moderate')
    expect(ruleLevel(grade('high', { risk_of_bias: 'serious', imprecision: 'very_serious' }))).toBe('very_low')
  })

  it('never goes below very low', () => {
    expect(ruleLevel(grade('low', { risk_of_bias: 'very_serious', imprecision: 'very_serious' }))).toBe('very_low')
  })

  it('applies upgrading factors only to evidence that starts low', () => {
    expect(ruleLevel(grade('low', { large_effect: 'large' }))).toBe('moderate')
    expect(ruleLevel(grade('high', { risk_of_bias: 'serious', large_effect: 'very_large' }))).toBe('moderate')
  })

  it('names the domains that lowered the rating', () => {
    expect(downgradeReasons(grade('high', { risk_of_bias: 'serious', inconsistency: 'no_concern' }))).toEqual(['risk of bias'])
  })
})

describe('CERQual rule', () => {
  const cq = (j: Record<string, string>): CertaintyAssessment => ({ ...grade('high', j), framework: 'cerqual', startLevel: undefined })

  it('starts at high and moves down for moderate and serious concerns', () => {
    expect(ruleLevel(cq({ coherence: 'no_or_very_minor' }))).toBe('high')
    expect(ruleLevel(cq({ adequacy: 'moderate' }))).toBe('moderate')
    expect(ruleLevel(cq({ adequacy: 'serious' }))).toBe('low')
  })

  it('weighs several minor concerns together', () => {
    expect(ruleLevel(cq({ coherence: 'minor' }))).toBe('high')
    expect(ruleLevel(cq({ coherence: 'minor', relevance: 'minor' }))).toBe('moderate')
  })
})

describe('override and review state', () => {
  it('shows the reviewer\'s override over the rule', () => {
    const a = grade('high', { risk_of_bias: 'serious' }, { override: { level: 'high', reason: 'Bias would not change the direction' } })
    expect(ruleLevel(a)).toBe('moderate')
    expect(finalLevel(a)).toBe('high')
  })

  it('is awaiting review while an applicable AI draft is unconfirmed', () => {
    const a = grade('high', { risk_of_bias: 'serious' })
    a.domains.risk_of_bias.aiGenerated = true
    a.domains.risk_of_bias.verifiedByStudent = false
    expect(awaitingReview(a)).toBe(true)
    // An unconfirmed upgrading factor does not count when it does not apply.
    const b = grade('high', { large_effect: 'none' })
    b.domains.large_effect.aiGenerated = true
    b.domains.large_effect.verifiedByStudent = false
    expect(awaitingReview(b)).toBe(false)
  })

  it('draws the GRADE symbols', () => {
    expect(levelSymbols('moderate')).toBe('⊕⊕⊕◯')
  })
})
