import { describe, expect, it } from 'vitest'
import { discoverySentences } from './discovery-chain'

const step = (url: string, foundKind: 'anchor' | 'redirect' | 'sitemap' | null) => ({
  url,
  urlHash: url,
  foundKind,
  context: null,
})

describe('discoverySentences', () => {
  it('takes each relation from the step it leads to', () => {
    const { sentences, earlierMissing } = discoverySentences([
      step('https://a.test/sitemap.xml', null),
      step('https://a.test/x', 'sitemap'),
      step('https://a.test/y/', 'anchor'),
      step('https://a.test/y', 'redirect'),
    ])
    expect(earlierMissing).toBe(false)
    expect(sentences.map((s) => [s.from.url, s.kind, s.to.url, s.isLast])).toEqual([
      ['https://a.test/sitemap.xml', 'sitemap', 'https://a.test/x', false],
      ['https://a.test/x', 'anchor', 'https://a.test/y/', false],
      ['https://a.test/y/', 'redirect', 'https://a.test/y', true],
    ])
  })

  it('says when the path starts in the middle', () => {
    const { earlierMissing, sentences } = discoverySentences([
      step('https://a.test/x', 'anchor'),
      step('https://a.test/y', 'anchor'),
    ])
    expect(earlierMissing).toBe(true)
    expect(sentences).toHaveLength(1)
  })

  it('keeps a missing kind as null', () => {
    const { sentences } = discoverySentences([
      step('https://a.test/', null),
      step('https://a.test/z', null),
    ])
    expect(sentences[0]?.kind).toBeNull()
  })
})
