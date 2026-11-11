import {
  EMPTY_AUDIT_SNAPSHOT,
  ISSUE_CATALOG_VERSION,
  createLogger,
  crawlUrlHash,
  domainRequestSettings,
} from '@seotools/core'
import { createCompany, deleteDomain } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JobInterruptedError } from '../types'
import { analyseCrawl } from './analysis'
import { reanalyseOutdatedCrawls } from './reanalysis'
import { runCrawl, type CrawlEngineOptions } from './engine'
import { fakeSite, html, moved, notFound } from './fake-site'
import { FetchError, type FetchedResponse } from './fetcher'

const log = createLogger('test', 'silent')

let db: Database
let domainId: string

beforeEach(async () => {
  db = await createTestDatabase()
  const created = await createCompany(db, { name: 'Acme', domain: 'example.com' })
  if (!created.ok) throw new Error('setup failed')
  domainId = created.domain.id
  await db.crawls.saveSettings(domainId, {
    ...(await db.crawls.settings(domainId)),
    requestsPerSecond: 100,
  })
})
afterEach(async () => {
  await db.close()
})

/** An analysis as the ones made before audit configuration existed: no rules, nothing excluded. */
const saveIssues = (input: Omit<Parameters<Database['crawls']['saveAnalysis']>[0], 'audit'>) =>
  db.crawls.saveAnalysis({
    ...input,
    audit: {
      snapshot: EMPTY_AUDIT_SNAPSHOT,
      pages: { audited: 0, excluded: 0, indexable: 0, notIndexable: 0, unknownIndexability: 0 },
      urls: [],
    },
  })

async function crawlWith(
  site: ReturnType<typeof fakeSite>,
  type: 'full' | 'priority' = 'full',
  overrides: Partial<CrawlEngineOptions> = {},
) {
  const crawl = await db.crawls.start({ domainId, type, trigger: 'manual' })
  if (!crawl) throw new Error('crawl did not start')
  const summary = await runCrawl(crawl.id, {
    db,
    log,
    signal: new AbortController().signal,
    createFetcher: site.createFetcher,
    retryBaseMs: 1,
    ...overrides,
  })
  return { crawl: (await db.crawls.get(crawl.id))!, summary }
}

const urls = async (crawlId: string, view: 'pages' | 'errors' | 'other' | 'external') =>
  (await db.crawls.listUrls({ crawlId, view, limit: 1000, offset: 0 })).map((u) => u.url).sort()
const row = async (crawlId: string, url: string) =>
  (await db.crawls.latestResults(domainId, [crawlUrlHash(url)])).find((r) => r.crawlId === crawlId)

