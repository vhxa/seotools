import { describe, expect, it } from 'vitest'
import { decryptString, encryptString } from './crypto'

const key = 'k'.repeat(32)

describe('encryptString / decryptString', () => {
  it('round-trips, with a fresh IV each time', () => {
    const a = encryptString('smtp-password', key)
    const b = encryptString('smtp-password', key)
    expect(a).not.toBe(b)
    expect(a).not.toContain('smtp-password')
    expect(decryptString(a, key)).toBe('smtp-password')
  })

  it('fails with the wrong key, with a helpful message', () => {
    expect(() => decryptString(encryptString('x', key), 'z'.repeat(32))).toThrow(/changed/)
  })

  it('detects tampering and unknown formats', () => {
    const payload = encryptString('x', key)
    const raw = Buffer.from(payload.slice(3), 'base64')
    raw[raw.length - 1]! ^= 1
    expect(() => decryptString(`v1:${raw.toString('base64')}`, key)).toThrow()
    expect(() => decryptString('plain text', key)).toThrow(/Unsupported/)
  })
})
