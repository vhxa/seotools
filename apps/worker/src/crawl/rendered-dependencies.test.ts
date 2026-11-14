import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  classifyFinding,
  compareWithCrawl,
  createLogger,
  crawlUrlHash,
  evidenceOf,
  indexTraces,
  observe,
} from '@seotools/core'
import { createCompany, compareWithPrevious, type Crawl } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { runCrawl } from './engine'
import { fakeSite, type Answer } from './fake-site'
import { page, SITE } from './test-site'
import { renderedOutcome } from './render-fixture'
import { loadSite } from './site-audit'
import { analyseCrawl, currentAuditConfig } from './analysis'
import { runVerification } from './verification'
import type { RenderInput, RenderOutcome } from '../render/types'

/**
 * Findings whose presence depends on another issue's result, or on a URL's canonical, are unknown
 * for a URL of a rendered crawl when that other result is: in the crawl, in comparisons and alerts,
 * and in rechecks.
 */
let db: Database
let domainId: string
const log = createLogger('dependencies-test', 'silent')
const signal = new AbortController().signal
const hash = (path: string) => crawlUrlHash(`${SITE}${path}`)
const ready = async () => ({ state: 'ready' as const, checkedAt: new Date().toISOString() })
const body = (path: string, options: Parameters<typeof page>[1]) =>
  page(path, options).body!.toString()
const text = (statusCode: number, content: string, headers: Record<string, string> = {}) => ({
  statusCode,
  headers: { 'content-type': 'text/plain', ...headers },
  body: Buffer.from(content),
})

beforeEach(async () => {
  db = await createTestDatabase()
  const created = await createCompany(db, { name: 'Dependencies', domain: 'example.com' })
  if (!created.ok) throw new Error('setup failed')
  domainId = created.domain.id
  await mode('headless')
})
afterEach(async () => {
  await db.close()
})

async function mode(renderingMode: 'headless' | 'http') {
  await db.crawls.saveSettings(domainId, {
    ...(await db.crawls.settings(domainId)),
    renderingMode,
    requestsPerSecond: 100,
    maxRetries: 0,
    retainCrawls: null,
  })
}

async function rule(dimension: string, value: string, path: string) {
  await db.audit.saveRule({
    domainId,
    rule: {
      dimension,
      value,
      selector: { kind: 'path', path, query: { mode: 'any' }, scope: 'literal' },
      reason: null,
      enabled: true,
    } as Parameters<typeof db.audit.saveRule>[0]['rule'],
  })
}

async function crawl(
  data: Record<string, Answer>,
  render: (input: RenderInput) => Promise<RenderOutcome> = async (input) => renderedOutcome(input),
) {
  const started = (await db.crawls.start({ domainId, type: 'full', trigger: 'manual' }))!
  await runCrawl(started.id, {
    db,
    log,
    createFetcher: fakeSite(data, 0).createFetcher,
    renderService: { check: ready, render },
    signal,
  })
  return (await db.crawls.get(started.id))!
}

const ids = async (crawl: Crawl, path: string) =>
  (await db.crawls.issuesOf(crawl.id, [hash(path)])).map(({ issue }) => issue)
const acceptedIds = async (crawl: Crawl, path: string) =>
  (await db.crawls.acceptedOf(crawl.id, [hash(path)])).map(({ issue }) => issue)
const unknownOf = async (crawl: Crawl, path: string) =>
  (await db.crawls.auditOf(crawl.id, [hash(path)]))[0]?.documentUnobserved ?? []

/** Every ordered pair of consecutive crawls, both ways: never a change the evidence cannot back. */
async function expectNeverNamed(crawls: Crawl[], path: string, issues: readonly string[]) {
  const traces = indexTraces(
    await db.crawls.urlHistory({
      domainId,
      crawlIds: crawls.map((c) => c.id),
      urlHashes: [hash(path)],
    }),
  )
  const evidence = evidenceOf(crawls, traces, hash(path))
  for (let i = 0; i + 1 < crawls.length; i++) {
    for (const [a, b] of [
      [i, i + 1],
      [i + 1, i],
    ]) {
      for (const issue of issues) {
        const change = classifyFinding(issue, {
          base: evidence[a!]!,
          target: evidence[b!]!,
          earlier: evidence.slice(0, Math.min(a!, b!)),
        })
        if (change) expect(change.kind, `${issue} ${a}→${b}`).toBe('unverified')
      }
    }
  }
  for (const target of crawls.slice(1)) {
    const changes = await compareWithPrevious({ db, target, exact: true })
    for (const issue of issues)
      expect(changes.byIssue.get(issue) ?? { fresh: 0, back: 0, resolved: 0 }, issue).toMatchObject(
        { fresh: 0, back: 0, resolved: 0 },
      )
    expect(changes.important.filter((entry) => issues.includes(entry.issue))).toEqual([])
  }
  return evidence
}

