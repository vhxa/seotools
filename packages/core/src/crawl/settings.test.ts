import { describe, expect, it } from 'vitest'
import { DEFAULT_CRAWL_SETTINGS, crawlSettingsSchema, crawlSkipReason } from './settings'

describe('crawl scope', () => {
  it('normalizes audit prefixes and matches whole segments, with exclusion winning', () => {
    const settings = crawlSettingsSchema.parse({
      ...DEFAULT_CRAWL_SETTINGS,
      includePrefixes: ['/shop/./', '/shop'],
      excludePrefixes: ['/shop/private/'],
    })
    expect(settings.includePrefixes).toEqual(['/shop'])
    expect(crawlSkipReason('https://example.com/shop/a?q=1', 1, settings)).toBeUndefined()
    expect(crawlSkipReason('https://example.com/shopping', 1, settings)).toBe('excluded')
    expect(crawlSkipReason('https://example.com/shop/private/a', 1, settings)).toBe('excluded')
  })
  it('limits depth and validates bounds and invalid paths', () => {
    const settings = { ...DEFAULT_CRAWL_SETTINGS, maxDepth: 1 }
    expect(crawlSkipReason('https://example.com/a', 1, settings)).toBeUndefined()
    expect(crawlSkipReason('https://example.com/a', 2, settings)).toBe('depth')
    for (const invalid of [
      { maxDepth: 0 },
      { maxDepth: 101 },
      { includePrefixes: ['/a?x'] },
      { excludePrefixes: Array.from({ length: 101 }, () => '/a') },
    ]) {
      expect(crawlSettingsSchema.safeParse({ ...settings, ...invalid }).success).toBe(false)
    }
  })
})