describe('full crawl', () => {
  it('reads what the custom extractors ask from every page', async () => {
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      extractors: [{ key: 'price', name: 'Price', selector: '.price', attribute: null }],
    })
    const site = fakeSite({
      'https://example.com/': html('<p class="price"> 49 € </p><a href="/b">b</a>'),
      'https://example.com/b': html('<p>No price</p>'),
    })
    const { crawl } = await crawlWith(site)
    expect((await row(crawl.id, 'https://example.com/'))?.data?.extracted).toEqual({
      price: ['49 €'],
    })
    expect((await row(crawl.id, 'https://example.com/b'))?.data?.extracted).toBeUndefined()
  })

  it('keeps how each URL was found and where each link sits, and what was asked as a file stays one', async () => {
    const site = fakeSite({
      'https://example.com/': html(
        `<head><script src="/gone.js"></script></head>
        <body><nav><a class="menu-item" href="/about">About us</a></nav></body>`,
      ),
      'https://example.com/about': html('<title>About</title>'),
      // A missing script answered with the site's HTML error page.
      'https://example.com/gone.js': {
        statusCode: 404,
        headers: { 'content-type': 'text/html' },
        body: Buffer.from('<html><title>Not found</title></html>'),
      },
    })
    const { crawl } = await crawlWith(site)
    const home = await row(crawl.id, 'https://example.com/')
    const about = await row(crawl.id, 'https://example.com/about')
    expect(about).toMatchObject({ foundFrom: home!.seq, foundKind: 'anchor' })
    expect(await row(crawl.id, 'https://example.com/gone.js')).toMatchObject({
      kind: 'resource',
      statusCode: 404,
      foundKind: 'script',
    })
    expect(await urls(crawl.id, 'pages')).not.toContain('https://example.com/gone.js')
    expect(await urls(crawl.id, 'errors')).toContain('https://example.com/gone.js')

    const [link] = await db.crawls.listLinks({
      crawlId: crawl.id,
      urlHash: crawlUrlHash('https://example.com/'),
      direction: 'out',
      kinds: ['anchor'],
      limit: 10,
      offset: 0,
    })
    expect(link).toMatchObject({
      url: 'https://example.com/about',
      context: { text: 'About us', element: 'a.menu-item', region: 'nav' },
    })
    expect(crawl.ref).toBeGreaterThan(0)
  })

  it('reaches every URL from the homepage, the sitemap and everything linked', async () => {
    const site = fakeSite({
      'https://example.com/': html(`
        <head><link rel="canonical" href="https://example.com/">
          <link rel="alternate" hreflang="es" href="/es"><link rel="stylesheet" href="/s.css"></head>
        <body><a href="/about">About</a><img src="/logo.png"></body>`),
      'https://example.com/about': html('<title>About</title><a href="/deep">deep</a>'),
      'https://example.com/deep': html('<title>Deep</title>'),
      'https://example.com/es': html('<title>Inicio</title>'),
      'https://example.com/s.css': {
        headers: { 'content-type': 'text/css' },
        body: Buffer.from('body { background: url(/bg.png) }'),
      },
      'https://example.com/logo.png': { headers: { 'content-type': 'image/png' } },
      'https://example.com/bg.png': { headers: { 'content-type': 'image/png' } },
      'https://example.com/robots.txt': {
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from('User-agent: *\nDisallow: /\nSitemap: https://example.com/custom.xml'),
      },
      'https://example.com/custom.xml': {
        headers: { 'content-type': 'application/xml' },
        body: Buffer.from(
          '<sitemapindex><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>',
        ),
      },
      'https://example.com/child.xml': {
        headers: { 'content-type': 'application/xml' },
        body: Buffer.from(
          '<urlset><url><loc>https://example.com/only-in-sitemap</loc></url></urlset>',
        ),
      },
      'https://example.com/only-in-sitemap': html('<title>Orphan</title>'),
    })

    const { crawl } = await crawlWith(site)

    expect(crawl.status).toBe('completed')
    expect(await urls(crawl.id, 'pages')).toEqual(
      expect.arrayContaining([
        'https://example.com/',
        'https://example.com/about',
        'https://example.com/deep',
        'https://example.com/es',
        'https://example.com/only-in-sitemap',
      ]),
    )
    expect(site.requests).toContain('https://example.com/logo.png')
    expect(site.requests).toContain('https://example.com/bg.png')
    expect(await db.crawls.nextQueued(crawl.id, 10)).toEqual([])
    expect(site.closed()).toBe(1)
  })

  it('never lets robots.txt, meta robots or nofollow stop it', async () => {
    const site = fakeSite({
      'https://example.com/robots.txt': {
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from('User-agent: *\nDisallow: /'),
      },
      'https://example.com/': html(
        '<meta name="robots" content="noindex, nofollow"><a rel="nofollow" href="/private">x</a>',
        { 'x-robots-tag': 'none' },
      ),
      'https://example.com/private': html('<title>Private</title>'),
    })

    const { crawl } = await crawlWith(site)

    expect(site.requests).toContain('https://example.com/private')
    expect(crawl.robots?.['https://example.com']).toEqual({
      status: 200,
      body: 'User-agent: *\nDisallow: /',
    })
    expect(await row(crawl.id, 'https://example.com/')).toMatchObject({
      metaRobots: 'noindex, nofollow',
      xRobotsTag: 'none',
    })
  })

  it('stores what each page says about itself', async () => {
    const site = fakeSite({
      'https://example.com/': html(`
        <title>Home</title><meta name="description" content="Desc">
        <meta name="googlebot" content="noindex">
        <link rel="canonical" href="/canon"><h1>Welcome</h1>
        <link rel="alternate" hreflang="es" href="/es">`),
    })
    const { crawl } = await crawlWith(site)
    expect(await row(crawl.id, 'https://example.com/')).toMatchObject({
      kind: 'page',
      statusCode: 200,
      title: 'Home',
      canonical: 'https://example.com/canon',
      data: {
        description: 'Desc',
        h1: ['Welcome'],
        hreflang: [{ lang: 'es', url: 'https://example.com/es' }],
        botRobots: { googlebot: 'noindex' },
      },
    })
  })

  it('records external URLs and who links to them, without counting them', async () => {
    const site = fakeSite({
      'https://example.com/': html(`
        <a href="https://elsewhere.org/a">x</a>
        <a href="https://blog.example.com/">subdomain</a>
        <a href="https://example.com:8080/">other port</a>
        <img src="https://cdn.org/i.png">`),
      'https://example.com/b': html('<a href="https://elsewhere.org/a">again</a>'),
      'https://www.example.com/': html('<a href="https://example.com/b">b</a>'),
    })
    const { crawl } = await crawlWith(site)

    expect(await urls(crawl.id, 'external')).toEqual([
      'https://blog.example.com/',
      'https://cdn.org/i.png',
      'https://elsewhere.org/a',
      'https://example.com:8080/',
    ])
    expect(crawl.externalCount).toBe(4)
    const sources = await db.crawls.linkSources(crawl.id, crawlUrlHash('https://elsewhere.org/a'))
    expect(sources.map((s) => s.url).sort()).toEqual([
      'https://example.com/',
      'https://example.com/b',
    ])
  })

  it('covers the host and www, over http and https', async () => {
    const site = fakeSite({})
    await crawlWith(site)
    expect(site.requests).toEqual(
      expect.arrayContaining([
        'https://example.com/',
        'http://example.com/',
        'https://www.example.com/',
        'http://www.example.com/',
      ]),
    )
    expect(site.requests.filter((url) => !/^https?:\/\/(www\.)?example\.com\//.test(url))).toEqual(
      [],
    )
  })

  it('counts only HTML that answered 2xx as pages; redirects, resources and failures are the rest', async () => {
    const site = fakeSite({
      'https://example.com/': html(
        '<a href="/moved">m</a><a href="/doc.pdf">p</a><a href="/gone">g</a><a href="/down">d</a>',
      ),
      'https://example.com/moved': moved('/target'),
      'https://example.com/target': html('<title>Target</title>'),
      'https://example.com/doc.pdf': { headers: { 'content-type': 'application/pdf' } },
      'https://example.com/down': new FetchError('ECONNRESET', 'reset'),
      'http://example.com/': moved('https://example.com/'),
      'https://www.example.com/': moved('https://example.com/'),
      'http://www.example.com/': new FetchError('ENOTFOUND', 'no such host'),
      'https://example.com/robots.txt': notFound,
      'https://example.com/sitemap.xml': notFound,
    })
    const { crawl } = await crawlWith(site)

    const pages = await urls(crawl.id, 'pages')
    expect(pages).toEqual(
      expect.arrayContaining(['https://example.com/', 'https://example.com/target']),
    )
    // A broken page is an error, listed with the other failures, with its status.
    expect(await urls(crawl.id, 'errors')).toEqual(
      expect.arrayContaining(['https://example.com/gone', 'https://example.com/down']),
    )
    for (const url of [
      'https://example.com/gone',
      'https://example.com/moved',
      'https://example.com/doc.pdf',
      'https://example.com/down',
      'https://example.com/robots.txt',
      'https://example.com/sitemap.xml',
      'http://example.com/',
    ]) {
      expect(pages).not.toContain(url)
    }
    expect(await row(crawl.id, 'https://example.com/moved')).toMatchObject({
      kind: 'redirect',
      statusCode: 301,
      redirectTo: 'https://example.com/target',
    })
    expect(await row(crawl.id, 'https://example.com/gone')).toMatchObject({
      kind: 'page',
      statusCode: 404,
    })
    expect(await row(crawl.id, 'https://example.com/down')).toMatchObject({
      kind: 'unknown',
      statusCode: null,
      error: 'ECONNRESET: reset',
    })
    expect(crawl.pagesCount).toBe(pages.length)
  })

  it('parses a sitemap or robots.txt where a redirect takes it', async () => {
    const site = fakeSite({
      'http://example.com/robots.txt': moved('https://example.com/robots.txt'),
      'https://example.com/robots.txt': {
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from('Sitemap: https://example.com/moved.xml'),
      },
      'https://example.com/moved.xml': moved('https://example.com/real.xml'),
      'https://example.com/real.xml': {
        headers: { 'content-type': 'application/xml' },
        body: Buffer.from('<urlset><url><loc>https://example.com/listed</loc></url></urlset>'),
      },
      'https://example.com/listed': html('<title>Listed</title>'),
    })
    const { crawl } = await crawlWith(site)
    expect(site.requests).toContain('https://example.com/listed')
    expect(await urls(crawl.id, 'pages')).toContain('https://example.com/listed')
    expect(await urls(crawl.id, 'pages')).not.toContain('https://example.com/real.xml')
  })

  it('always starts from the priority URLs too, so orphan pages are not missed', async () => {
    await db.priorityUrls.add({ domainId, url: 'https://example.com/landing' })
    const site = fakeSite({ 'https://example.com/landing': html('<title>Landing</title>') })
    const { crawl } = await crawlWith(site)
    expect(await urls(crawl.id, 'pages')).toContain('https://example.com/landing')
  })

  it('terminates on link loops', async () => {
    const site = fakeSite({
      'https://example.com/': html('<a href="/a">a</a>'),
      'https://example.com/a': html('<a href="/b">b</a><a href="/">home</a>'),
      'https://example.com/b': html('<a href="/a">a</a><a href="/b">self</a>'),
    })
    const { crawl } = await crawlWith(site)
    expect(crawl.status).toBe('completed')
    expect(site.requests.filter((url) => url === 'https://example.com/a')).toHaveLength(1)
  })

  it('stops at the URL limit and says it is incomplete', async () => {
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      maxUrls: 12,
    })
    const links = Array.from({ length: 50 }, (_, i) => `<a href="/p${i}">x</a>`).join('')
    const site = fakeSite({ 'https://example.com/': html(links) })

    const { crawl, summary } = await crawlWith(site)

    expect(crawl.status).toBe('incomplete')
    expect(summary?.status).toBe('incomplete')
    expect(crawl.urlsCount).toBe(12)
    expect(site.requests.length).toBeLessThanOrEqual(12)
    expect(await db.crawls.nextQueued(crawl.id, 10)).toEqual([])
  })

  it('has no limit when none is set', async () => {
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      maxUrls: null,
    })
    const links = Array.from({ length: 300 }, (_, i) => `<a href="/p${i}">x</a>`).join('')
    const site = fakeSite({ 'https://example.com/': html(links) })
    const { crawl } = await crawlWith(site)
    expect(crawl.status).toBe('completed')
    expect(site.requests.filter((url) => /\/p\d+$/.test(url))).toHaveLength(300)
  })
})

