import {
  SITE_SCOPED_ISSUES,
  URL_SCOPED_ISSUES,
  compareWithCrawl,
  createLogger,
  crawlFileKindOf,
  crawlUrlHash,
  isUrlScopedIssue,
  type AuditSelector,
  type NewAuditRule,
  type PageIssueId,
} from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JobDeferredError, JobInterruptedError } from '../types'
import { runCrawl } from './engine'
import { fakeSite, moved, type Answer } from './fake-site'
import { FetchError } from './fetcher'
import { CHECKS } from './issue-checks'
import {
  SiteContextError,
  createAnchorCounter,
  evaluateRecheck,
  recheckContext,
  recheckSubject,
} from './recheck'
import { analyseResponse } from './response'
import { SITE, page, sitemapOf, xml } from './test-site'
import { runVerification, type VerificationOptions } from './verification'

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

const absolute = (path: string) => (path.startsWith('http') ? path : `${SITE}${path}`)
const hashOf = (path: string) => crawlUrlHash(absolute(path))

const SHARED_TITLE = 'The same title for two pages of this very site'

/**
 * A small site with one kind of problem on each page, so that what a recheck can and cannot tell is
 * visible: a missing title and H1 (`/broken`), two pages with one title (`/dup1`, `/dup2`), a page no
 * link reaches (`/orphan`), a `noindex` (`/hidden`), a moved page (`/old`) and a link that 404s.
 */
function website(): Record<string, Answer> {
  const pages: Record<string, Answer> = {
    '/': page('/', {
      links: ['/good', '/broken', '/dup1', '/dup2', '/hidden', '/old', '/gone', '/leaf']
        .map((path) => `<a href="${path}">A link to ${path}</a>`)
        .join(''),
    }),
    '/good': page('/good'),
    '/broken': page('/broken', { title: null, h1: null }),
    '/dup1': page('/dup1', { title: SHARED_TITLE }),
    '/dup2': page('/dup2', { title: SHARED_TITLE }),
    '/orphan': page('/orphan'),
    '/hidden': page('/hidden', { head: '<meta name="robots" content="noindex">' }),
    '/old': moved(`${SITE}/good`),
    // Nothing links out of a leaf, not even to the home page.
    '/leaf': page('/leaf', { links: '' }),
  }
  const site: Record<string, Answer> = {
    [`${SITE}/sitemap.xml`]: xml(sitemapOf(Object.keys(pages))),
  }
  for (const [path, answer] of Object.entries(pages)) site[absolute(path)] = answer
  return site
}

async function fullCrawl(site: Record<string, Answer>) {
  const started = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
  if (!started) throw new Error('crawl did not start')
  await runCrawl(started.id, {
    db,
    log,
    signal: new AbortController().signal,
    createFetcher: fakeSite(site, 0).createFetcher,
    retryBaseMs: 1,
  })
  return (await db.crawls.get(started.id))!
}

/** Asks for a recheck of some paths of the last full crawl, as the server action does. */
async function recheck(paths: string[], baseCrawlId?: string) {
  const base = baseCrawlId ?? (await db.crawls.latestWithResults(domainId, 'full'))!.id
  const urls = []
  for (const path of paths) {
    const stored = await db.crawls.getUrl(base, hashOf(path))
    urls.push({
      url: absolute(path),
      urlHash: hashOf(path),
      source: stored?.source ?? ('link' as const),
    })
  }
  const verification = await db.verifications.start({ domainId, baseCrawlId: base, urls })
  if (!verification) throw new Error('recheck did not start')
  return verification
}

function run(
  verificationId: string,
  site: Record<string, Answer>,
  overrides: Partial<VerificationOptions> = {},
) {
  const fake = fakeSite(site, 0)
  const result = runVerification(verificationId, {
    db,
    log,
    signal: new AbortController().signal,
    createFetcher: fake.createFetcher,
    retryBaseMs: 1,
    crawlWaitMs: 1,
    ...overrides,
  })
  return { fake, result }
}

