import { describe, expect, it } from 'vitest'
import { auditSnapshotOf } from './audit'
import { auditScopeKey } from './compare'
import {
  DEFAULT_THRESHOLDS,
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