const failing =
  (path: string | null) =>
  async (input: RenderInput): Promise<RenderOutcome> => ({
    ...renderedOutcome(input),
    ...(path && input.url === `${SITE}${path}`
      ? { status: 'failed' as const, failure: { code: 'serialization' as const, message: 'test' } }
      : {}),
  })

it('keeps robots-blocked unknown where an unknown expected-indexable-blocked would have taken its place', async () => {
  // The review's reproduction: an explicit `indexable` rule, a robots.txt block and a failed render.
  await rule('intent', 'indexable', '/a')
  const data = {
    [`${SITE}/`]: page('/', { links: '<a href="/a">A</a>' }),
    [`${SITE}/a`]: page('/a'),
    [`${SITE}/robots.txt`]: text(200, 'User-agent: *\nDisallow: /a\n'),
  }
  const crawls: Crawl[] = []
  for (const failed of [false, true, false])
    crawls.push(await crawl(data, failing(failed ? '/a' : null)))

  // Complete: the expectation names the block, and the generic finding is not repeated.
  expect(await ids(crawls[0]!, '/a')).toContain('expected-indexable-blocked')
  expect(await ids(crawls[0]!, '/a')).not.toContain('robots-blocked')
  // Incomplete: neither is judged, and both are stored as unknown for the URL.
  expect(await ids(crawls[1]!, '/a')).not.toContain('robots-blocked')
  expect(await ids(crawls[1]!, '/a')).not.toContain('expected-indexable-blocked')
  expect(await acceptedIds(crawls[1]!, '/a')).not.toContain('robots-blocked')
  expect(await unknownOf(crawls[1]!, '/a')).toEqual(
    expect.arrayContaining(['robots-blocked', 'expected-indexable-blocked']),
  )
  expect(await unknownOf(crawls[0]!, '/a')).not.toContain('robots-blocked')
  const evidence = await expectNeverNamed(crawls, '/a', ['robots-blocked'])
  expect(observe('robots-blocked', evidence[1]!).presence).toBe('unknown')
  expect(observe('robots-blocked', evidence[0]!).presence).toBe('absent')

  // A recheck reads only the HTML: it cannot say whether the expectation would take its place.
  for (const base of crawls.slice(0, 2)) {
    const verification = (await db.verifications.start({
      domainId,
      baseCrawlId: base.id,
      urls: [{ url: `${SITE}/a`, urlHash: hash('/a'), source: 'link' }],
    }))!
    await runVerification(verification.id, {
      db,
      log,
      signal,
      createFetcher: fakeSite(data, 0).createFetcher,
    })
    const outcome = (await db.verifications.urlsOf(verification.id))[0]!.outcome!
    const found = outcome.findings.map((finding) => finding.issue)
    expect(found).not.toContain('robots-blocked')
    expect(outcome.unchecked).toEqual(
      expect.arrayContaining(['robots-blocked', 'expected-indexable-blocked']),
    )
    const comparison = compareWithCrawl({
      renderedBase: true,
      crawl: await ids(base, '/a'),
      recheck: found,
      unchecked: outcome.unchecked,
    })
    expect(comparison.appeared).not.toContain('robots-blocked')
    expect(comparison.fixed).not.toContain('robots-blocked')
  }
})

it('rechecks robots-blocked of an HTML crawl exactly as before', async () => {
  await mode('http')
  await rule('intent', 'indexable', '/a')
  const data = {
    [`${SITE}/`]: page('/', { links: '<a href="/a">A</a>' }),
    [`${SITE}/a`]: page('/a'),
    [`${SITE}/robots.txt`]: text(200, 'User-agent: *\nDisallow: /a\n'),
  }
  const base = await crawl(data)
  expect(await unknownOf(base, '/a')).toEqual([])
  const verification = (await db.verifications.start({
    domainId,
    baseCrawlId: base.id,
    urls: [{ url: `${SITE}/a`, urlHash: hash('/a'), source: 'link' }],
  }))!
  await runVerification(verification.id, {
    db,
    log,
    signal,
    createFetcher: fakeSite(data, 0).createFetcher,
  })
  const outcome = (await db.verifications.urlsOf(verification.id))[0]!.outcome!
  const found = outcome.findings.map((finding) => finding.issue)
  expect(found).toContain('expected-indexable-blocked')
  expect(found).not.toContain('robots-blocked')
  expect(outcome.unchecked).not.toContain('robots-blocked')
})