async function verify(paths: string[], site: Record<string, Answer>) {
  const verification = await recheck(paths)
  const { fake, result } = run(verification.id, site)
  const summary = await result
  const urls = await db.verifications.urlsOf(verification.id)
  const outcomeOf = (path: string) => urls.find((url) => url.urlHash === hashOf(path))?.outcome
  const findingsOf = (path: string) => outcomeOf(path)?.findings.map((f) => f.issue) ?? []
  return { verification, summary, urls, fake, outcomeOf, findingsOf }
}

const crawlFindings = async (crawlId: string, path: string) =>
  (await db.crawls.issuesOf(crawlId, [hashOf(path)])).map((row) => row.issue)

describe('what a recheck can settle', () => {
  it('finds, from a fresh answer, what a full crawl finds at the same URL', async () => {
    const site = website()
    const crawl = await fullCrawl(site)

    // Every URL of the site that a crawl audits: the pages, the redirect, the failures, the guesses.
    const internal = (
      await Promise.all(
        (['pages', 'other'] as const).map((view) =>
          db.crawls.listUrls({ crawlId: crawl.id, view, limit: 1000, offset: 0 }),
        ),
      )
    )
      .flat()
      .filter((url) => crawlFileKindOf(url.source) === null)
    expect(internal.length).toBeGreaterThan(8)

    // By URL, not by path: the guesses of the crawler are on other origins (`www`, `http`).
    const exact = await db.verifications.start({
      domainId,
      baseCrawlId: crawl.id,
      urls: internal.map((url) => ({ url: url.url, urlHash: url.urlHash, source: url.source })),
    })
    const { fake, result } = run(exact!.id, site)
    await result

    const urls = await db.verifications.urlsOf(exact!.id)
    expect(urls.every((url) => url.state === 'done')).toBe(true)
    for (const url of urls) {
      const byIssue = (a: { issue: string }, b: { issue: string }) => a.issue.localeCompare(b.issue)
      const expected = (await db.crawls.issuesOf(crawl.id, [url.urlHash]))
        .filter((row) => isUrlScopedIssue(row.issue))
        .map((row) => ({ issue: row.issue, ...(row.details ? { details: row.details } : {}) }))
        .sort(byIssue)
      expect([...(url.outcome?.findings ?? [])].sort(byIssue), url.url).toEqual(expected)
      expect(url.outcome?.unchecked, url.url).toEqual([])
    }
    // The crawl did find things that are not a recheck's to say, so the comparison above is not empty.
    const crawlIssues = (
      await db.crawls.issuesOf(
        crawl.id,
        urls.map((url) => url.urlHash),
      )
    ).map((row) => row.issue)
    expect(crawlIssues).toEqual(
      expect.arrayContaining(['title-missing', 'noindex', 'title-duplicate', 'orphan-in-sitemap']),
    )
    // And each origin's robots.txt was asked for, apart from the URLs themselves.
    expect(fake.requests.filter((url) => url.endsWith('/robots.txt')).length).toBeGreaterThan(0)
  })

  it('never finds, nor clears, an issue that needs the rest of the site', async () => {
    const site = website()
    const crawl = await fullCrawl(site)
    const before = await crawlFindings(crawl.id, '/dup1')
    expect(before).toEqual(expect.arrayContaining(['title-duplicate']))

    // The title of /dup1 is fixed on the site...
    site[absolute('/dup1')] = page('/dup1', { title: 'A title that nothing else on this site has' })
    const { findingsOf, outcomeOf } = await verify(['/dup1', '/dup2', '/orphan'], site)

    for (const path of ['/dup1', '/dup2', '/orphan']) {
      const outcome = outcomeOf(path)!
      // ...but a recheck cannot see duplicates, orphans or any other issue of the site, either way:
      const everything = [...outcome.findings.map((f) => f.issue), ...outcome.unchecked]
      expect(
        everything.filter((issue) => SITE_SCOPED_ISSUES.includes(issue as PageIssueId)),
      ).toEqual([])
    }
    // /dup2 still has the title it shares with nothing now, yet the recheck says nothing about it.
    expect(findingsOf('/dup2')).not.toContain('title-duplicate')
    expect(findingsOf('/orphan')).not.toContain('orphan-in-sitemap')

    const comparison = compareWithCrawl({
      crawl: before,
      recheck: findingsOf('/dup1'),
      unchecked: outcomeOf('/dup1')!.unchecked,
    })
    expect(comparison.pendingFullCrawl).toContain('title-duplicate')
    expect(comparison.fixed).not.toContain('title-duplicate')
  })

  it('settles what the URL itself says: a fixed title is gone, a remaining one stays', async () => {
    const site = website()
    const crawl = await fullCrawl(site)
    expect(await crawlFindings(crawl.id, '/broken')).toEqual(
      expect.arrayContaining(['title-missing', 'h1-missing']),
    )

    site[absolute('/broken')] = page('/broken', { h1: null })
    const { findingsOf } = await verify(['/broken'], site)

    expect(findingsOf('/broken')).toContain('h1-missing')
    expect(findingsOf('/broken')).not.toContain('title-missing')
  })

  it('keeps the page links of a URL as its own: a page with none has no outgoing links', async () => {
    const site = website()
    await fullCrawl(site)
    const { findingsOf } = await verify(['/leaf', '/good'], site)
    expect(findingsOf('/leaf')).toContain('no-outgoing-links')
    expect(findingsOf('/good')).not.toContain('no-outgoing-links')
  })

  it('reads robots.txt as it is now, not as the crawl saw it', async () => {
    const site = website()
    site[`${SITE}/robots.txt`] = {
      statusCode: 200,
      headers: { 'content-type': 'text/plain' },
      body: Buffer.from('User-agent: *\nDisallow: /good'),
    }
    const crawl = await fullCrawl(site)
    expect(await crawlFindings(crawl.id, '/good')).toContain('robots-blocked')

    delete site[`${SITE}/robots.txt`]
    const fixed = await verify(['/good'], site)
    expect(fixed.findingsOf('/good')).not.toContain('robots-blocked')

    site[`${SITE}/robots.txt`] = {
      statusCode: 200,
      headers: { 'content-type': 'text/plain' },
      body: Buffer.from('User-agent: *\nDisallow: /good'),
    }
    const still = await verify(['/good'], site)
    expect(still.findingsOf('/good')).toContain('robots-blocked')
    // What the crawl stored is what it saw.
    expect((await db.crawls.get(crawl.id))?.robots?.[SITE]?.body).toContain('Disallow: /good')
  })

  it('records a failed request as what the URL answered', async () => {
    const site = website()
    await fullCrawl(site)
    site[absolute('/good')] = new FetchError('ECONNRESET', 'connection reset', 3)
    const { findingsOf, urls } = await verify(['/good'], site)
    expect(findingsOf('/good')).toContain('no-response')
    expect(urls[0]).toMatchObject({ kind: 'unknown', statusCode: null })
    expect(urls[0]?.error).toContain('ECONNRESET')
  })
})

