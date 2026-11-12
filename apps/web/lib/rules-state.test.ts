import { describe, expect, it } from 'vitest'
import { rulesStateOf, sameRulesOf } from './rules-state'

describe('which rules a crawl was analysed with', () => {
  it('is the current ones when the number is the one in force', () => {
    expect(rulesStateOf(3, 3)).toBe('current')
    // A domain that never had rules is still on its current (none).
    expect(rulesStateOf(0, 0)).toBe('current')
  })
  it('is changed when the rules moved on, whichever way', () => {
    expect(rulesStateOf(2, 3)).toBe('changed')
    expect(rulesStateOf(0, 1)).toBe('changed')
  })
  it('says a crawl that was not analysed is not analysed', () => {
    expect(rulesStateOf(null, 3)).toBe('notAnalysed')
  })
  it('compares two crawls, and does not guess when one was not analysed', () => {
    expect(sameRulesOf(2, 2)).toBe(true)
    expect(sameRulesOf(2, 3)).toBe(false)
    expect(sameRulesOf(null, 3)).toBeNull()
  })
})