describe('settings', () => {
  it('uses the default User-Agent, or the one of the domain', async () => {
    const first = fakeSite({})
    await crawlWith(first, 'full', { appVersion: '1.2.3' })
    expect(first.configs[0]?.userAgent).toMatch(/^SeoToolsBot\/1\.2\.3 \(\+https:/)

    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      userAgent: 'Custom/1.0',
      timeoutMs: 5000,
    })
    const second = fakeSite({})
    await crawlWith(second)
    expect(second.configs[0]).toMatchObject({ userAgent: 'Custom/1.0', timeoutMs: 5000 })
  })

  it('respects the concurrency', async () => {
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      concurrency: 3,
    })
    const links = Array.from({ length: 30 }, (_, i) => `<a href="/p${i}">x</a>`).join('')
    const site = fakeSite({ 'https://example.com/': html(links) }, 40)
    await crawlWith(site)
    expect(site.peak()).toBeLessThanOrEqual(3)
    expect(site.peak()).toBeGreaterThan(1)
  })

  it('respects the rate limit', async () => {
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      requestsPerSecond: 50,
      concurrency: 10,
    })
    const site = fakeSite({})
    const started = Date.now()
    await crawlWith(site)
    // 16 seeds at 50 per second need at least 15 intervals of 20 ms.
    expect(site.requests).toHaveLength(16)
    expect(Date.now() - started).toBeGreaterThanOrEqual(15 * 20 - 5)
  })

  it('applies the retention of the domain when a crawl ends', async () => {
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      retainCrawls: 1,
    })
    const first = await crawlWith(fakeSite({}))
    await new Promise((r) => setTimeout(r, 5))
    const second = await crawlWith(fakeSite({}))
    expect((await db.crawls.get(first.crawl.id))?.pruned).toBe(true)
    expect(await db.crawls.knownUrls(first.crawl.id)).toEqual([])
    expect((await db.crawls.get(second.crawl.id))?.pruned).toBe(false)
  })
})

