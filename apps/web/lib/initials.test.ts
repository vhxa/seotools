import { describe, expect, it } from 'vitest'
import { getInitials } from './initials'

describe('getInitials', () => {
  it('uses the first and last word of the name', () => {
    expect(getInitials('Ada Lovelace')).toBe('AL')
    expect(getInitials('  grace   brewster  murray hopper ')).toBe('GH')
  })

  it('uses a single initial for one-word names', () => {
    expect(getInitials('Aaron')).toBe('A')
  })

  it('handles characters outside the BMP', () => {
    expect(getInitials('𝒜da')).toBe('𝒜')
  })

  it('falls back to the email, then to a placeholder', () => {
    expect(getInitials('  ', 'zoe@example.com')).toBe('Z')
    expect(getInitials('')).toBe('?')
  })
})
