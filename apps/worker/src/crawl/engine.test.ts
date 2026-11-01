import { createLogger, crawlUrlHash } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JobInterruptedError } from '../types'
import { runCrawl, type CrawlEngineOptions } from './engine'
import { FetchError, type FetchedResponse, type Fetcher } from './fetcher'

const log = createLogger('test', 'silent')

type Answer = Partial<FetchedResponse> | Error | (() => Partial<FetchedResponse> | Error)

const html = (body: string, headers: Record<string, string> = {}): Partial<FetchedResponse> => ({
  statusCode: 200,
  headers: { 'content-type': 'text/html', ...headers },
  body: Buffer.from(body),
})
const moved = (location: string, statusCode = 301): Partial<FetchedResponse> => ({
  statusCode,
  headers: { location },
  body: null,
})
const notFound: Partial<FetchedResponse> = {
  statusCode: 404,
  headers: { 'content-type': 'text/html' },
  body: Buffer.from('<title>Not found</title>'),
}

/** A website in a map. URLs that are not in it answer 404, like a real site would. */
function fakeSite(site: Record<string, Answer>, latencyMs = 1) {
  const requests: string[] = []
  const configs: { userAgent: string; timeoutMs: number; concurrency: number }[] = []
  let active = 0
  let peak = 0
  let closed = 0
  const createFetcher: CrawlEngineOptions['createFetcher'] = (config) => {
    configs.push(config)
    const fetcher: Fetcher = {
      close: () => {
        closed++
      },
      async fetch(url, { signal }) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        requests.push(url)
        peak = Math.max(peak, ++active)
        await new Promise((r) => setTimeout(r, latencyMs))
        active--
        const answer = site[url] ?? notFound
        const resolved = typeof answer === 'function' ? answer() : answer
        if (resolved instanceof Error) throw resolved
        return {
          statusCode: 200,
          headers: {},
          body: null,
          truncated: false,
          bytes: resolved.body?.length ?? null,
          responseTimeMs: 1,
          ...resolved,
        }
      },
    }
    return fetcher
  }
  return {
    createFetcher,
    requests,
    configs,
    peak: () => peak,
    closed: () => closed,
  }
}

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

const urls = async (crawlId: string, view: 'pages' | 'other' | 'external') =>
  (await db.crawls.listUrls({ crawlId, view, limit: 1000, offset: 0 })).map((u) => u.url).sort()
const row = async (crawlId: string, url: string) =>
  (await db.crawls.latestResults(domainId, [crawlUrlHash(url)])).find((r) => r.crawlId === crawlId)

describe('full crawl', () => {
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

  it('records external URLs and who links to them, without requesting them or counting them', async () => {
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
    for (const url of await urls(crawl.id, 'external')) {
      expect(site.requests).not.toContain(url)
    }
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

  it('counts only HTML as pages; redirects, resources and failures are the rest of the site', async () => {
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
      expect.arrayContaining([
        'https://example.com/',
        'https://example.com/target',
        'https://example.com/gone', // a broken page is still a page, with its status
      ]),
    )
    for (const url of [
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
    // 12 seeds at 50 per second need at least 11 intervals of 20 ms.
    expect(site.requests).toHaveLength(12)
    expect(Date.now() - started).toBeGreaterThanOrEqual(11 * 20 - 5)
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
    expect((await db.crawls.get(crawl!.id))?.urlsCount).toBe(52)
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
