import { crawlUrlHash } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { searchUrls, URL_SEARCH_LIMIT } from './url-search'

let db: Database

const outcome = (title: string | null) => ({
  kind: 'page' as const,
  statusCode: 200,
  contentType: null,
  redirectTo: null,
  title,
  metaRobots: null,
  xRobotsTag: null,
  canonical: null,
  responseTimeMs: null,
  bytes: null,
  error: null,
  data: null,
})

/** A domain with a finished full crawl of these URLs (address and title). */
async function crawled(host: string, pages: [url: string, title: string | null][]) {
  const created = await createCompany(db, { name: host, domain: host })
  if (!created.ok) throw new Error('setup failed')
  const domainId = created.domain.id
  const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
  if (!crawl) throw new Error('crawl did not start')
  await db.crawls.addUrls(
    crawl.id,
    pages.map(([url], index) => ({
      url,
      urlHash: crawlUrlHash(url),
      scope: 'internal' as const,
      source: 'link' as const,
      depth: 1,
      seq: index + 1,
    })),
  )
  for (const [url, title] of pages) {
    await db.crawls.recordResult({
      crawlId: crawl.id,
      urlHash: crawlUrlHash(url),
      result: outcome(title),
    })
  }
  await db.crawls.finish(crawl.id, { status: 'completed' })
  return domainId
}

beforeEach(async () => {
  db = await createTestDatabase()
})
afterEach(async () => {
  await db.close()
})

describe('searchUrls', () => {
  it('finds URLs by address or by title, whatever the case, with what the detail needs', async () => {
    const domainId = await crawled('acme.com', [
      ['https://acme.com/', 'Home'],
      ['https://acme.com/pricing', 'Plans'],
      ['https://acme.com/blog', 'Pricing tips'],
    ])
    const hits = await searchUrls(db.crawls, domainId, ' PRICING ')
    expect(hits.map((hit) => hit.url)).toEqual([
      'https://acme.com/blog',
      'https://acme.com/pricing',
    ])
    expect(hits[1]).toEqual({
      hash: crawlUrlHash('https://acme.com/pricing'),
      url: 'https://acme.com/pricing',
      title: 'Plans',
      statusCode: 200,
    })
  })

  it('finds nothing for empty text, text that is not text, or no match', async () => {
    const domainId = await crawled('acme.com', [['https://acme.com/', 'Home']])
    for (const input of ['', '   ', null, undefined, 42, { search: 'acme' }, 'zzz']) {
      expect(await searchUrls(db.crawls, domainId, input)).toEqual([])
    }
  })

  it('treats % and _ as text, not as wildcards', async () => {
    const domainId = await crawled('acme.com', [
      ['https://acme.com/a', 'Home'],
      ['https://acme.com/100%25', '100% sure'],
    ])
    const hits = await searchUrls(db.crawls, domainId, '%')
    expect(hits.map((hit) => hit.url)).toEqual(['https://acme.com/100%25'])
  })

  it('offers a bounded number of URLs', async () => {
    const pages = Array.from(
      { length: URL_SEARCH_LIMIT + 4 },
      (_, index): [string, string | null] => [`https://acme.com/p${index}`, null],
    )
    const domainId = await crawled('acme.com', pages)
    expect(await searchUrls(db.crawls, domainId, 'acme')).toHaveLength(URL_SEARCH_LIMIT)
  })

  it('reads only the crawl of the domain', async () => {
    const a = await crawled('acme.com', [['https://acme.com/shared', null]])
    await crawled('other.org', [['https://other.org/shared', null]])
    expect((await searchUrls(db.crawls, a, 'shared')).map((hit) => hit.url)).toEqual([
      'https://acme.com/shared',
    ])
  })

  it('finds nothing in a domain that was never crawled', async () => {
    const created = await createCompany(db, { name: 'new.io', domain: 'new.io' })
    if (!created.ok) throw new Error('setup failed')
    expect(await searchUrls(db.crawls, created.domain.id, 'new')).toEqual([])
  })
})