it('leaves every check reading a conflicting rendered canonical unknown (canonical-broken, canonical-redirect)', async () => {
  // The review's reproduction: the rendered canonical points at a 404 and at a redirect, then the
  // rendered page declares a second, conflicting canonical.
  const data = {
    [`${SITE}/`]: page('/', {
      links: '<a href="/a">A</a><a href="/b">B</a><a href="/gone">G</a><a href="/moved">M</a>',
    }),
    [`${SITE}/a`]: page('/a', { canonical: '/gone' }),
    [`${SITE}/b`]: page('/b', { canonical: '/moved' }),
    [`${SITE}/gone`]: text(404, 'gone', { 'content-type': 'text/html' }),
    [`${SITE}/moved`]: text(301, '', { location: `${SITE}/` }),
  }
  const conflicting = async (input: RenderInput): Promise<RenderOutcome> => {
    const path = new URL(input.url).pathname
    const target = path === '/a' ? '/gone' : path === '/b' ? '/moved' : null
    return {
      ...renderedOutcome(input),
      ...(target
        ? { html: body(path, { canonical: target, head: '<link rel="canonical" href="/other">' }) }
        : {}),
    }
  }
  const crawls = [await crawl(data), await crawl(data, conflicting), await crawl(data)]
  expect(await ids(crawls[0]!, '/a')).toContain('canonical-broken')
  expect(await ids(crawls[0]!, '/b')).toContain('canonical-redirect')
  for (const [path, issue] of [
    ['/a', 'canonical-broken'],
    ['/b', 'canonical-redirect'],
  ] as const) {
    expect(await ids(crawls[1]!, path)).not.toContain(issue)
    expect(await ids(crawls[1]!, path)).toContain('canonical-conflict')
    expect(await unknownOf(crawls[1]!, path), path).toEqual(
      expect.arrayContaining([
        'canonical-broken',
        'canonical-redirect',
        'canonical-not-indexable',
        'indexable-not-in-sitemap',
        'title-duplicate',
        'content-near-duplicate',
      ]),
    )
    // What does not read the canonical is still judged.
    expect(await unknownOf(crawls[1]!, path)).not.toContain('title-missing')
    expect(await unknownOf(crawls[1]!, path)).not.toContain('canonical-conflict')
    await expectNeverNamed(crawls, path, [issue])
  }
  // Other pages read its indexability too (duplicates, canonical and hreflang targets).
  expect(crawls[1]!.auditSnapshot?.unobserved).toEqual(
    expect.arrayContaining(['canonical-broken', 'canonical-redirect', 'title-duplicate']),
  )
})

it('leaves what links say of a URL unknown when whether it is expected out is', async () => {
  // Expected out (a rule says not indexable, and it has a noindex): only nofollow links reaching it
  // are accepted. With a conflicting canonical its blockers are unknown, and so is that acceptance.
  await rule('intent', 'not-indexable', '/a')
  const data = {
    [`${SITE}/`]: page('/', { links: '<a href="/a" rel="nofollow">A</a>' }),
    [`${SITE}/a`]: page('/a', { head: '<meta name="robots" content="noindex">' }),
  }
  const conflicting = async (input: RenderInput): Promise<RenderOutcome> => ({
    ...renderedOutcome(input),
    ...(input.url === `${SITE}/a`
      ? {
          html: body('/a', {
            head: '<meta name="robots" content="noindex"><link rel="canonical" href="/other">',
          }),
        }
      : {}),
  })
  const crawls = [await crawl(data), await crawl(data, conflicting), await crawl(data)]
  expect(await acceptedIds(crawls[0]!, '/a')).toContain('only-nofollow-inlinks')
  expect(await ids(crawls[0]!, '/a')).not.toContain('only-nofollow-inlinks')
  expect(await ids(crawls[1]!, '/a')).not.toContain('only-nofollow-inlinks')
  expect(await acceptedIds(crawls[1]!, '/a')).not.toContain('only-nofollow-inlinks')
  expect(await unknownOf(crawls[1]!, '/a')).toContain('only-nofollow-inlinks')
  await expectNeverNamed(crawls, '/a', ['only-nofollow-inlinks'])
})

