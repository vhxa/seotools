import { createLogger } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CRAWL_FILE_RETRY_INTERVAL_MS, createCrawlFileRefresher } from './file-refresher'
import { FetchError, type FetchedResponse, type Fetcher } from './fetcher'
import { CRAWL_FILE_REFRESH_INTERVAL_MS, MAX_REFRESH_SITEMAPS } from './files'

const log = createLogger('test', 'silent')
const start = new Date('2026-06-15T10:00:00Z')

type Answer = Partial<FetchedResponse> | Error

const text = (body: string, type = 'text/plain'): Partial<FetchedResponse> => ({
  statusCode: 200,
  headers: { 'content-type': type },
  body: Buffer.from(body),
})
const notFound: Partial<FetchedResponse> = {
  statusCode: 404,
  headers: { 'content-type': 'text/html' },
  body: Buffer.from('nope'),
}

let db: Database
let domainId: string
let clock: Date
let site: Record<string, Answer | (() => Answer)>
let fallback: Answer
let requests: string[]

const createFetcher = (): Fetcher => ({
  close() {},
  async fetch(url) {
    requests.push(url)
    const entry = site[url] ?? fallback
    const answer = typeof entry === 'function' ? entry() : entry
    if (answer instanceof Error) throw answer
    return {
      statusCode: 200,
      headers: {},
      body: null,
      truncated: false,
      bytes: answer.body?.length ?? null,
      responseTimeMs: 1,
      ...answer,
    }
  },
})

const refresher = () =>
  createCrawlFileRefresher({ db, log, createFetcher, now: () => clock, retryBaseMs: 1 })

const fileAt = async (url: string) =>
  (await db.crawlFiles.list(domainId)).find((file) => file.url === url)

beforeEach(async () => {
  db = await createTestDatabase()
  clock = start
  site = {}
  fallback = notFound
  requests = []
  const created = await createCompany(db, { name: 'Acme', domain: 'example.com' })
  if (!created.ok) throw new Error('setup failed')
  domainId = created.domain.id
  await db.crawls.saveSettings(domainId, {
    ...(await db.crawls.settings(domainId)),
    requestsPerSecond: 100,
    maxRetries: 1,
  })
})
afterEach(async () => {
  await db.close()
})

