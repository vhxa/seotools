import { describe, expect, it } from 'vitest'
import {
  MAX_CRAWL_URL_LENGTH,
  crawlUrlHash,
  isInternalUrl,
  normalizeCrawlUrl,
  parsePriorityUrl,
} from './url'

describe('normalizeCrawlUrl', () => {
  it.each([
    ['HTTPS://Example.COM/a', 'https://example.com/a'],
    ['https://example.com:443/a', 'https://example.com/a'],
    ['http://example.com:80', 'http://example.com/'],
    ['https://example.com/a#section', 'https://example.com/a'],
    ['https://example.com/a b', 'https://example.com/a%20b'],
    ['  https://example.com/  ', 'https://example.com/'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCrawlUrl(input)).toBe(expected)
  })

  it('keeps what makes two URLs different to a search engine', () => {
    expect(normalizeCrawlUrl('https://example.com/a/')).toBe('https://example.com/a/')
    expect(normalizeCrawlUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(normalizeCrawlUrl('https://example.com/a?b=1&a=2')).toBe('https://example.com/a?b=1&a=2')
    expect(normalizeCrawlUrl('https://example.com/Path')).toBe('https://example.com/Path')
  })

  it('resolves against a base', () => {
    const base = 'https://example.com/blog/post'
    expect(normalizeCrawlUrl('other', base)).toBe('https://example.com/blog/other')
    expect(normalizeCrawlUrl('../x', base)).toBe('https://example.com/x')
    expect(normalizeCrawlUrl('//cdn.example.org/a.js', base)).toBe('https://cdn.example.org/a.js')
    expect(normalizeCrawlUrl('?page=2', base)).toBe('https://example.com/blog/post?page=2')
  })

  it.each([
    'mailto:a@example.com',
    'tel:+34600000000',
    'javascript:void(0)',
    'data:text/plain,hi',
    'ftp://example.com/file',
    'https://user:pass@example.com/',
    '',
    '   ',
    'not a url',
    `https://example.com/${'a'.repeat(MAX_CRAWL_URL_LENGTH)}`,
  ])('rejects %s', (input) => {
    expect(normalizeCrawlUrl(input)).toBeNull()
  })
})

describe('isInternalUrl', () => {
  it.each([
    ['https://example.com/', true],
    ['http://example.com/a', true],
    ['https://www.example.com/a', true],
    ['https://blog.example.com/', false],
    ['https://www.blog.example.com/', false],
    ['https://example.org/', false],
    ['https://notexample.com/', false],
    ['https://example.com.evil.org/', false],
    ['https://example.com:8080/', false],
  ])('%s → %s', (url, expected) => {
    expect(isInternalUrl(url, 'example.com')).toBe(expected)
  })

  it('treats a tracked subdomain as its own site', () => {
    expect(isInternalUrl('https://blog.example.com/', 'blog.example.com')).toBe(true)
    expect(isInternalUrl('https://www.blog.example.com/', 'blog.example.com')).toBe(true)
    expect(isInternalUrl('https://example.com/', 'blog.example.com')).toBe(false)
  })
})

describe('crawlUrlHash', () => {
  it('is stable and depends on the whole URL', () => {
    expect(crawlUrlHash('https://example.com/a')).toBe(crawlUrlHash('https://example.com/a'))
    expect(crawlUrlHash('https://example.com/a')).not.toBe(crawlUrlHash('https://example.com/b'))
    expect(crawlUrlHash('https://example.com/a')).toHaveLength(32)
  })
})

describe('parsePriorityUrl', () => {
  it.each([
    ['https://example.com/pricing', 'https://example.com/pricing'],
    ['http://www.example.com/a#x', 'http://www.example.com/a'],
    ['/pricing', 'https://example.com/pricing'],
    ['example.com/pricing', 'https://example.com/pricing'],
    ['www.example.com', 'https://www.example.com/'],
  ])('%s → %s', (input, expected) => {
    expect(parsePriorityUrl(input, 'example.com')).toBe(expected)
  })

  it.each([
    'https://other.com/',
    'other.com/x',
    'mailto:a@example.com',
    '',
    'https://blog.example.com',
  ])('rejects %s', (input) => {
    expect(parsePriorityUrl(input, 'example.com')).toBeNull()
  })
})