describe('page issues', () => {
  // Besides the home page, /bare and /missing, the crawl tries the other schemes and `www`. Those
  // answer 404 but nothing links to them, so they are not issues of the site.
  const site = () =>
    fakeSite({
      'https://example.com/': html(
        `<title>Home</title><a href="/bare">x</a><a href="/missing">x</a>`,
      ),
      'https://example.com/bare': html('<p>Nothing here</p>'),
    })
  const issuesOf = async (crawlId: string, url: string) =>
    (await db.crawls.issuesOf(crawlId, [crawlUrlHash(url)])).map((i) => i.issue)

  it('checks every URL of a full crawl when it ends', async () => {
    const { crawl } = await crawlWith(site())
    // The home page and /bare: /missing and what only the crawler tried answered 404.
    expect(crawl.pagesCount).toBe(2)
    const counted = crawl.pagesByWorstIssue!
    expect(counted.issue + counted.warning + counted.opportunity).toBeLessThanOrEqual(2)
    expect(await issuesOf(crawl.id, 'https://example.com/bare')).toContain('title-missing')
    expect(await issuesOf(crawl.id, 'https://example.com/missing')).toEqual(['client-error'])
    // Only the crawler ever asked for this one.
    expect(await issuesOf(crawl.id, 'https://www.example.com/')).toEqual([])
    const counts = await db.crawls.issueCounts(crawl.id)
    expect(counts).toContainEqual({ issue: 'client-error', pages: 1, secondary: 0 })
  })

  it('sorts pages by the worst type of issue they have', async () => {
    const { crawl } = await crawlWith(site())
    // The home page links to /missing, which does not exist: an issue. /bare has no title, a
    // warning. /missing itself is an error, not a page, so it is not counted here.
    expect(crawl.pagesByWorstIssue).toEqual({ issue: 1, warning: 1, opportunity: 0 })
  })

  it('counts a page under every type it has something of', async () => {
    const { crawl } = await crawlWith(site())
    // Every page that has a warning also lacks a meta description, which is an opportunity: it is
    // not hidden because something worse was found.
    const withType = crawl.pagesWithType!
    expect(withType.issue).toBe(1)
    expect(withType.warning).toBe(2)
    expect(withType.opportunity).toBeGreaterThan(crawl.pagesByWorstIssue!.opportunity)
  })

  it('leaves a priority crawl unanalysed: it only sees a few pages', async () => {
    await db.priorityUrls.add({ domainId, url: 'https://example.com/bare' })
    const { crawl } = await crawlWith(site(), 'priority')
    expect(crawl.pagesByWorstIssue).toBeNull()
  })

  it('can check a crawl again', async () => {
    const { crawl } = await crawlWith(site())
    const before = crawl.pagesByWorstIssue
    await saveIssues({
      crawlId: crawl.id,
      issues: [],
      pages: { issue: 0, warning: 0, opportunity: 0 },
      withType: { issue: 0, warning: 0, opportunity: 0 },
      catalog: 'old',
    })
    const again = await analyseCrawl(db, crawl.id, EMPTY_AUDIT_SNAPSHOT)
    expect(again.pages).toBe(2)
    expect(again.pagesByWorstIssue).toEqual(before)
    expect((await db.crawls.get(crawl.id))?.pagesByWorstIssue).toEqual(before)
  })
})

describe('a changed issue catalog', () => {
  it('analyses the crawls of the old one again, once', async () => {
    const { crawl } = await crawlWith(
      fakeSite({ 'https://example.com/': html('<title>Home</title>') }),
    )
    const current = (await db.crawls.get(crawl.id))!
    expect(current.issueCatalog).toBe(ISSUE_CATALOG_VERSION)
    const log = createLogger('test', 'silent')
    expect(await reanalyseOutdatedCrawls({ db, log })).toBe(0)

    // What a crawl analysed before the catalog changed looks like: other totals, other version.
    await saveIssues({
      crawlId: crawl.id,
      issues: [{ urlHash: 'x', issue: 'retired-check' }],
      pages: { issue: 99, warning: 0, opportunity: 0 },
      withType: { issue: 99, warning: 0, opportunity: 0 },
      catalog: 'old',
    })
    expect(await reanalyseOutdatedCrawls({ db, log })).toBe(1)
    const after = (await db.crawls.get(crawl.id))!
    expect(after.issueCatalog).toBe(ISSUE_CATALOG_VERSION)
    expect(after.pagesByWorstIssue).toEqual(current.pagesByWorstIssue)
    expect(after.pagesWithType).toEqual(current.pagesWithType)
    expect(await reanalyseOutdatedCrawls({ db, log })).toBe(0)
  })

  it('stops when asked', async () => {
    const { crawl } = await crawlWith(
      fakeSite({ 'https://example.com/': html('<title>Home</title>') }),
    )
    await saveIssues({
      crawlId: crawl.id,
      issues: [],
      pages: { issue: 0, warning: 0, opportunity: 0 },
      withType: { issue: 0, warning: 0, opportunity: 0 },
      catalog: 'old',
    })
    expect(
      await reanalyseOutdatedCrawls({
        db,
        log: createLogger('test', 'silent'),
        stopped: () => true,
      }),
    ).toBe(0)
  })
})

describe('links to other sites', () => {
  it('requests the URLs anchors link to, once each, and nothing else of other sites', async () => {
    const site = fakeSite({
      'https://example.com/': html(`
        <a href="https://elsewhere.org/a">x</a>
        <a rel="nofollow" href="https://elsewhere.org/nofollow">x</a>
        <a href="https://example.com:8080/">other port</a>
        <img src="https://cdn.org/i.png">`),
      'https://example.com/b': html('<a href="https://elsewhere.org/a">again</a>'),
      'https://www.example.com/': html('<a href="https://example.com/b">b</a>'),
      'https://elsewhere.org/a': html('fine'),
    })
    const { crawl } = await crawlWith(site)

    expect(site.requests.filter((url) => url === 'https://elsewhere.org/a')).toHaveLength(1)
    expect(site.requests).toContain('https://elsewhere.org/nofollow')
    expect(site.requests).not.toContain('https://cdn.org/i.png')
    // A link should not be able to point the crawler at any service of a host.
    expect(site.requests).not.toContain('https://example.com:8080/')
    expect(await db.crawls.pendingExternalLinks(crawl.id, 10)).toEqual([])

    const external = await db.crawls.listUrls({
      crawlId: crawl.id,
      view: 'external',
      limit: 10,
      offset: 0,
    })
    expect(external.find((url) => url.url.endsWith('/a'))).toMatchObject({
      statusCode: 200,
      kind: 'unknown',
      state: 'done',
    })
    expect(external.find((url) => url.url.endsWith('/nofollow'))?.statusCode).toBe(404)
    expect(crawl).toMatchObject({ externalCount: 4 })
  })

  it('never asks for them in a priority crawl', async () => {
    await db.priorityUrls.add({ domainId, url: 'https://example.com/p' })
    const site = fakeSite({
      'https://example.com/p': html('<a href="https://elsewhere.org/a">x</a>'),
    })
    await crawlWith(site, 'priority')
    expect(site.requests).toEqual(['https://example.com/p'])
  })

  it('tells a broken link from a site that only refuses bots', async () => {
    const site = fakeSite({
      'https://example.com/': html(`
        <a href="https://elsewhere.org/ok">x</a>
        <a href="https://elsewhere.org/gone">x</a>
        <a href="https://elsewhere.org/refuses">x</a>
        <a href="https://elsewhere.org/down">x</a>`),
      'https://elsewhere.org/ok': html('fine'),
      'https://elsewhere.org/refuses': { statusCode: 403, headers: {} },
      'https://elsewhere.org/down': new FetchError('ENOTFOUND', 'no such host'),
    })
    const { crawl } = await crawlWith(site)
    const broken = await db.crawls.listUrls({
      crawlId: crawl.id,
      view: 'pages',
      issue: 'broken-external-link',
      limit: 10,
      offset: 0,
    })
    expect(broken.map((url) => url.url).sort()).toEqual([
      'https://elsewhere.org/down',
      'https://elsewhere.org/gone',
    ])
  })

  it('can be cancelled while it checks them', async () => {
    let cancel = () => {}
    const site = fakeSite({
      'https://example.com/': html(
        Array.from({ length: 30 }, (_, i) => `<a href="https://elsewhere.org/${i}">x</a>`).join(''),
      ),
      'https://elsewhere.org/0': () => {
        cancel()
        return html('fine')
      },
    })
    const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    cancel = () => void db.crawls.cancel(crawl!.id)
    const summary = await runCrawl(crawl!.id, {
      db,
      log,
      signal: new AbortController().signal,
      createFetcher: site.createFetcher,
      retryBaseMs: 1,
    })
    expect(summary?.status).toBe('cancelled')
  })
})