describe('what a recheck leaves alone', () => {
  it('does not change a crawl: its results, its analysis or its history', async () => {
    const site = website()
    const crawl = await fullCrawl(site)
    const snapshot = async () => ({
      crawl: await db.crawls.get(crawl.id),
      crawls: (await db.crawls.list(domainId)).map((c) => c.id),
      urls: await db.crawls.listUrls({ crawlId: crawl.id, view: 'pages', limit: 1000, offset: 0 }),
      issues: (await db.crawls.issuesOf(crawl.id, [hashOf('/broken'), hashOf('/dup1')])).sort(
        (a, b) => a.issue.localeCompare(b.issue),
      ),
      audit: await db.crawls.auditOf(crawl.id, [hashOf('/broken')]),
      counts: await db.crawls.issueCounts(crawl.id),
    })
    const before = await snapshot()

    site[absolute('/broken')] = page('/broken')
    const { summary } = await verify(['/broken', '/dup1'], site)

    expect(summary?.status).toBe('completed')
    expect(await snapshot()).toEqual(before)
    expect(await db.crawls.active(domainId)).toBeNull()
  })

  it('does not make a priority crawl analyse, nor a full one skip analysing', async () => {
    const site = website()
    await fullCrawl(site)
    await verify(['/broken'], site)

    await db.priorityUrls.add({ domainId, url: absolute('/good') })
    const started = await db.crawls.start({ domainId, type: 'priority', trigger: 'manual' })
    await runCrawl(started!.id, {
      db,
      log,
      signal: new AbortController().signal,
      createFetcher: fakeSite(site, 0).createFetcher,
      retryBaseMs: 1,
    })
    expect((await db.crawls.get(started!.id))?.pagesByWorstIssue).toBeNull()
    const latestFull = await db.crawls.latestWithResults(domainId, 'full')
    expect(latestFull?.pagesByWorstIssue).not.toBeNull()
  })

  it('does not block a crawl, and steps aside for one without requesting anything', async () => {
    const site = website()
    const crawl = await fullCrawl(site)
    const verification = await recheck(['/broken'], crawl.id)

    const started = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    expect(started).not.toBeNull()

    const { fake, result } = run(verification.id, site)
    await expect(result).rejects.toBeInstanceOf(JobDeferredError)
    expect(fake.requests).toEqual([])
    // Waiting is not a failure, and not a start: it is still to be done.
    expect(await db.verifications.get(verification.id)).toMatchObject({
      status: 'pending',
      startedAt: null,
      urlsDoneCount: 0,
    })

    await db.crawls.cancel(started!.id)
    const again = run(verification.id, site)
    expect((await again.result)?.status).toBe('completed')
  })
})