it('keeps the served meta nofollow of a page JavaScript redirects in the link graph', async () => {
  const data = {
    [`${SITE}/`]: page('/', { links: '<a href="/r">R</a>' }),
    [`${SITE}/r`]: page('/r', {
      head: '<meta name="robots" content="nofollow">',
      links: '<a href="/x">X</a>',
    }),
    [`${SITE}/x`]: page('/x', { links: '<a href="/">Home</a>' }),
  }
  const result = await crawl(data, async (input) => ({
    ...renderedOutcome(input),
    ...(input.url === `${SITE}/r`
      ? { redirected: true, settled: false, finalUrl: `${SITE}/x` }
      : {}),
  }))
  const site = await loadSite(db, result, result.auditSnapshot!)
  const redirecting = site.get(`${SITE}/r`)!
  expect(redirecting.documentObservation).toBe('redirected')
  expect(redirecting.nofollow).toBe(true)
  expect(site.get(`${SITE}/x`)!.anchorsIn).toBe(1)
  expect(site.get(`${SITE}/x`)!.followedAnchorsIn).toBe(0)
})

it('leaves links-to-canonicalised unknown for the crawl when its target redirects by JavaScript', async () => {
  // The review's reproduction: home links to /x, canonicalised to /b; in the second crawl /x
  // redirects by JavaScript, so it has no document and nobody can tell whether it is canonicalised.
  const data = {
    [`${SITE}/`]: page('/', { links: '<a href="/x">X</a><a href="/b">B</a>' }),
    [`${SITE}/x`]: page('/x', { canonical: '/b' }),
    [`${SITE}/b`]: page('/b'),
  }
  const redirecting = async (input: RenderInput): Promise<RenderOutcome> => ({
    ...renderedOutcome(input),
    ...(input.url === `${SITE}/x`
      ? { redirected: true, settled: false, finalUrl: `${SITE}/b` }
      : {}),
  })
  const crawls = [await crawl(data), await crawl(data, redirecting), await crawl(data)]
  expect(await ids(crawls[0]!, '/')).toContain('links-to-canonicalised')
  expect(await ids(crawls[2]!, '/')).toContain('links-to-canonicalised')
  expect(crawls[0]!.auditSnapshot?.unobserved).not.toContain('links-to-canonicalised')
  expect(crawls[1]!.auditSnapshot?.unobserved).toContain('links-to-canonicalised')
  // A JavaScript redirect is a proven blocker for what links from it say of their targets.
  expect(crawls[1]!.auditSnapshot?.unobserved).not.toContain('only-noindex-inlinks')
  const evidence = await expectNeverNamed(crawls, '/', ['links-to-canonicalised'])
  expect(observe('links-to-canonicalised', evidence[1]!).presence).toBe('unknown')
})

it('leaves only-nofollow-inlinks unknown for the crawl when a linking page has no extracted document', async () => {
  // Home says nofollow in its meta robots; a render without extracted values (an older row) leaves
  // its directives, and so whether its links are followed, unknown.
  const data = {
    [`${SITE}/`]: page('/', {
      head: '<meta name="robots" content="nofollow">',
      links: '<a href="/a">A</a>',
    }),
    [`${SITE}/a`]: page('/a'),
  }
  const crawls: Crawl[] = []
  for (const legacy of [false, true, false]) {
    const result = await crawl(data)
    if (legacy) {
      const url = (await db.crawls.getUrl(result.id, hash('/')))!
      const row = (await db.crawls.renders(result.id)).find((row) => row.urlHash === hash('/'))!
      delete row.data.page
      await db.crawls.recordResult({
        crawlId: result.id,
        urlHash: hash('/'),
        result: url,
        render: row,
      })
      await analyseCrawl(db, result.id, await currentAuditConfig(db, domainId))
    }
    crawls.push((await db.crawls.get(result.id))!)
  }
  expect(await ids(crawls[0]!, '/a')).toContain('only-nofollow-inlinks')
  expect(await ids(crawls[1]!, '/a')).not.toContain('only-nofollow-inlinks')
  expect(crawls[1]!.auditSnapshot?.unobserved).toContain('only-nofollow-inlinks')
  expect(crawls[1]!.auditSnapshot?.rendersUnobserved).toBe(0)
  await expectNeverNamed(crawls, '/a', ['only-nofollow-inlinks'])
})
