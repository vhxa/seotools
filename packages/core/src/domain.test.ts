import { describe, expect, it } from 'vitest'
import { normalizeDomain } from './domain'

describe('normalizeDomain', () => {
  it.each([
    ['example.com', 'example.com'],
    ['  Example.COM  ', 'example.com'],
    ['https://example.com', 'example.com'],
    ['HTTP://Example.com/', 'example.com'],
    ['https://www.example.com/blog/post?x=1#top', 'example.com'],
    ['www.example.com', 'example.com'],
    ['example.com.', 'example.com'],
    ['example.com/path', 'example.com'],
    ['example.com?utm=1', 'example.com'],
    ['shop.example.co.uk', 'shop.example.co.uk'],
    ['blog.example.com', 'blog.example.com'],
    ['www.blog.example.com', 'blog.example.com'],
    ['my-site.io', 'my-site.io'],
    ['a1.b2.example.org', 'a1.b2.example.org'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected)
  })

  it('only strips a www prefix when a registrable domain remains', () => {
    expect(normalizeDomain('www.com')).toBe('www.com')
    expect(normalizeDomain('www.www.com')).toBe('www.com')
  })

  it('stores internationalized domains as punycode', () => {
    expect(normalizeDomain('Bücher.example')).toBe('xn--bcher-kva.example')
    expect(normalizeDomain('https://www.münchen.de/')).toBe('xn--mnchen-3ya.de')
    expect(normalizeDomain('пример.рф')).toBe('xn--e1afmkfd.xn--p1ai')
  })

  it('is idempotent', () => {
    const once = normalizeDomain('https://WWW.Bücher.example/x')
    expect(once).not.toBeNull()
    expect(normalizeDomain(once!)).toBe(once)
  })

  it.each([
    [''],
    ['   '],
    ['localhost'],
    ['example'],
    ['https://'],
    ['127.0.0.1'],
    ['https://192.168.0.1/admin'],
    ['[::1]'],
    ['example.com:8080'],
    ['user:pass@example.com'],
    ['user@example.com'],
    ['exa mple.com'],
    ['-example.com'],
    ['example-.com'],
    ['exa_mple.com'],
    ['.example.com'],
    ['example..com'],
    ['example.c'],
    ['example.123'],
    ['a'.repeat(64) + '.com'],
    [`${'a.'.repeat(130)}com`],
  ])('rejects %j', (input) => {
    expect(normalizeDomain(input)).toBeNull()
  })
})