describe('exclusions and expected indexing', () => {
  const path = (value: string): AuditSelector => ({
    kind: 'path',
    path: value,
    query: { mode: 'any' },
    scope: 'literal',
  })
  const excluding = (value: string): NewAuditRule => ({
    dimension: 'audit',
    value: 'exclude',
    selector: path(value),
    reason: null,
    enabled: true,
  })
  const expecting = (value: string, intent: 'indexable' | 'not-indexable'): NewAuditRule => ({
    dimension: 'intent',
    value: intent,
    selector: path(value),
    acceptNofollow: false,
    reason: null,
    enabled: true,
  })

  it('applies an exclusion the way the crawl does: crawled, but no findings of its own', async () => {
    const site = website()
    const crawl = await fullCrawl(site)
    expect(await crawlFindings(crawl.id, '/broken')).not.toEqual([])

    const saved = await db.audit.saveRule({ domainId, rule: excluding('/broken') })
    expect(saved.ok).toBe(true)
    const { outcomeOf, findingsOf, urls } = await verify(['/broken', '/good'], site)

    expect(outcomeOf('/broken')?.audit.participation).toBe('excluded')
    expect(findingsOf('/broken')).toEqual([])
    expect(urls.find((u) => u.urlHash === hashOf('/broken'))?.statusCode).toBe(200)
    expect(outcomeOf('/good')?.audit.participation).toBe('audited')
    // The configuration it was concluded under is kept with it.
    const config = await db.audit.config(domainId)
    expect(urls.every((u) => u.auditVersion === config.version)).toBe(true)
    expect(config.version).toBeGreaterThan(0)
  })

  it('judges what is expected of a page against the fresh answer', async () => {
    const site = website()
    await fullCrawl(site)
    await db.audit.saveRule({ domainId, rule: expecting('/good', 'not-indexable') })
    const indexable = await verify(['/good'], site)
    expect(indexable.findingsOf('/good')).toContain('expected-not-indexable-but-indexable')

    site[absolute('/good')] = page('/good', { head: '<meta name="robots" content="noindex">' })
    const hidden = await verify(['/good'], site)
    expect(hidden.findingsOf('/good')).not.toContain('expected-not-indexable-but-indexable')
    // Declared and met: the noindex is the expectation, not a finding.
    expect(hidden.findingsOf('/good')).not.toContain('noindex')
  })
})

