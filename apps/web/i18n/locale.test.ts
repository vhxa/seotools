import { describe, expect, it } from 'vitest'
import { localeCookieOptions, parseLocale, resolveLocale, resolveRequestLocale } from './locale'

describe('resolveLocale', () => {
  it.each([
    [null, 'en'],
    [undefined, 'en'],
    ['', 'en'],
    ['en', 'en'],
    ['es', 'es'],
    ['es-MX', 'es'],
    ['ES-es', 'es'],
    ['en-US,en;q=0.9', 'en'],
    ['es-ES,es;q=0.9,en;q=0.8', 'es'],
    ['en;q=0.5, es;q=0.9', 'es'],
    ['en, es', 'en'],
    ['fr-FR, es;q=0.5', 'es'],
    ['fr-FR, de;q=0.8', 'en'],
    ['*', 'en'],
    ['es;q=0, en', 'en'],
    ['es;q=nonsense, en;q=0.1', 'en'],
  ])('%j → %s', (header, expected) => {
    expect(resolveLocale(header)).toBe(expected)
  })
})

describe('resolveRequestLocale', () => {
  it('prefers a valid saved language over the browser', () => {
    expect(resolveRequestLocale('es', 'en-US')).toBe('es')
    expect(resolveRequestLocale('en', 'es')).toBe('en')
  })
  it('ignores a cookie that is not a shipped language', () => {
    for (const bad of ['fr', 'ES', '', '../es', 'es;en']) {
      expect(parseLocale(bad)).toBeNull()
      expect(resolveRequestLocale(bad, 'es')).toBe('es')
    }
  })
  it('falls back to the browser, then English, without a cookie', () => {
    expect(resolveRequestLocale(undefined, 'es-MX')).toBe('es')
    expect(resolveRequestLocale(null, null)).toBe('en')
  })
  it('sets the cookie secure only when served over https', () => {
    expect(localeCookieOptions(true)).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    })
    expect(localeCookieOptions(false).secure).toBe(false)
  })
})
