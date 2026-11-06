import { describe, expect, it } from 'vitest'
import { parseFindingAcceptance, rulesOfAcceptance } from './acceptance'

describe('parseFindingAcceptance', () => {
  it('reads the three shapes back, keeping what was stored', () => {
    const condition = {
      kind: 'condition',
      condition: 'noindex',
      requirement: 'allowed',
      rule: 'r1',
    }
    expect(parseFindingAcceptance(condition)).toEqual(condition)
    expect(
      parseFindingAcceptance({
        kind: 'condition',
        condition: 'robots',
        requirement: 'required',
        rule: null,
      }),
    ).toMatchObject({ rule: null })
    expect(parseFindingAcceptance({ kind: 'expectation', rule: null })).toEqual({
      kind: 'expectation',
      rule: null,
    })
    const relation = { kind: 'relation', end: 'origin', blockers: ['noindex'], rules: ['a'] }
    expect(parseFindingAcceptance(relation)).toEqual(relation)
    expect(rulesOfAcceptance(parseFindingAcceptance(relation)!)).toEqual(['a'])
  })

  it('refuses anything that does not check out', () => {
    for (const bad of [
      null,
      undefined,
      'x',
      42,
      [],
      {},
      { kind: 'other' },
      { kind: 'condition', condition: 'noindex', requirement: 'allowed' },
      { kind: 'condition', condition: 1, requirement: 'allowed', rule: null },
      { kind: 'expectation', rule: 3 },
      { kind: 'expectation' },
      { kind: 'relation', end: 'middle', blockers: [], rules: [] },
      { kind: 'relation', end: 'origin', blockers: [1], rules: [] },
      { kind: 'relation', end: 'origin', blockers: [], rules: 'a' },
      { kind: 'relation', end: 'origin', blockers: [] },
    ]) {
      expect(parseFindingAcceptance(bad)).toBeNull()
    }
  })
})
