import { describe, expect, it } from 'vitest'
import { displayUrl } from './url-display'

describe('displayUrl', () => {
  const host = 'example.com'

  it('shows path and query for the primary origin', () => {
    expect(displayUrl('https://example.com/ca/aire-magazine?page=10', host)).toBe(
      '/ca/aire-magazine?page=10',
    )
    expect(displayUrl('https://example.com/', host)).toBe('/')
    expect(displayUrl('https://example.com', host)).toBe('/')
    expect(displayUrl('https://example.com?a=1', host)).toBe('/?a=1')
  })

  it('keeps the full address of any other origin', () => {
    for (const url of [
      'http://example.com/a',
      'https://www.example.com/a',
      'https://blog.example.com/a',
      'https://example.com:8443/a',
      'https://example.com.evil.org/a',
      'https://other.org/a',
      'https://example.community/a',
    ]) {
      expect(displayUrl(url, host)).toBe(url)
    }
  })
})