describe('politeness and failures', () => {
  it('retries when a server asks to slow down, then records what it answered', async () => {
    let calls = 0
    const site = fakeSite({
      'https://example.com/': () =>
        ++calls < 3
          ? { statusCode: 429, headers: { 'retry-after': '0' } }
          : html('<title>ok</title>'),
      'https://www.example.com/': { statusCode: 503, headers: {} },
    })
    const { crawl } = await crawlWith(site)

    expect(calls).toBe(3)
    expect(await row(crawl.id, 'https://example.com/')).toMatchObject({
      statusCode: 200,
      title: 'ok',
    })
    // Out of retries: the 503 is the result.
    expect(site.requests.filter((url) => url === 'https://www.example.com/')).toHaveLength(3)
    expect((await row(crawl.id, 'https://www.example.com/'))?.statusCode).toBe(503)
  })

  it('waits for Retry-After before any other request', async () => {
    let first = true
    const times: number[] = []
    const site = fakeSite({
      'https://example.com/': () => {
        times.push(Date.now())
        if (first) {
          first = false
          return { statusCode: 429, headers: { 'retry-after': '1' } }
        }
        return html('<title>ok</title>')
      },
    })
    await crawlWith(site)
    expect(times).toHaveLength(2)
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(950)
  })

  it('retries network errors, but not those that would fail again', async () => {
    let flaky = 0
    const site = fakeSite({
      'https://example.com/': () =>
        ++flaky === 1 ? new FetchError('ECONNRESET', 'reset') : html('<title>ok</title>'),
      'https://www.example.com/': new FetchError('ENOTFOUND', 'no such host'),
      'http://www.example.com/': new FetchError('BLOCKED_ADDRESS', 'private'),
    })
    const { crawl } = await crawlWith(site)

    expect(flaky).toBe(2)
    expect(site.requests.filter((url) => url === 'https://www.example.com/')).toHaveLength(1)
    expect(site.requests.filter((url) => url === 'http://www.example.com/')).toHaveLength(1)
    expect((await row(crawl.id, 'http://www.example.com/'))?.error).toMatch(/BLOCKED_ADDRESS/)
    expect(crawl.status).toBe('completed')
  })

  it('a site that is down is a finding, not a failed crawl', async () => {
    const down = new FetchError('ECONNREFUSED', 'refused')
    const site = fakeSite({
      'https://example.com/': down,
      'http://example.com/': down,
      'https://www.example.com/': down,
      'http://www.example.com/': down,
    })
    const { crawl } = await crawlWith(site)
    expect(crawl.status).toBe('completed')
    expect(crawl.pagesCount).toBe(0)
  })

  it('survives pages that make the parser unhappy', async () => {
    const site = fakeSite({
      'https://example.com/': html('<<<<a href=/ok>>><title><title></a></a>'),
      'https://example.com/sitemap.xml': {
        headers: { 'content-type': 'application/xml' },
        body: Buffer.from([0x1f, 0x8b, 0x00, 0x00]), // not really gzip
      },
    })
    const { crawl } = await crawlWith(site)
    expect(crawl.status).toBe('completed')
  })
})

describe('priority crawl', () => {
  it('requests only the marked URLs and follows nothing', async () => {
    await db.priorityUrls.add({ domainId, url: 'https://example.com/pricing' })
    await db.priorityUrls.add({ domainId, url: 'https://example.com/moved' })
    const site = fakeSite({
      'https://example.com/pricing': html('<title>Pricing</title><a href="/new">new</a>'),
      'https://example.com/moved': moved('/elsewhere'),
    })

    const { crawl } = await crawlWith(site, 'priority')

    expect(crawl.status).toBe('completed')
    expect(site.requests.sort()).toEqual([
      'https://example.com/moved',
      'https://example.com/pricing',
    ])
    expect(crawl.urlsCount).toBe(2)
    expect(await row(crawl.id, 'https://example.com/pricing')).toMatchObject({ title: 'Pricing' })
    expect(await row(crawl.id, 'https://example.com/moved')).toMatchObject({
      redirectTo: 'https://example.com/elsewhere',
    })
  })

  it('ends right away with nothing marked', async () => {
    const site = fakeSite({})
    const { crawl } = await crawlWith(site, 'priority')
    expect(crawl.status).toBe('completed')
    expect(site.requests).toEqual([])
  })
})