describe('what is requested', () => {
  it('asks for the URLs and the robots.txt of their origins, nothing else', async () => {
    const site = website()
    await fullCrawl(site)
    const { fake } = await verify(['/good', '/broken'], site)
    expect([...fake.requests].sort()).toEqual(
      [`${SITE}/broken`, `${SITE}/good`, `${SITE}/robots.txt`].sort(),
    )
  })

  it('uses the settings of the domain: agent, timeout, simultaneous requests and retries', async () => {
    const site = website()
    await fullCrawl(site)
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      userAgent: 'RecheckBot/1',
      timeoutMs: 4321,
      concurrency: 1,
      maxRetries: 2,
      requestsPerSecond: 100,
    })
    let busy = 0
    site[absolute('/good')] = () => (busy++ < 2 ? { statusCode: 503, headers: {} } : page('/good'))
    site[absolute('/broken')] = page('/broken')
    site[absolute('/dup1')] = page('/dup1')
    const { fake, urls } = await verify(['/good', '/broken', '/dup1'], site)

    expect(fake.configs).toEqual([{ userAgent: 'RecheckBot/1', timeoutMs: 4321, concurrency: 1 }])
    expect(fake.peak()).toBe(1)
    // Two refusals, then the page: the retries of the domain, no more.
    expect(fake.requests.filter((url) => url === `${SITE}/good`)).toHaveLength(3)
    expect(urls.find((u) => u.urlHash === hashOf('/good'))?.statusCode).toBe(200)
    expect(fake.closed()).toBe(1)
  })

  it('gives up on a URL that keeps failing, after the retries of the domain', async () => {
    const site = website()
    await fullCrawl(site)
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      maxRetries: 1,
      requestsPerSecond: 100,
    })
    site[absolute('/good')] = new FetchError('ECONNRESET', 'reset')
    const { fake, findingsOf } = await verify(['/good'], site)
    expect(fake.requests.filter((url) => url === `${SITE}/good`)).toHaveLength(2)
    expect(findingsOf('/good')).toContain('no-response')
  })

  it('does not request a URL of another site, a crawl file or anything it was not meant to', async () => {
    const site = website()
    const crawl = await fullCrawl(site)
    const foreign = 'https://other.example/steal'
    const file = await db.crawls.getUrl(crawl.id, hashOf('/sitemap.xml'))
    expect(file && crawlFileKindOf(file.source)).not.toBeNull()
    const verification = await db.verifications.start({
      domainId,
      baseCrawlId: crawl.id,
      urls: [
        { url: foreign, urlHash: crawlUrlHash(foreign), source: 'link' },
        { url: file!.url, urlHash: file!.urlHash, source: file!.source },
        {
          url: 'http://example.com:8080/x',
          urlHash: crawlUrlHash('http://example.com:8080/x'),
          source: 'link',
        },
      ],
    })
    const { fake, result } = run(verification!.id, { ...site, [foreign]: page('/steal') })
    const summary = await result

    expect(fake.requests).toEqual([])
    expect(summary?.status).toBe('completed')
    for (const url of await db.verifications.urlsOf(verification!.id)) {
      expect(url.state).toBe('done')
      expect(url.error).toMatch(/NOT_/)
      // Nothing was requested, so nothing was checked: never "no findings".
      expect(url.outcome?.findings).toEqual([])
      expect(url.outcome?.unchecked).toEqual([...URL_SCOPED_ISSUES])
    }
  })

  it('does not look at the rechecks of another domain', async () => {
    const other = await createCompany(db, { name: 'Other', domain: 'other.example' })
    if (!other.ok) throw new Error('setup failed')
    const site = website()
    const crawl = await fullCrawl(site)
    const mine = await recheck(['/good'], crawl.id)
    const foreign = await db.verifications.start({
      domainId: other.domain.id,
      baseCrawlId: crawl.id,
      urls: [{ url: absolute('/good'), urlHash: hashOf('/good'), source: 'link' }],
    })

    // A URL of example.com in a recheck of other.example is refused: it is not that domain's.
    const { fake, result } = run(foreign!.id, site)
    await result
    expect(fake.requests).toEqual([])
    expect((await db.verifications.urlsOf(foreign!.id))[0]?.error).toMatch(/NOT_INTERNAL/)
    expect((await db.verifications.urlsOf(mine.id))[0]?.state).toBe('queued')
    expect(await db.verifications.latestFor(domainId, [hashOf('/good')])).toEqual([])
  })
})