describe('createCrawlFileRefresher', () => {
  it('does nothing when automation is paused', async () => {
    const paused = createCrawlFileRefresher({
      db,
      log,
      createFetcher,
      now: () => clock,
      retryBaseMs: 1,
      paused: true,
    })
    await paused.tick()
    expect(await db.crawlFiles.list(domainId)).toEqual([])
  })

  it('fetches the files of a new domain, walking what robots.txt and sitemaps point to', async () => {
    site = {
      'https://example.com/robots.txt': text('Sitemap: https://example.com/index.xml'),
      'https://example.com/index.xml': text(
        '<sitemapindex><sitemap><loc>https://example.com/pages.xml</loc></sitemap><sitemap><loc>https://other.com/x.xml</loc></sitemap></sitemapindex>',
        'application/xml',
      ),
      'https://example.com/pages.xml': text(
        '<urlset><url><loc>https://example.com/a</loc></url></urlset>',
        'application/xml',
      ),
      'https://example.com/llms.txt': text('# Acme'),
    }
    await refresher().tick()

    expect(await fileAt('https://example.com/robots.txt')).toMatchObject({
      statusCode: 200,
      via: 'refresh',
      fetchedAt: start,
    })
    expect((await fileAt('https://example.com/pages.xml'))?.data?.sitemap).toMatchObject({
      format: 'urlset',
      entries: 1,
    })
    expect(await fileAt('https://example.com/llms.txt')).toMatchObject({ body: '# Acme' })
    // A refresh is about the files: pages and external URLs are nobody's business here.
    expect(requests).not.toContain('https://example.com/a')
    expect(requests).not.toContain('https://other.com/x.xml')
    expect(requests).not.toContain('https://example.com/')

    expect(await db.crawlFiles.getCheck(domainId)).toMatchObject({
      outcome: 'ok',
      checkedAt: start,
      nextCheckAt: new Date(start.getTime() + CRAWL_FILE_REFRESH_INTERVAL_MS),
      requestedAt: null,
    })
  })

  it('does nothing until the next check is due, or someone asks', async () => {
    await refresher().tick()
    const count = requests.length
    expect(count).toBeGreaterThan(0)

    await refresher().tick()
    expect(requests).toHaveLength(count)

    await db.crawlFiles.requestCheck({ domainId, now: clock })
    await refresher().tick()
    expect(requests).toHaveLength(count * 2)

    clock = new Date(start.getTime() + CRAWL_FILE_REFRESH_INTERVAL_MS)
    await refresher().tick()
    expect(requests).toHaveLength(count * 3)
  })

  it('follows redirects within the site, as the same kind of file', async () => {
    site = {
      'https://www.example.com/llms.txt': {
        statusCode: 301,
        headers: { location: 'https://example.com/llms.txt' },
      },
      'https://example.com/llms.txt': text('# Acme'),
      'https://example.com/ads.txt': text('x'),
      'https://example.com/llms-full.txt': {
        statusCode: 302,
        headers: { location: 'https://cdn.other.com/full.txt' },
      },
    }
    await refresher().tick()
    expect(await fileAt('https://www.example.com/llms.txt')).toMatchObject({
      kind: 'llms',
      redirectTo: 'https://example.com/llms.txt',
    })
    expect(await fileAt('https://example.com/llms-full.txt')).toMatchObject({
      redirectTo: 'https://cdn.other.com/full.txt',
    })
    expect(requests).not.toContain('https://cdn.other.com/full.txt')
    expect(requests).not.toContain('https://example.com/ads.txt')
  })

  it('finds the feeds and search descriptions the home page announces, only if enabled', async () => {
    const home = text(
      '<link rel="alternate" type="application/rss+xml" href="/my-feed"><link rel="search" type="application/opensearchdescription+xml" href="/my-search.xml">',
      'text/html',
    )
    site = {
      'https://example.com/': {
        statusCode: 301,
        headers: { location: 'https://www.example.com/' },
      },
      'https://www.example.com/': home,
      'https://www.example.com/my-feed': text(
        '<rss><channel><title>Blog</title></channel></rss>',
        'application/rss+xml',
      ),
      'https://www.example.com/my-search.xml': text(
        '<OpenSearchDescription><ShortName>Acme</ShortName></OpenSearchDescription>',
        'application/xml',
      ),
    }
    await refresher().tick()
    expect(requests).not.toContain('https://www.example.com/')

    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      optionalFiles: ['feed', 'opensearch', 'humans'],
    })
    await db.crawlFiles.requestCheck({ domainId, now: clock })
    await refresher().tick()

    expect((await fileAt('https://www.example.com/my-feed'))?.data?.feed?.title).toBe('Blog')
    expect(
      (await fileAt('https://www.example.com/my-search.xml'))?.data?.opensearch?.shortName,
    ).toBe('Acme')
    expect(requests).toContain('https://example.com/humans.txt')
    expect(requests).not.toContain('https://example.com/ads.txt')
  })

  it('removes what is gone, and what was turned off', async () => {
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      optionalFiles: ['humans'],
    })
    site = { 'https://example.com/humans.txt': text('Hi') }
    await refresher().tick()
    expect(await fileAt('https://example.com/humans.txt')).toBeDefined()

    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      optionalFiles: [],
    })
    clock = new Date(start.getTime() + CRAWL_FILE_REFRESH_INTERVAL_MS)
    await refresher().tick()
    expect(await fileAt('https://example.com/humans.txt')).toBeUndefined()
  })

  it('stops at a limit of sitemaps, keeping those it did not get to', async () => {
    const children = Array.from(
      { length: MAX_REFRESH_SITEMAPS + 5 },
      (_, i) => `<sitemap><loc>https://example.com/s${i}.xml</loc></sitemap>`,
    ).join('')
    site = {
      'https://example.com/sitemap.xml': text(
        `<sitemapindex>${children}</sitemapindex>`,
        'application/xml',
      ),
    }
    await db.crawlFiles.save(domainId, [
      {
        url: 'https://example.com/s103.xml',
        kind: 'sitemap',
        statusCode: 200,
        contentType: null,
        redirectTo: null,
        bytes: null,
        truncated: false,
        body: null,
        error: null,
        data: null,
        via: 'crawl',
        fetchedAt: new Date(start.getTime() - 1000),
      },
    ])
    await refresher().tick()

    const sitemapRequests = requests.filter((url) => /\/s\d+\.xml$/.test(url))
    expect(sitemapRequests.length).toBeLessThanOrEqual(MAX_REFRESH_SITEMAPS)
    expect(sitemapRequests).not.toContain('https://example.com/s103.xml')
    expect(await fileAt('https://example.com/s103.xml')).toBeDefined()
  })

  it('retries what may pass, and records what does not', async () => {
    let attempts = 0
    site = {
      'https://example.com/robots.txt': () =>
        ++attempts === 1 ? { statusCode: 503, headers: {} } : text('User-agent: *'),
      'https://example.com/llms.txt': new FetchError('ECONNRESET', 'reset'),
    }
    await refresher().tick()
    expect(await fileAt('https://example.com/robots.txt')).toMatchObject({ statusCode: 200 })
    expect(await fileAt('https://example.com/llms.txt')).toMatchObject({
      statusCode: null,
      error: 'ECONNRESET: reset',
    })
    expect(requests.filter((url) => url === 'https://example.com/llms.txt')).toHaveLength(2)
  })

  it('keeps the files when nothing answers, and tries again sooner', async () => {
    site = { 'https://example.com/robots.txt': text('User-agent: *') }
    await refresher().tick()

    fallback = new FetchError('ENOTFOUND', 'gone')
    site = {}
    clock = new Date(start.getTime() + CRAWL_FILE_REFRESH_INTERVAL_MS)
    await refresher().tick()

    expect(await fileAt('https://example.com/robots.txt')).toMatchObject({
      statusCode: 200,
      fetchedAt: start,
    })
    expect(await db.crawlFiles.getCheck(domainId)).toMatchObject({
      outcome: 'unreachable',
      checkedAt: clock,
      nextCheckAt: new Date(clock.getTime() + CRAWL_FILE_RETRY_INTERVAL_MS),
    })
  })

  it('leaves it to a full crawl that is running', async () => {
    await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    await db.crawlFiles.requestCheck({ domainId, now: clock })
    await refresher().tick()

    expect(requests).toEqual([])
    expect(await db.crawlFiles.getCheck(domainId)).toMatchObject({
      requestedAt: null,
      nextCheckAt: new Date(start.getTime() + CRAWL_FILE_RETRY_INTERVAL_MS),
    })
  })

  it('goes ahead while a priority crawl runs, since those do not request the files', async () => {
    await db.priorityUrls.add({ domainId, url: 'https://example.com/a' })
    await db.crawls.start({ domainId, type: 'priority', trigger: 'manual' })
    await refresher().tick()
    expect(requests).toContain('https://example.com/robots.txt')
  })

  it('stops when told to', async () => {
    const instance = refresher()
    await instance.stop()
    await instance.tick()
    expect(requests).toEqual([])
  })

  it('does not request the files of an archived domain, even when someone asked', async () => {
    await db.crawlFiles.requestCheck({ domainId, now: clock })
    await db.domains.archive(domainId)
    await refresher().tick()
    expect(requests).toEqual([])

    await db.domains.unarchive(domainId)
    await refresher().tick()
    expect(requests).toContain('https://example.com/robots.txt')
  })

  it('keeps the files an archived domain has when they fall due', async () => {
    site = { 'https://example.com/robots.txt': text('User-agent: *') }
    const instance = refresher()
    await instance.tick()
    await db.domains.archive(domainId)
    requests = []
    clock = new Date(start.getTime() + CRAWL_FILE_REFRESH_INTERVAL_MS + 1000)
    await instance.tick()
    expect(requests).toEqual([])
    expect((await fileAt('https://example.com/robots.txt'))?.body).toBe('User-agent: *')
  })
})