describe('interruptions', () => {
  it('stops when cancelled, removing its partial results', async () => {
    const links = Array.from({ length: 2000 }, (_, i) => `<a href="/p${i}">x</a>`).join('')
    const started = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    let cancelled = false
    const site = fakeSite({ 'https://example.com/': html(links) })
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      requestsPerSecond: 50,
    })
    setTimeout(() => {
      cancelled = true
      void db.crawls.cancel(started!.id)
    }, 200)

    const summary = await runCrawl(started!.id, {
      db,
      log,
      signal: new AbortController().signal,
      createFetcher: site.createFetcher,
    })

    expect(cancelled).toBe(true)
    expect(summary?.status).toBe('cancelled')
    expect(site.requests.length).toBeLessThan(2000)
    expect(await db.crawls.get(started!.id)).toMatchObject({ status: 'cancelled', pruned: true })
    expect(await db.crawls.knownUrls(started!.id)).toEqual([])
    expect(site.closed()).toBe(1)
  }, 15_000)

  it('stops when its domain is archived, as when it is cancelled', async () => {
    const links = Array.from({ length: 2000 }, (_, i) => `<a href="/p${i}">x</a>`).join('')
    const started = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    const site = fakeSite({ 'https://example.com/': html(links) })
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      requestsPerSecond: 50,
    })
    setTimeout(() => void db.domains.archive(domainId), 200)

    const summary = await runCrawl(started!.id, {
      db,
      log,
      signal: new AbortController().signal,
      createFetcher: site.createFetcher,
    })

    expect(summary?.status).toBe('cancelled')
    expect(site.requests.length).toBeLessThan(2000)
    expect(await db.crawls.get(started!.id)).toMatchObject({ status: 'cancelled' })
    expect(await db.crawls.active(domainId)).toBeNull()
    expect((await db.domains.get(domainId))?.archivedAt).toBeInstanceOf(Date)
    expect(site.closed()).toBe(1)
  }, 15_000)

  it('stops without failing when its domain is deleted under it', async () => {
    const links = Array.from({ length: 2000 }, (_, i) => `<a href="/p${i}">x</a>`).join('')
    const started = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    const site = fakeSite({ 'https://example.com/': html(links) })
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      requestsPerSecond: 50,
    })
    setTimeout(() => void deleteDomain(db, { domainId, confirm: 'example.com' }), 200)

    await expect(
      runCrawl(started!.id, {
        db,
        log,
        signal: new AbortController().signal,
        createFetcher: site.createFetcher,
      }),
    ).resolves.not.toThrow()

    expect(site.requests.length).toBeLessThan(2000)
    expect(await db.crawls.get(started!.id)).toBeNull()
    expect(await db.domains.get(domainId)).toBeNull()
    expect(await db.jobs.get(started!.jobId)).toBeNull()
    expect(site.closed()).toBe(1)
  }, 15_000)

  it('does nothing when it was cancelled before it got to run', async () => {
    const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    await db.crawls.cancel(crawl!.id)
    const site = fakeSite({})
    const summary = await runCrawl(crawl!.id, {
      db,
      log,
      signal: new AbortController().signal,
      createFetcher: site.createFetcher,
    })
    expect(summary).toBeNull()
    expect(site.requests).toEqual([])
  })

  it('hands the job back on shutdown, then resumes without repeating work', async () => {
    const links = Array.from({ length: 40 }, (_, i) => `<a href="/p${i}">x</a>`).join('')
    const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    const shutdown = new AbortController()
    const site = fakeSite({
      'https://example.com/': html(links),
      'https://example.com/p5': () => {
        shutdown.abort()
        return html('<title>p5</title>')
      },
    })

    await expect(
      runCrawl(crawl!.id, { db, log, signal: shutdown.signal, createFetcher: site.createFetcher }),
    ).rejects.toBeInstanceOf(JobInterruptedError)
    expect(await db.crawls.active(domainId)).not.toBeNull()
    const firstRun = [...site.requests]
    expect(firstRun.length).toBeLessThan(52)

    const summary = await runCrawl(crawl!.id, {
      db,
      log,
      signal: new AbortController().signal,
      createFetcher: site.createFetcher,
    })

    expect(summary?.status).toBe('completed')
    const homeRequests = site.requests.filter((url) => url === 'https://example.com/')
    expect(homeRequests).toHaveLength(1)
    for (let i = 0; i < 40; i++) expect(site.requests).toContain(`https://example.com/p${i}`)
    expect((await db.crawls.get(crawl!.id))?.urlsCount).toBe(56)
  })

  it('remembers on resume that it had reached the limit', async () => {
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      maxUrls: 12,
    })
    const links = Array.from({ length: 40 }, (_, i) => `<a href="/p${i}">x</a>`).join('')
    const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    const shutdown = new AbortController()
    const site = fakeSite({
      'https://example.com/': () => {
        setTimeout(() => shutdown.abort(), 0)
        return html(links)
      },
    })
    await runCrawl(crawl!.id, {
      db,
      log,
      signal: shutdown.signal,
      createFetcher: site.createFetcher,
    }).catch(() => {})

    await runCrawl(crawl!.id, {
      db,
      log,
      signal: new AbortController().signal,
      createFetcher: site.createFetcher,
    })
    expect((await db.crawls.get(crawl!.id))?.status).toBe('incomplete')
  })

  it('lets a database failure fail the attempt, so the job retries from where it was', async () => {
    const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    const site = fakeSite({})
    const original = db.crawls.recordResult
    let failures = 0
    db.crawls.recordResult = async (input) => {
      if (failures++ === 2) throw new Error('database is gone')
      return original.call(db.crawls, input)
    }

    await expect(
      runCrawl(crawl!.id, {
        db,
        log,
        signal: new AbortController().signal,
        createFetcher: site.createFetcher,
      }),
    ).rejects.toThrow('database is gone')
    expect(await db.crawls.active(domainId)).not.toBeNull()
    expect(site.closed()).toBe(1)

    const summary = await runCrawl(crawl!.id, {
      db,
      log,
      signal: new AbortController().signal,
      createFetcher: site.createFetcher,
    })
    expect(summary?.status).toBe('completed')
    expect(await db.crawls.nextQueued(crawl!.id, 10)).toEqual([])
  })
})

