import { crawlUrlHash, type CrawlLinkKind } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REDIRECT_LINKS_SHOWN, REDIRECTING_PAGE_SIZE, loadRedirectLinks } from './redirect-links'

const SITE = 'https://acme.com'
const hashOf = (url: string) => crawlUrlHash(url)
const TARGET = `${SITE}/a`

let db: Database

const outcome = (statusCode: number) => ({
  kind: 'page' as const,
  statusCode,
  contentType: null,
  redirectTo: null,
  title: null,
  metaRobots: null,
  xRobotsTag: null,
  canonical: null,
  responseTimeMs: null,
  bytes: null,
  error: null,
  data: null,
})

/** `redirecting` URLs redirect to `/a`; `/home` links to each of them and to `/a` directly. */
async function crawlWithRedirects(redirecting: number) {
  const created = await createCompany(db, { name: 'Acme', domain: 'acme.com' })
  if (!created.ok) throw new Error('setup failed')
  const crawl = await db.crawls.start({
    domainId: created.domain.id,
    type: 'full',
    trigger: 'manual',
  })
  if (!crawl) throw new Error('crawl did not start')
  const redirects = Array.from(
    { length: redirecting },
    (_, index) => `${SITE}/a-${String(index).padStart(2, '0')}/`,
  )
  const urls = [`${SITE}/home`, TARGET, ...redirects]
  await db.crawls.addUrls(
    crawl.id,
    urls.map((url, index) => ({
      seq: index + 1,
      url,
      urlHash: hashOf(url),
      scope: 'internal' as const,
      source: 'link' as const,
      depth: 1,
    })),
  )
  const link = (from: string, to: string, kind: CrawlLinkKind) => ({
    sourceHash: hashOf(from),
    targetHash: hashOf(to),
    kind,
  })
  await db.crawls.recordResult({
    crawlId: crawl.id,
    urlHash: hashOf(`${SITE}/home`),
    result: outcome(200),
    links: [
      link(`${SITE}/home`, TARGET, 'anchor'),
      ...redirects.map((r) => link(`${SITE}/home`, r, 'anchor')),
    ],
  })
  for (const url of redirects) {
    await db.crawls.recordResult({
      crawlId: crawl.id,
      urlHash: hashOf(url),
      result: outcome(301),
      links: [link(url, TARGET, 'redirect')],
    })
  }
  return crawl.id
}

beforeEach(async () => {
  db = await createTestDatabase()
})
afterEach(async () => {
  await db.close()
})

describe('loadRedirectLinks', () => {
  it('lists the URLs that redirect here with the links that point at them, not at this URL', async () => {
    const crawlId = await crawlWithRedirects(2)
    const page = await loadRedirectLinks(db.crawls, { crawlId, urlHash: hashOf(TARGET) })
    expect(page.total).toBe(2)
    expect(page.items.map((item) => item.url)).toEqual([`${SITE}/a-00/`, `${SITE}/a-01/`])
    for (const item of page.items) {
      expect(item.statusCode).toBe(301)
      expect(item.links).toBe(1)
      expect(item.sources.map((source) => [source.url, source.kind])).toEqual([
        [`${SITE}/home`, 'anchor'],
      ])
    }
  })

  it('has nothing for a URL no other URL redirects to', async () => {
    const crawlId = await crawlWithRedirects(2)
    const page = await loadRedirectLinks(db.crawls, { crawlId, urlHash: hashOf(`${SITE}/home`) })
    expect(page).toMatchObject({ total: 0, page: 1, pageCount: 1, items: [] })
  })

  it('pages the redirecting URLs and clamps the page', async () => {
    const crawlId = await crawlWithRedirects(REDIRECTING_PAGE_SIZE + 3)
    const first = await loadRedirectLinks(db.crawls, { crawlId, urlHash: hashOf(TARGET) })
    expect(first.pageCount).toBe(2)
    expect(first.items).toHaveLength(REDIRECTING_PAGE_SIZE)
    const second = await loadRedirectLinks(db.crawls, {
      crawlId,
      urlHash: hashOf(TARGET),
      page: 99,
    })
    expect(second.page).toBe(2)
    expect(second.items).toHaveLength(3)
    expect(REDIRECT_LINKS_SHOWN).toBeGreaterThan(0)
  })
})
