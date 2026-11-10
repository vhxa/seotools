import { describe, expect, it } from 'vitest'
import { auditSnapshotOf } from './audit'
import { auditScopeKey } from './compare'
import {
  DEFAULT_THRESHOLDS,
  THRESHOLD_ISSUES,
  canonicalThresholds,
  parseThresholdOverrides,
  resolveThresholds,
  thresholdsProblem,
} from './thresholds'

describe('thresholds', () => {
  it('are the recommended figures unless a domain sets its own', () => {
    expect(resolveThresholds()).toEqual(DEFAULT_THRESHOLDS)
    expect(resolveThresholds({ thinWords: 100 })).toMatchObject({ thinWords: 100, titleMax: 60 })
  })

  it('keep only what differs from the defaults', () => {
    expect(canonicalThresholds({ titleMax: 60, thinWords: 100 })).toEqual({ thinWords: 100 })
    expect(canonicalThresholds(null)).toEqual({})
  })

  it('refuse stored values out of range, and figures that contradict each other', () => {
    expect(parseThresholdOverrides({ thinWords: 0, urlMax: 200, other: 1 })).toEqual({})
    expect(parseThresholdOverrides({ urlMax: 200 })).toEqual({ urlMax: 200 })
    expect(thresholdsProblem(resolveThresholds({ titleMin: 70 }))).toBe('title')
    expect(thresholdsProblem(resolveThresholds({ descriptionMin: 200 }))).toBe('description')
    expect(thresholdsProblem(DEFAULT_THRESHOLDS)).toBeNull()
  })

  it('include how long a page may take to answer, which only slow-response reads', () => {
    expect(DEFAULT_THRESHOLDS.responseTimeMaxMs).toBe(1000)
    expect(THRESHOLD_ISSUES['slow-response']).toEqual(['responseTimeMaxMs'])
    expect(parseThresholdOverrides({ responseTimeMaxMs: 2500 })).toEqual({
      responseTimeMaxMs: 2500,
    })
    expect(parseThresholdOverrides({ responseTimeMaxMs: 5 })).toEqual({})
    const slower = auditSnapshotOf(1, [], undefined, { responseTimeMaxMs: 2500 })
    expect(slower.thresholds).toEqual({ responseTimeMaxMs: 2500 })
    expect(auditScopeKey(slower)).not.toBe(auditScopeKey(auditSnapshotOf(1, [])))
  })

  it('are part of the configuration an analysis keeps, and of what makes two the same', () => {
    const defaults = auditSnapshotOf(1, [])
    const own = auditSnapshotOf(1, [], undefined, { thinWords: 100 })
    expect(defaults.thresholds).toBeUndefined()
    expect(own.thresholds).toEqual({ thinWords: 100 })
    expect(auditScopeKey(own)).not.toBe(auditScopeKey(defaults))
    // Setting the default explicitly is the default.
    expect(auditScopeKey(auditSnapshotOf(1, [], undefined, { titleMax: 60 }))).toBe(
      auditScopeKey(defaults),
    )
  })
})