describe('resuming, stopping and failing', () => {
  const slowSite = () => {
    const site = website()
    return site
  }

  it('carries on after a shutdown from the URLs that are left, requesting none twice', async () => {
    const site = slowSite()
    await fullCrawl(site)
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      concurrency: 1,
      requestsPerSecond: 100,
    })
    const paths = ['/broken', '/dup1', '/dup2', '/good']
    const verification = await recheck(paths)

    const shutdown = new AbortController()
    let seen = 0
    for (const path of paths) {
      const answer = site[absolute(path)]!
      site[absolute(path)] = () => {
        // The worker is told to stop while the second URL is being requested.
        if (++seen === 2) shutdown.abort()
        return typeof answer === 'function' ? answer() : answer
      }
    }
    const first = run(verification.id, site, { signal: shutdown.signal })
    await expect(first.result).rejects.toBeInstanceOf(JobInterruptedError)
    const afterShutdown = await db.verifications.get(verification.id)
    expect(afterShutdown?.status).toBe('running')
    expect(afterShutdown!.urlsDoneCount).toBeGreaterThanOrEqual(1)
    expect(afterShutdown!.urlsDoneCount).toBeLessThan(4)
    const done = new Set(
      (await db.verifications.urlsOf(verification.id))
        .filter((u) => u.state === 'done')
        .map((u) => u.url),
    )

    const second = run(verification.id, site)
    expect((await second.result)?.status).toBe('completed')
    for (const url of done) expect(second.fake.requests).not.toContain(url)
    const urls = await db.verifications.urlsOf(verification.id)
    expect(urls.map((u) => u.state)).toEqual(['done', 'done', 'done', 'done'])
    expect(await db.verifications.get(verification.id)).toMatchObject({
      status: 'completed',
      urlsDoneCount: 4,
    })
    expect(await db.verifications.active(domainId)).toBeNull()
  })

  it('does nothing for a recheck that was cancelled before it ran', async () => {
    const site = website()
    await fullCrawl(site)
    const verification = await recheck(['/good'])
    await db.verifications.cancel(verification.id)
    const { fake, result } = run(verification.id, site)
    expect(await result).toBeNull()
    expect(fake.requests).toEqual([])
    expect((await db.verifications.urlsOf(verification.id))[0]?.state).toBe('queued')
  })

  it('stops at a cancellation and keeps only what was done before it', async () => {
    const site = website()
    await fullCrawl(site)
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      concurrency: 1,
      requestsPerSecond: 100,
    })
    const verification = await recheck(['/broken', '/dup1', '/dup2', '/good'])
    let seen = 0
    for (const path of ['/broken', '/dup1', '/dup2', '/good']) {
      const answer = site[absolute(path)]!
      site[absolute(path)] = () => {
        // Cancelled by the user while the first URL is in flight.
        if (++seen === 1) void db.verifications.cancel(verification.id)
        return typeof answer === 'function' ? answer() : answer
      }
    }
    const { result } = run(verification.id, site)
    expect((await result)?.status).toBe('cancelled')
    const stored = await db.verifications.get(verification.id)
    expect(stored).toMatchObject({ status: 'cancelled' })
    // The one in flight when it was cancelled is not written; the others were never requested.
    expect(
      (await db.verifications.urlsOf(verification.id)).filter((u) => u.state === 'done'),
    ).toEqual([])
    expect(seen).toBeLessThanOrEqual(2)
    expect(await db.verifications.active(domainId)).toBeNull()
  })

  it('fails loudly on an unexpected error, and leaves the URLs to be retried', async () => {
    const site = website()
    await fullCrawl(site)
    const verification = await recheck(['/good'])
    site[absolute('/good')] = () => {
      throw new TypeError('a bug, not a response')
    }
    const { result } = run(verification.id, site)
    await expect(result).rejects.toThrow('a bug, not a response')
    expect((await db.verifications.urlsOf(verification.id))[0]?.state).toBe('queued')
    expect((await db.verifications.get(verification.id))?.status).toBe('running')
  })
})