it('opens robots and certificate incidents between crawls, escalates and recovers', async () => {
  site['https://example.com/robots.txt'] = text('User-agent: *')
  await refresher().tick()
  expect(await db.incidents.list(domainId)).toEqual([])
  clock = new Date(start.getTime() + CRAWL_FILE_REFRESH_INTERVAL_MS)
  site['https://example.com/robots.txt'] = {
    ...text('User-agent: *\nDisallow: /'),
    tls: { validTo: new Date(clock.getTime() + 10 * 86400000) },
  }
  await refresher().tick()
  expect((await db.incidents.list(domainId)).map((i) => i.kind).sort()).toEqual([
    'certificate',
    'robots-blocks-site',
  ])
  expect((await db.jobs.list()).filter((j) => j.type === 'incident.alerts')).toHaveLength(3)
  clock = new Date(clock.getTime() + CRAWL_FILE_REFRESH_INTERVAL_MS)
  site['https://example.com/robots.txt'] = {
    ...text('User-agent: *'),
    tls: { validTo: new Date(clock.getTime() + 2 * 86400000) },
  }
  await refresher().tick()
  expect(await db.incidents.list(domainId)).toMatchObject([
    { kind: 'certificate', stage: 'warn-3' },
  ])
  clock = new Date(clock.getTime() + CRAWL_FILE_REFRESH_INTERVAL_MS)
  site['https://example.com/robots.txt'] = {
    ...text('User-agent: *'),
    tls: { validTo: new Date(clock.getTime() + 90 * 86400000) },
  }
  await refresher().tick()
  expect(await db.incidents.list(domainId)).toEqual([])
})
it('opens availability only after two failed checks an hour apart and recovers once', async () => {
  fallback = new FetchError('TIMEOUT', 'No response')
  await refresher().tick()
  expect(await db.incidents.list(domainId)).toEqual([])
  clock = new Date(clock.getTime() + CRAWL_FILE_RETRY_INTERVAL_MS)
  await refresher().tick()
  const [incident] = await db.incidents.list(domainId)
  expect(incident?.kind).toBe('site-down')
  clock = new Date(clock.getTime() + CRAWL_FILE_RETRY_INTERVAL_MS)
  fallback = notFound
  await refresher().tick()
  expect(await db.incidents.list(domainId)).toEqual([])
  expect((await db.jobs.list()).filter((j) => j.type === 'incident.alerts')).toHaveLength(2)
})