describe('crawl files', () => {
  const text = (body: string, type = 'text/plain'): Partial<FetchedResponse> => ({
    statusCode: 200,
    headers: { 'content-type': type },
    body: Buffer.from(body),
  })
  const filesOf = async (kind?: Parameters<typeof db.crawlFiles.list>[1]) =>
    await db.crawlFiles.list(domainId, kind)
  const enable = async (changes: Partial<Awaited<ReturnType<typeof db.crawls.settings>>>) =>
    await db.crawls.saveSettings(domainId, { ...(await db.crawls.settings(domainId)), ...changes })

  it('keeps what every file answered, without counting any as a page', async () => {
    const site = fakeSite({
      'https://example.com/': html('<title>Home</title>'),
      'http://example.com/': moved('https://example.com/'),
      'https://example.com/robots.txt': text(
        'User-agent: *\nSitemap: https://example.com/custom.xml',
      ),
      'https://example.com/custom.xml': {
        ...text(
          '<urlset><url><loc>https://example.com/a</loc><lastmod>2026-02-03</lastmod></url></urlset>',
          'application/xml',
        ),
      },
      'https://example.com/a': html('<title>A</title>'),
      'https://example.com/llms.txt': text('# Acme\n> Anvils\n## Docs\n- [Doc](/doc.md)'),
      // A site answering any path with its home page: that is not an llms-full.txt.
      'https://example.com/llms-full.txt': html('<title>Home</title>'),
    })
    const { crawl } = await crawlWith(site)

    expect(crawl.status).toBe('completed')
    const pages = await urls(crawl.id, 'pages')
    expect(pages).toContain('https://example.com/a')
    expect(pages).not.toContain('https://example.com/llms-full.txt')

    const files = await filesOf()
    const byUrl = (url: string) => files.find((file) => file.url === url)
    expect(byUrl('https://example.com/robots.txt')).toMatchObject({
      kind: 'robots',
      statusCode: 200,
      body: 'User-agent: *\nSitemap: https://example.com/custom.xml',
      via: 'crawl',
    })
    expect(byUrl('http://example.com/robots.txt')).toMatchObject({ statusCode: 404, body: null })
    expect(byUrl('https://example.com/custom.xml')).toMatchObject({
      kind: 'sitemap',
      body: null,
      data: {
        sitemap: { format: 'urlset', entries: 1, lastModified: '2026-02-03T00:00:00.000Z' },
      },
    })
    expect(byUrl('https://example.com/sitemap.xml')).toMatchObject({ statusCode: 404, data: null })
    expect(byUrl('https://example.com/llms.txt')).toMatchObject({ kind: 'llms', statusCode: 200 })
    expect(byUrl('https://example.com/llms-full.txt')).toMatchObject({
      kind: 'llms-full',
      statusCode: 200,
      body: null,
    })
    // The URLs of the site's own page are never mistaken for files.
    expect(byUrl('https://example.com/a')).toBeUndefined()
  })

  it('follows the links of an llms.txt', async () => {
    const site = fakeSite({
      'https://example.com/llms.txt': text(
        '# Acme\n## Docs\n- [Doc](/doc.md)\n- [Ext](https://other.com/x)',
      ),
      'https://example.com/doc.md': text('# Doc', 'text/markdown'),
    })
    const { crawl } = await crawlWith(site)
    expect(site.requests).toContain('https://example.com/doc.md')
    expect(site.requests).not.toContain('https://other.com/x')
    expect(
      await db.crawls.linkSources(crawl.id, crawlUrlHash('https://example.com/doc.md')),
    ).toEqual([{ url: 'https://example.com/llms.txt', kind: 'llms' }])
  })

  it('reads a moved file as what it is, where it landed', async () => {
    const site = fakeSite({
      'https://example.com/llms.txt': moved('https://example.com/docs/llms.txt'),
      'https://example.com/docs/llms.txt': text('# Acme'),
    })
    await crawlWith(site)
    const files = await filesOf(['llms'])
    expect(files.find((file) => file.url === 'https://example.com/llms.txt')).toMatchObject({
      statusCode: 301,
      redirectTo: 'https://example.com/docs/llms.txt',
    })
    expect(files.find((file) => file.url === 'https://example.com/docs/llms.txt')).toMatchObject({
      statusCode: 200,
      body: '# Acme',
    })
  })

  it('only requests the optional files a domain enabled', async () => {
    await enable({ optionalFiles: ['ads', 'feed'], indexNowKey: 'abcd1234' })
    const site = fakeSite({
      'https://example.com/': html(
        '<link rel="alternate" type="application/rss+xml" href="/blog/rss"><link rel="search" type="application/opensearchdescription+xml" href="/os.xml">',
      ),
      'https://example.com/ads.txt': text('google.com, pub-1, DIRECT'),
      'https://example.com/abcd1234.txt': text('abcd1234'),
      'https://example.com/blog/rss': text(
        '<rss><channel><title>Blog</title><item><pubDate>Mon, 02 Feb 2026 00:00:00 GMT</pubDate></item></channel></rss>',
        'application/rss+xml',
      ),
    })
    await crawlWith(site)

    expect(site.requests).toContain('https://example.com/ads.txt')
    expect(site.requests).not.toContain('https://example.com/humans.txt')
    const files = await filesOf()
    expect(files.find((file) => file.kind === 'ads' && file.statusCode === 200)).toBeDefined()
    expect(files.find((file) => file.kind === 'indexnow' && file.statusCode === 200)?.body).toBe(
      'abcd1234',
    )
    expect(files.find((file) => file.url === 'https://example.com/blog/rss')).toMatchObject({
      kind: 'feed',
      data: {
        feed: {
          format: 'rss',
          title: 'Blog',
          items: 1,
          lastModified: '2026-02-02T00:00:00.000Z',
        },
      },
    })
    // OpenSearch was not asked for: to this crawl, that link is like any other.
    expect(files.some((file) => file.kind === 'opensearch')).toBe(false)
  })

  it('records a file that could not be reached', async () => {
    const site = fakeSite({
      'https://example.com/robots.txt': () => new FetchError('ECONNRESET', 'reset'),
    })
    await crawlWith(site)
    const files = await filesOf(['robots'])
    expect(files.find((file) => file.url === 'https://example.com/robots.txt')).toMatchObject({
      statusCode: null,
      error: 'ECONNRESET: reset',
    })
  })

  it('removes the files that are gone, and pushes the daily refresh back', async () => {
    await db.crawlFiles.save(domainId, [
      {
        url: 'https://example.com/old-sitemap.xml',
        kind: 'sitemap',
        statusCode: 200,
        contentType: null,
        redirectTo: null,
        bytes: null,
        truncated: false,
        body: null,
        error: null,
        data: null,
        via: 'refresh',
        fetchedAt: new Date(Date.now() - 86_400_000),
      },
    ])
    await crawlWith(fakeSite({}))
    const files = await filesOf(['sitemap'])
    expect(files.some((file) => file.url.endsWith('old-sitemap.xml'))).toBe(false)
    const check = await db.crawlFiles.getCheck(domainId)
    expect(check?.outcome).toBe('ok')
    expect(check?.nextCheckAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000)
  })

  it('does not touch them on a priority crawl', async () => {
    await db.priorityUrls.add({ domainId, url: 'https://example.com/a' })
    const site = fakeSite({ 'https://example.com/a': html('<title>A</title>') })
    await crawlWith(site, 'priority')
    expect(site.requests).toEqual(['https://example.com/a'])
    expect(await filesOf()).toEqual([])
    expect(await db.crawlFiles.getCheck(domainId)).toBeNull()
  })

  it('reads a file as such even if it is marked as priority', async () => {
    await db.priorityUrls.add({ domainId, url: 'https://example.com/llms.txt' })
    await crawlWith(fakeSite({ 'https://example.com/llms.txt': text('# Acme') }))
    const [file] = (await filesOf(['llms'])).filter((row) => row.statusCode === 200)
    expect(file?.body).toBe('# Acme')
  })
})