describe('the evaluation of one URL', () => {
  const context = recheckContext({
    host: 'example.com',
    now: new Date('2026-01-01T00:00:00Z'),
    config: { version: 0, rules: [] },
    robotsTexts: new Map(),
    answered: true,
  })

  /** What a crawl keeps of a page, parsed by the code that parses it for a crawl. */
  function recheckedPage(path: string, overrides: Parameters<typeof page>[1] = {}) {
    const { result } = analyseResponse({
      item: { url: absolute(path), source: 'link' },
      response: {
        statusCode: 200,
        headers: {},
        body: null,
        truncated: false,
        bytes: 0,
        responseTimeMs: 1,
        ...page(path, overrides),
      },
      optionalFiles: [],
      log,
      discover: () => {},
    })
    return {
      url: absolute(path),
      source: 'link' as const,
      answer: result,
      linksIn: 1,
      anchors: { internal: 1, nofollow: 0 },
    }
  }
  const withHreflang = {
    head: `<link rel="alternate" hreflang="es" href="${SITE}/es/x"><link rel="alternate" hreflang="en" href="${SITE}/x">`,
  }

  it('runs every check that a recheck settles without reaching for the rest of the site', () => {
    for (const overrides of [{}, { title: null, h1: null }, { canonical: null }, withHreflang]) {
      expect(evaluateRecheck(recheckedPage('/x', overrides), context).unchecked).toEqual([])
    }
  })

  // The rest of the hreflang issues (`hreflang-no-self` and the like) are settled by a full crawl too,
  // but not because a check reads the site: sitemaps declare alternates as well, and a recheck does
  // not read them again. That is a classification (`@seotools/core/crawl/verification`), not a guard.
  it.each([
    'title-duplicate',
    'description-duplicate',
    'h1-duplicate',
    'content-duplicate',
    'content-near-duplicate',
    'orphan-in-sitemap',
    'only-nofollow-inlinks',
    'only-noindex-inlinks',
    'deep-page',
    'canonical-not-indexable',
    'redirect-chain',
    'redirect-loop',
    'sitemap-not-indexable',
    'indexable-not-in-sitemap',
    'hreflang-no-return',
  ] as const)(
    'cannot run %s in a recheck: it needs the rest of the site, and the recheck refuses to guess',
    (issue) => {
      const aPage = recheckSubject(recheckedPage('/x', withHreflang), context)
      const moved = recheckedPage('/x')
      const aRedirect = recheckSubject(
        { ...moved, answer: { ...moved.answer, kind: 'redirect', redirectTo: absolute('/y') } },
        context,
      )
      const refused = [aPage, aRedirect].some(({ url, site }) => {
        try {
          CHECKS[issue](url, site)
          return false
        } catch (error) {
          return error instanceof SiteContextError
        }
      })
      expect(refused).toBe(true)
    },
  )

  it('says a check could not be made, rather than that it found nothing', () => {
    const original = CHECKS['title-missing']
    // A check misfiled as one a recheck settles, that does look at other pages.
    CHECKS['title-missing'] = (_url, site) => site.titles.size > 0
    try {
      const outcome = evaluateRecheck(recheckedPage('/x', { title: null }), context)
      expect(outcome.unchecked).toEqual(['title-missing'])
      expect(outcome.findings.map((f) => f.issue)).not.toContain('title-missing')
      expect(
        compareWithCrawl({
          crawl: ['title-missing'],
          recheck: [],
          unchecked: outcome.unchecked,
        }),
      ).toMatchObject({ fixed: [], pendingFullCrawl: ['title-missing'] })
    } finally {
      CHECKS['title-missing'] = original
    }
  })

  it('counts the anchors of a page like a crawl stores them', () => {
    const counter = createAnchorCounter('example.com', `${SITE}/page`)
    counter.add(`${SITE}/a`, 'anchor')
    counter.add(`${SITE}/a`, 'anchor')
    counter.add(`${SITE}/a`, 'anchor-nofollow')
    counter.add(`${SITE}/page`, 'anchor')
    counter.add('https://elsewhere.example/', 'anchor')
    counter.add(`${SITE}/img.png`, 'image')
    expect(counter.internal).toBe(2)
    expect(counter.nofollow).toBe(1)
  })
})
