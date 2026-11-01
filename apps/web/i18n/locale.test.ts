import { describe, expect, it } from 'vitest'
import { resolveLocale } from './locale'

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