describe('crawl configuration', () => {
  it('records scope and depth skips without requesting, auditing or counting errors', async () => {
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      includePrefixes: ['/allowed'],
      excludePrefixes: ['/allowed/private'],
      maxDepth: 1,
    })
    const site = fakeSite({
      'https://example.com/': html(
        '<a href="/allowed">a</a><a href="/outside">b</a><a href="/allowed/private">c</a>',
      ),
      'https://example.com/allowed': html('<a href="/allowed/deep">deep</a>'),
    })
    const { crawl } = await crawlWith(site)
    for (const [path, reason] of [
      ['/outside', 'excluded'],
      ['/allowed/private', 'excluded'],
      ['/allowed/deep', 'depth'],
    ]) {
      const url = await db.crawls.getUrl(crawl.id, crawlUrlHash(`https://example.com${path}`))
      expect(url).toMatchObject({
        state: 'skipped',
        kind: 'unknown',
        statusCode: null,
        error: null,
        data: { notRequested: reason },
      })
      expect(site.requests).not.toContain(`https://example.com${path}`)
      expect(
        await db.crawls.issuesOf(crawl.id, [crawlUrlHash(`https://example.com${path}`)]),
      ).toEqual([])
    }
    expect(site.requests).toContain('https://example.com/robots.txt')
    expect(crawl.pagesCount).toBe(2)
    expect(await urls(crawl.id, 'errors')).not.toContain('https://example.com/outside')
    expect(crawl.pagesAudit?.audited).toBe(2)
  })

  it('persists ad hoc priority seeds and requests exactly the list without following links', async () => {
    await db.crawls.saveSettings(domainId, { ...(await db.crawls.settings(domainId)), maxUrls: 1 })
    await db.priorityUrls.add({ domainId, url: 'https://example.com/saved' })
    const crawl = await db.crawls.start({
      domainId,
      type: 'priority',
      trigger: 'manual',
      seedUrls: ['https://example.com/list', 'https://example.com/list2'],
    })
    if (!crawl) throw new Error('not started')
    const site = fakeSite({ 'https://example.com/list': html('<a href="/other">other</a>') })
    await runCrawl(crawl.id, {
      db,
      log,
      signal: new AbortController().signal,
      createFetcher: site.createFetcher,
    })
    expect(site.requests.sort()).toEqual(['https://example.com/list', 'https://example.com/list2'])
    expect((await db.crawls.get(crawl.id))?.seedUrls).toEqual([
      'https://example.com/list',
      'https://example.com/list2',
    ])
    expect((await db.priorityUrls.list(domainId)).map((u) => u.url)).toEqual([
      'https://example.com/saved',
    ])
  })
})

it('loads encrypted credentials for a crawl without exposing them as crawl settings', async () => {
  await domainRequestSettings(db.crawls, domainId, 'test-key').setJson(
    'request',
    {
      headers: [{ name: 'Cookie', value: 'secret-cookie' }],
      username: 'stage',
      password: 'secret',
    },
    { encrypted: true },
  )
  const site = fakeSite({ 'https://example.com/': html('hello') })
  await crawlWith(site, 'full', { settingsSecret: 'test-key' })
  expect(site.configs[0]?.siteHeaders).toEqual({
    host: 'example.com',
    headers: { cookie: 'secret-cookie', authorization: 'Basic c3RhZ2U6c2VjcmV0' },
  })
})

it('coalesces ignored parameter links before hashing and keeps both written tags', async () => {
  await db.crawls.saveSettings(domainId, {
    ...(await db.crawls.settings(domainId)),
    ignoredParameters: ['updatedAt'],
  })
  const site = fakeSite({
    'https://example.com/': html(
      '<a href="/a?updatedAt=1">One</a><a href="/a?updatedAt=2">Two</a>',
    ),
    'https://example.com/a': html('<title>A</title>'),
  })
  const { crawl } = await crawlWith(site)
  expect((await urls(crawl.id, 'pages')).filter((u) => u.includes('/a'))).toEqual([
    'https://example.com/a',
  ])
  const links = await db.crawls.listLinks({
    crawlId: crawl.id,
    urlHash: crawlUrlHash('https://example.com/'),
    direction: 'out',
    kinds: ['anchor'],
    limit: 10,
    offset: 0,
  })
  expect(links).toHaveLength(2)
  expect(links.map((l) => l.url)).toEqual(['https://example.com/a', 'https://example.com/a'])
  expect(links.map((l) => l.context?.snippet).join(' ')).toContain('updatedAt=1')
  expect(links.map((l) => l.context?.snippet).join(' ')).toContain('updatedAt=2')
})
