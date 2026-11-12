import { describe, expect, it } from 'vitest'
import { botAccessVerdict } from './bot-access'
const ok = { statusCode: 200, finalUrl: 'https://example.com/', errorCode: null }
describe('bot access comparison', () => {
  it('treats statuses in the same class as the same', () => {
    expect(botAccessVerdict(ok, { ...ok, statusCode: 204 })).toEqual({
      verdict: 'same',
      reasons: [],
    })
  })
  it.each([403, 429, 503])('records refusal %s and the status class change', (statusCode) => {
    expect(botAccessVerdict(ok, { ...ok, statusCode })).toEqual({
      verdict: 'different',
      reasons: ['status-class', 'refused'],
    })
  })
  it('records another status class', () =>
    expect(botAccessVerdict(ok, { ...ok, statusCode: 301 }).reasons).toEqual(['status-class']))
  it('records another final address', () =>
    expect(botAccessVerdict(ok, { ...ok, finalUrl: 'https://example.com/login' }).reasons).toEqual([
      'final-url',
    ]))
  it.each(['TIMEOUT', 'ENOTFOUND', 'CERT_HAS_EXPIRED'])('never concludes from %s', (errorCode) => {
    const failed = { ...ok, errorCode }
    expect(botAccessVerdict(failed, ok).verdict).toBe('unknown')
    expect(botAccessVerdict(ok, failed).verdict).toBe('unknown')
  })
  it('needs both statuses and final addresses', () => {
    expect(botAccessVerdict(ok, { ...ok, statusCode: null }).verdict).toBe('unknown')
    expect(botAccessVerdict({ ...ok, finalUrl: null }, ok).verdict).toBe('unknown')
  })
})
