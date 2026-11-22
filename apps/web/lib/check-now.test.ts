import { describe, expect, it } from 'vitest'
import { isCheckable, parseCheckRequest } from './check-now'

const hash = (n: number) => n.toString(16).padStart(32, '0')
const request = (urlHashes: unknown, overrides: Record<string, unknown> = {}) =>
  parseCheckRequest({ from: 'a', to: 'b', side: 'base', urlHashes, ...overrides }, 50)

// WP4 fix round, finding 10.
describe('parseCheckRequest', () => {
  it('bounds the raw list before reading it', () => {
    expect(request(Array.from({ length: 51 }, () => 'x'))).toEqual({ ok: false, error: 'tooMany' })
    expect(request([...Array.from({ length: 50 }, () => hash(1))])).toMatchObject({
      ok: true,
      urlHashes: [hash(1)],
    })
  })

  it('keeps only well-formed hashes, once each, and refuses anything else', () => {
    expect(request([hash(1), hash(1), 'nope', 3, null])).toMatchObject({ urlHashes: [hash(1)] })
    expect(request(['nope'])).toEqual({ ok: false, error: 'none' })
    expect(request('not a list')).toEqual({ ok: false, error: 'none' })
    expect(request([hash(1)], { side: 'both' })).toEqual({ ok: false, error: 'none' })
    expect(parseCheckRequest(null, 50)).toEqual({ ok: false, error: 'none' })
  })
})

describe('isCheckable', () => {
  it('offers only URLs the side has and the other lacks, never one a setting explains', () => {
    expect(isCheckable({ inSide: true, inOther: false, reason: 'unlinked' })).toBe(true)
    expect(isCheckable({ inSide: true, inOther: false, reason: null })).toBe(true)
    expect(isCheckable({ inSide: false, inOther: false, reason: null })).toBe(false)
    expect(isCheckable({ inSide: true, inOther: true, reason: null })).toBe(false)
    for (const reason of ['merged', 'split', 'settings', 'mode'])
      expect(isCheckable({ inSide: true, inOther: false, reason }), reason).toBe(false)
  })
})
