import { describe, expect, it, vi } from 'vitest'
import type { CrawlUrl } from '@seotools/db'
import { automaticFileChecks, isAutomaticFileCheck } from './automatic-checks'

describe('automatic file check origin', () => {
  it('uses stored origin and links, never the filename', () => {
    expect(isAutomaticFileCheck('llms', 0, true)).toBe(true)
    expect(isAutomaticFileCheck('sitemap-file', 0, true)).toBe(true)
    expect(isAutomaticFileCheck('link', 0, true)).toBe(false)
    expect(isAutomaticFileCheck('llms', 1, true)).toBe(false)
    expect(isAutomaticFileCheck('llms', 0, false)).toBe(false)
    expect(isAutomaticFileCheck('seed', 0, true)).toBe(false)
  })

  const url = { source: 'llms', urlHash: 'file', url: 'https://example.com/llms.txt' } as CrawlUrl

  it('uses the selected crawl and detects links found after the probe was queued', async () => {
    const crawls = {
      listUrls: vi.fn().mockResolvedValue([{ statusCode: 200 }]),
      linkSources: vi.fn().mockResolvedValue([{ url: 'https://example.com/' }]),
    }
    expect(await automaticFileChecks(crawls, 'historical', [url])).toEqual(new Set())
    expect(crawls.linkSources).toHaveBeenCalledWith('historical', 'file', { limit: 1 })
    crawls.linkSources.mockResolvedValue([])
    expect(await automaticFileChecks(crawls, 'historical', [url])).toEqual(new Set(['file']))
  })

  it('does not turn an unanswered site into successful absence', async () => {
    const crawls = {
      listUrls: vi.fn().mockResolvedValue([{ statusCode: 503 }]),
      linkSources: vi.fn(),
    }
    expect(await automaticFileChecks(crawls, 'crawl', [url])).toEqual(new Set())
    expect(crawls.linkSources).not.toHaveBeenCalled()
  })
})
