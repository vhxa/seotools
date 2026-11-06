import { crawlUrlHash, LINKS_PAGE_SIZE, type CrawlLinkKind } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyHref, hrefPattern, loadUrlLinks } from './url-links'

const SITE = 'https://acme.com'
const HOME = `${SITE}/`

let db: Database
let crawlId: string

const hashOf = (url: string) => crawlUrlHash(url)
const outcome = (kind: 'page' | 'resource', statusCode = 200) => ({
  kind,
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

/** A home page that links to `count` pages, loads a script and an image, and declares a canonical. */
async function crawlOfAHome(count: number) {
  const created = await createCompany(db, { name: 'Acme', domain: 'acme.com' })
  if (!created.ok) throw new Error('setup failed')
  const crawl = await db.crawls.start({
    domainId: created.domain.id,
    type: 'full',
    trigger: 'manual',
  })
  if (!crawl) throw new Error('crawl did not start')
  const pages = Array.from(
    { length: count },
    (_, index) => `${SITE}/p/${String(index).padStart(3, '0')}`,
  )
  const others = [`${SITE}/app.js`, `${SITE}/logo.png`]
  const entry = (url: string, index: number) => ({
    seq: index + 1,
    url,
    urlHash: hashOf(url),
    scope: 'internal' as const,
    source: 'link' as const,
    depth: 1,
  })
  await db.crawls.addUrls(crawl.id, [HOME, ...pages, ...others].map(entry))
  const link = (target: string, kind: CrawlLinkKind) => ({
    sourceHash: hashOf(HOME),
    targetHash: hashOf(target),
    kind,
  })
  await db.crawls.recordResult({
    crawlId: crawl.id,
    urlHash: hashOf(HOME),
    result: outcome('page'),
    links: [
      ...pages.map((url) => link(url, 'anchor')),
      link(`${SITE}/app.js`, 'script'),
      link(`${SITE}/logo.png`, 'image'),
      link(HOME, 'canonical'),
    ],
  })
  return crawl.id
}

beforeEach(async () => {
  db = await createTestDatabase()
})
afterEach(async () => {
  await db.close()
})

describe('loadUrlLinks', () => {
  beforeEach(async () => {
    crawlId = await crawlOfAHome(60)
  })

  const load = (input: Partial<Parameters<typeof loadUrlLinks>[1]> = {}) =>
    loadUrlLinks(db.crawls, {
      crawlId,
      urlHash: hashOf(HOME),
      direction: 'out',
      ...input,
    })

  it('opens on navigation links, and counts the rest so that they can be found', async () => {
    const page = await load()
    expect(page.filter).toEqual({ group: 'navigation', kind: null, search: '' })
    expect(page.total).toBe(60)
    expect(page.items).toHaveLength(LINKS_PAGE_SIZE)
    expect(page.items.every((item) => item.kind === 'anchor')).toBe(true)
    expect(page.pageCount).toBe(Math.ceil(60 / LINKS_PAGE_SIZE))
    // Resources and declarations are not in the list, but they are on offer.
    expect(page.counts).toMatchObject({ anchor: 60, script: 1, image: 1, canonical: 1 })
  })

  it('reaches every link by paging, with no cap and no dead end', async () => {
    const seen: string[] = []
    const first = await load()
    for (let page = 1; page <= first.pageCount; page++) {
      seen.push(...(await load({ page })).items.map((item) => item.url))
    }
    expect(seen).toHaveLength(60)
    expect(new Set(seen).size).toBe(60)
  })

  it('shows resources when asked for them, and every type under all', async () => {
    const resources = await load({ filter: { group: 'resources', kind: null, search: '' } })
    expect(resources.items.map((item) => item.kind).sort()).toEqual(['image', 'script'])
    const images = await load({ filter: { group: 'resources', kind: 'image', search: '' } })
    expect(images.items.map((item) => item.url)).toEqual([`${SITE}/logo.png`])
    const all = await load({ filter: { group: 'all', kind: null, search: '' } })
    expect(all.total).toBe(63)
    expect(all.counts.canonical).toBe(1)
  })

  it('searches within the filter, and the counts stay those of the whole direction', async () => {
    const page = await load({ filter: { group: 'navigation', kind: null, search: '/P/05' } })
    expect(page.total).toBe(10)
    expect(page.counts.anchor).toBe(60)
    const none = await load({ filter: { group: 'resources', kind: null, search: '/p/' } })
    expect(none.total).toBe(0)
    expect(none.items).toEqual([])
    expect(none.pageCount).toBe(1)
  })

  it('takes a page past the end as the last one, and one before the start as the first', async () => {
    expect((await load({ page: 99 })).page).toBe(3)
    expect((await load({ page: 0 })).page).toBe(1)
    expect((await load({ page: Number.NaN })).page).toBe(1)
  })

  it('lists incoming links apart from outgoing ones', async () => {
    const incoming = await load({ direction: 'in' })
    // Only the canonical points at the home page, and it is not navigation.
    expect(incoming.total).toBe(0)
    expect(incoming.counts).toMatchObject({ canonical: 1, anchor: 0 })
    const declared = await load({
      direction: 'in',
      filter: { group: 'declared', kind: null, search: '' },
    })
    expect(declared.items.map((item) => [item.url, item.kind])).toEqual([[HOME, 'canonical']])
    const target = await load({ direction: 'in', urlHash: hashOf(`${SITE}/p/000`) })
    expect(target.items.map((item) => item.url)).toEqual([HOME])
    expect(target.counts.anchor).toBe(1)
  })

  it('reads nothing of another crawl', async () => {
    const empty = await loadUrlLinks(db.crawls, {
      crawlId: '00000000-0000-0000-0000-000000000000',
      urlHash: hashOf(HOME),
      direction: 'out',
    })
    expect(empty).toMatchObject({ total: 0, items: [], page: 1, pageCount: 1 })
    expect(Object.values(empty.counts).every((count) => count === 0)).toBe(true)
  })
})

describe('hrefPattern', () => {
  it('preserves a search containing the placeholder hash', () => {
    const hrefFor = (hash: string) =>
      `/domains/acme.com/pages/details?q=${'0'.repeat(32)}&url=${hash}`
    const hash = hashOf(`${SITE}/about`)
    expect(applyHref(hrefPattern(hrefFor), hash)).toBe(hrefFor(hash))
  })

  it('turns where a detail opens into something that can cross to the browser', () => {
    const drawer = (hash: string) => `/domains/acme.com/pages/details?crawl=abc&url=${hash}`
    const page = (hash: string) => `/domains/acme.com/pages/details/${hash}?crawl=abc`
    for (const hrefFor of [drawer, page]) {
      const pattern = hrefPattern(hrefFor)
      const hash = hashOf(`${SITE}/about`)
      expect(applyHref(pattern, hash)).toBe(hrefFor(hash))
    }
    expect(hrefPattern(page)).toEqual({
      prefix: '/domains/acme.com/pages/details/',
      suffix: '?crawl=abc',
    })
  })
})
