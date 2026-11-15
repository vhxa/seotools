import { RENDER_DIFFERENCE_IDS } from './render-differences'
import {
  AUDIT_SEMANTICS,
  EMPTY_AUDIT_SNAPSHOT,
  ISSUE_CATALOG_VERSION,
  NO_LANGUAGES,
  auditSnapshotOf,
  crawlUrlHash,
  createLogger,
  type AuditSelector,
  type NewAuditRule,
  type PageIssueId,
} from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyseCrawl, currentAuditConfig } from './analysis'
import { recomputeAudit } from './audit-recompute'
import { runCrawl } from './engine'
import { fakeSite, moved, type Answer } from './fake-site'
import { FetchError } from './fetcher'
import { reanalyseOutdatedCrawls } from './reanalysis'
import { SITE, page, sitemapOf, xml } from './test-site'

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
    maxRetries: 0,
  })
})
afterEach(async () => {
  await db.close()
})

// --- rules -----------------------------------------------------------------------------------------

const prefix = (
  path: string,
  query: 'any' | string = 'any',
  scope: 'literal' | 'shared' = 'literal',
): AuditSelector => ({
  kind: 'prefix',
  path,
  query: query === 'any' ? { mode: 'any' } : { mode: 'exact', value: query },
  scope,
})
const exactPath = (path: string, scope: 'literal' | 'shared' = 'literal'): AuditSelector => ({
  kind: 'path',
  path,
  query: { mode: 'any' },
  scope,
})
const sharedPath = (path: string) => exactPath(path, 'shared')
const exactUrl = (path: string): AuditSelector => ({ kind: 'url', url: `${SITE}${path}` })

const exclusion = (
  selector: AuditSelector,
  value: 'exclude' | 'include' = 'exclude',
): NewAuditRule => ({
  dimension: 'audit',
  value,
  selector,
  reason: 'Not part of the audit',
  enabled: true,
})
const expecting = (
  selector: AuditSelector,
  value: 'indexable' | 'not-indexable',
): NewAuditRule => ({
  dimension: 'intent',
  value,
  selector,
  reason: null,
  enabled: true,
})
const asking = (
  selector: AuditSelector,
  dimension: 'noindex' | 'nofollow' | 'robots' | 'sitemap',
  value: 'required' | 'allowed' | 'forbidden',
): NewAuditRule => ({ dimension, value, selector, reason: null, enabled: true })

async function addRules(rules: NewAuditRule[], domain = domainId) {
  const ids: string[] = []
  for (const rule of rules) {
    const saved = await db.audit.saveRule({ domainId: domain, rule })
    if (!saved.ok) throw new Error(`rule not saved: ${saved.error}`)
    ids.push(saved.rule!.id)
  }
  return ids
}

// --- sites -----------------------------------------------------------------------------------------

const absolute = (path: string) => (path.startsWith('http') ? path : `${SITE}${path}`)

/**
 * A small shop whose pages have nothing wrong, except the cart: it has no title and no H1, and only
 * the cart links to its checkout. `overrides` replace pages by path.
 */
function shop(overrides: Record<string, Answer> = {}) {
  const pages: Record<string, Answer> = {
    '/': page('/', {
      links:
        '<a href="/about">About us</a><a href="/product">The product</a><a href="/cart">Your cart</a>',
    }),
    '/about': page('/about'),
    '/product': page('/product', {
      links: '<a href="/">Back to the home page</a><a href="/cart">Your cart</a>',
    }),
    '/cart': page('/cart', {
      title: null,
      h1: null,
      links: '<a href="/">Back to the home page</a><a href="/cart/checkout">Checkout now</a>',
    }),
    '/cart/checkout': page('/cart/checkout'),
    ...overrides,
  }
  const site: Record<string, Answer> = {
    [`${SITE}/sitemap.xml`]: xml(sitemapOf(Object.keys(pages))),
  }
  for (const [path, answer] of Object.entries(pages)) site[absolute(path)] = answer
  return site
}

async function crawl(site: Record<string, Answer>, domain = domainId) {
  const started = await db.crawls.start({ domainId: domain, type: 'full', trigger: 'manual' })
  if (!started) throw new Error('crawl did not start')
  const fake = fakeSite(site, 0)
  await runCrawl(started.id, {
    db,
    log,
    signal: new AbortController().signal,
    createFetcher: fake.createFetcher,
    retryBaseMs: 1,
  })
  return { id: started.id, requests: fake.requests }
}

const hashOf = (path: string) => crawlUrlHash(absolute(path))
const findings = async (crawlId: string, path: string) =>
  (await db.crawls.issuesOf(crawlId, [hashOf(path)])).map((row) => row.issue)
const stateOf = async (crawlId: string, path: string) =>
  (await db.crawls.auditOf(crawlId, [hashOf(path)]))[0]
const stored = async (crawlId: string, path: string) => db.crawls.getUrl(crawlId, hashOf(path))

const CART_PROBLEMS: PageIssueId[] = ['title-missing', 'h1-missing']

// --- a URL left out of the audit ---------------------------------------------------------------------

describe('a URL excluded from the audit', () => {
  it('is still crawled and its links followed, but has no findings of its own', async () => {
    // Without the rule, the cart is a page with two problems of its own.
    const before = await crawl(shop())
    expect(await findings(before.id, '/cart')).toEqual(expect.arrayContaining(CART_PROBLEMS))

    await addRules([exclusion(exactPath('/cart'))])
    const after = await crawl(shop())

    expect(await findings(after.id, '/cart')).toEqual([])
    expect(after.requests).toContain(absolute('/cart'))
    // It was crawled all the same: what it linked to was found, and is audited like any page.
    expect(after.requests).toContain(absolute('/cart/checkout'))
    expect(await stored(after.id, '/cart/checkout')).toMatchObject({ kind: 'page', state: 'done' })
    expect(await stateOf(after.id, '/cart/checkout')).toMatchObject({ participation: 'audited' })
    // It is still a crawled URL and a page the crawl found.
    expect(await stored(after.id, '/cart')).toMatchObject({ kind: 'page', title: null })
    const crawlRow = (await db.crawls.get(after.id))!
    expect(crawlRow.pagesCount).toBe((await db.crawls.get(before.id))!.pagesCount)
    // Its links are still in the graph, both ways.
    expect((await db.crawls.linkTargets(after.id, hashOf('/cart'))).map((l) => l.url)).toContain(
      absolute('/cart/checkout'),
    )
    expect((await db.crawls.linkSources(after.id, hashOf('/cart'))).map((l) => l.url)).toContain(
      absolute('/product'),
    )
  })

  it('says which rule excluded it, and why', async () => {
    const [id] = await addRules([exclusion(prefix('/cart'))])
    const { id: crawlId } = await crawl(shop())
    expect(await stateOf(crawlId, '/cart')).toMatchObject({
      participation: 'excluded',
      participationRule: id,
    })
    expect(await stateOf(crawlId, '/cart/checkout')).toMatchObject({
      participation: 'excluded',
      participationRule: id,
    })
    expect(await stateOf(crawlId, '/about')).toMatchObject({
      participation: 'audited',
      participationRule: null,
    })
    // The configuration the analysis used is kept with it, reason included.
    const row = (await db.crawls.get(crawlId))!
    expect(row.auditSnapshot?.rules).toEqual([
      expect.objectContaining({ id, reason: 'Not part of the audit' }),
    ])
  })

  it('keeps its data as the crawl saw it', async () => {
    await addRules([exclusion(exactPath('/cart'))])
    const { id } = await crawl(
      shop({
        '/cart': page('/cart', {
          head: '<meta name="robots" content="noindex">',
          canonical: `${SITE}/product`,
          links: '<a href="/cart/checkout">Checkout now</a>',
        }),
      }),
    )
    expect(await stored(id, '/cart')).toMatchObject({
      statusCode: 200,
      metaRobots: 'noindex',
      canonical: `${SITE}/product`,
    })
    expect(await findings(id, '/cart')).toEqual([])
    // What it is, technically, is still known.
    expect(await stateOf(id, '/cart')).toMatchObject({
      participation: 'excluded',
      indexability: 'not-indexable',
      blockers: ['noindex', 'canonical'],
    })
  })

  it('keeps an HTTP error as data, without an issue of its own', async () => {
    const broken = shop({ '/cart': { statusCode: 500, headers: { 'content-type': 'text/html' } } })
    const before = await crawl(broken)
    expect(await findings(before.id, '/cart')).toContain('server-error')

    await addRules([exclusion(exactPath('/cart'))])
    const after = await crawl(broken)
    expect(await stored(after.id, '/cart')).toMatchObject({ statusCode: 500, state: 'done' })
    expect(await findings(after.id, '/cart')).toEqual([])
    expect(await stateOf(after.id, '/cart')).toMatchObject({
      participation: 'excluded',
      indexability: 'not-indexable',
      blockers: ['http-error'],
    })
  })

  it('keeps a request that failed as data, without an issue of its own', async () => {
    await addRules([exclusion(exactPath('/cart'))])
    const { id } = await crawl(shop({ '/cart': new FetchError('ECONNRESET', 'connection reset') }))
    expect(await stored(id, '/cart')).toMatchObject({ statusCode: null, error: expect.any(String) })
    expect(await findings(id, '/cart')).toEqual([])
  })

  it('does not take part in the totals of problems or in the pages that were audited', async () => {
    const before = (await db.crawls.get((await crawl(shop())).id))!
    expect(before.pagesAudit).toMatchObject({ audited: before.pagesCount, excluded: 0 })

    await addRules([exclusion(exactPath('/cart'))])
    const after = (await db.crawls.get((await crawl(shop())).id))!
    expect(after.pagesCount).toBe(before.pagesCount)
    expect(after.pagesAudit).toMatchObject({ audited: before.pagesCount - 1, excluded: 1 })
    expect(after.pagesAudit!.audited + after.pagesAudit!.excluded).toBe(after.pagesCount)
    // The cart had warnings; the other four pages still have the few-links opportunity.
    expect(before.pagesWithType!.warning).toBe(1)
    expect(after.pagesWithType).toEqual({ issue: 0, warning: 0, opportunity: 4 })
    expect(after.pagesByWorstIssue).toEqual({ issue: 0, warning: 0, opportunity: 4 })
    expect(await db.crawls.issueCounts(after.id)).toEqual([
      { issue: 'few-html-links', pages: 4, secondary: 0 },
    ])
  })

  it('is not indexable or correct for having no findings: indexability is the crawl’s own', async () => {
    const noindexed = shop({
      '/cart': page('/cart', { head: '<meta name="robots" content="noindex">' }),
    })
    const base = (await db.crawls.get((await crawl(noindexed)).id))!
    // The cart is noindexed. The three URLs only the crawler tried answered 404: errors, not pages.
    expect(base.pagesAudit).toMatchObject({ indexable: 4, notIndexable: 1, unknownIndexability: 0 })

    await addRules([exclusion(exactPath('/cart')), exclusion(exactPath('/about'))])
    const excluded = (await db.crawls.get((await crawl(noindexed)).id))!
    // Two pages left the audit, and the pages that can be indexed did not change at all: /about
    // still can, and the noindexed cart still cannot, whatever the audit says of them.
    expect(excluded.pagesAudit).toMatchObject({
      audited: base.pagesCount - 2,
      excluded: 2,
      indexable: 4,
      notIndexable: 1,
    })
    expect(excluded.pagesCount).toBe(base.pagesCount)
  })

  it('does not make audited pages look like copies of it', async () => {
    const copy = (path: string) =>
      page(path, {
        title: 'The very same title for two pages of this site',
        description: 'The very same description for two pages of this site, long enough to count.',
        h1: 'The very same heading',
        text: 'These words are the same on both pages and nothing else is. '.repeat(40),
      })
    const twins = shop({ '/product': copy('/product'), '/about': copy('/about') })
    const before = await crawl(twins)
    expect(await findings(before.id, '/product')).toEqual(
      expect.arrayContaining(['title-duplicate', 'description-duplicate', 'content-duplicate']),
    )

    await addRules([exclusion(exactPath('/about'))])
    const after = await crawl(twins)
    expect(await findings(after.id, '/about')).toEqual([])
    const product = await findings(after.id, '/product')
    for (const duplicate of [
      'title-duplicate',
      'description-duplicate',
      'h1-duplicate',
      'content-duplicate',
      'content-near-duplicate',
    ] as const) {
      expect(product).not.toContain(duplicate)
    }
  })

  it('does not hide a wrong relation to it from the pages that are audited', async () => {
    await addRules([exclusion(exactPath('/cart')), exclusion(exactPath('/about'))])
    const { id } = await crawl(
      shop({
        // The canonical of /product leads to a page that cannot be indexed, and its hreflang to one
        // that does not exist; both are excluded, and both are still wrong.
        '/cart': page('/cart', { head: '<meta name="robots" content="noindex">' }),
        '/product': page('/product', {
          canonical: `${SITE}/cart`,
          head: `<link rel="alternate" hreflang="es" href="${SITE}/about"><link rel="alternate" hreflang="en" href="${SITE}/product">`,
          links: '<a href="/">Back to the home page</a><a href="/cart">Your cart</a>',
        }),
        '/about': { statusCode: 404, headers: { 'content-type': 'text/html' } },
      }),
    )
    const found = await findings(id, '/product')
    expect(found).toContain('canonical-not-indexable')
    expect(found).toContain('hreflang-unreachable')
  })

  it('is not a problem to point at it, on its own', async () => {
    await addRules([exclusion(exactPath('/cart')), exclusion(exactPath('/about'))])
    const { id } = await crawl(
      shop({
        '/cart': page('/cart'),
        '/product': page('/product', {
          canonical: `${SITE}/product`,
          head: `<link rel="alternate" hreflang="es" href="${SITE}/about"><link rel="alternate" hreflang="en" href="${SITE}/product">`,
          links: '<a href="/">Back to the home page</a><a href="/cart">Your cart</a>',
        }),
        '/about': page('/about', {
          head: `<link rel="alternate" hreflang="en" href="${SITE}/product"><link rel="alternate" hreflang="es" href="${SITE}/about">`,
        }),
      }),
    )
    // Nothing is said of /product for linking to, or declaring an alternate in, excluded pages.
    const relations = [
      'canonical-not-indexable',
      'canonical-conflict',
      'hreflang-unreachable',
      'hreflang-redirect',
      'hreflang-no-return',
      'hreflang-non-canonical',
      'hreflang-noindex',
      'only-nofollow-inlinks',
      'only-noindex-inlinks',
    ]
    expect((await findings(id, '/product')).filter((issue) => relations.includes(issue))).toEqual(
      [],
    )
  })

  it('does not spread to what it links to, redirects to or loads', async () => {
    await addRules([exclusion(exactPath('/cart'))])
    const { id } = await crawl(
      shop({
        '/cart': moved('/cart/checkout'),
        '/cart/checkout': page('/cart/checkout', { title: null }),
      }),
    )
    expect(await findings(id, '/cart')).toEqual([])
    expect(await stateOf(id, '/cart/checkout')).toMatchObject({ participation: 'audited' })
    expect(await findings(id, '/cart/checkout')).toContain('title-missing')
  })

  it('can be told apart from a URL that was never analysed', async () => {
    const { id } = await crawl(shop())
    // Only the internal URLs of an analysed crawl have a state; the rest are not made up.
    expect(await stateOf(id, '/about')).toBeDefined()
    expect(await db.crawls.auditOf(id, [crawlUrlHash('https://elsewhere.org/')])).toEqual([])
  })
})

// --- what is expected of a URL's indexation -------------------------------------------------------

describe('the indexation expected of a URL', () => {
  describe('when it is expected not to be indexable', () => {
    it('accepts a noindex, and a canonical elsewhere, as the expectation', async () => {
      await addRules([expecting(exactPath('/cart'), 'not-indexable')])
      const { id } = await crawl(
        shop({
          '/cart': page('/cart', { head: '<meta name="robots" content="noindex">' }),
          '/about': page('/about', { head: '<meta name="robots" content="noindex">' }),
        }),
      )
      expect(await findings(id, '/cart')).not.toContain('noindex')
      expect(await findings(id, '/cart')).not.toContain('expected-not-indexable-but-indexable')
      // It is not a license to hide it elsewhere: a noindex nobody expected is still an issue.
      expect(await findings(id, '/about')).toContain('noindex')
      expect(await stateOf(id, '/cart')).toMatchObject({
        intent: 'not-indexable',
        indexability: 'not-indexable',
        participation: 'audited',
      })
    })

    it('reports a URL that can technically be indexed, once', async () => {
      await addRules([expecting(exactPath('/cart'), 'not-indexable')])
      const { id } = await crawl(shop())
      const found = await findings(id, '/cart')
      expect(
        found.filter((issue) => issue === 'expected-not-indexable-but-indexable'),
      ).toHaveLength(1)
      // The audit goes on for everything else it was about.
      expect(found).toEqual(expect.arrayContaining(CART_PROBLEMS))
    })

    it('does not also ask for it to be in the sitemap', async () => {
      await addRules([expecting(exactPath('/cart'), 'not-indexable')])
      const site = shop()
      delete site[`${SITE}/sitemap.xml`]
      const withoutSitemap = { ...site, [`${SITE}/sitemap.xml`]: xml(sitemapOf(['/', '/about'])) }
      const { id } = await crawl(withoutSitemap)
      const found = await findings(id, '/cart')
      expect(found).toContain('expected-not-indexable-but-indexable')
      expect(found).not.toContain('indexable-not-in-sitemap')
      // An unexpected one is still asked for.
      expect(await findings(id, '/product')).toContain('indexable-not-in-sitemap')
    })

    it('keeps the conflicts of directives and the blocks of robots.txt', async () => {
      await addRules([expecting(exactPath('/cart'), 'not-indexable')])
      const { id } = await crawl({
        ...shop({
          '/cart': page('/cart', {
            head: '<meta name="robots" content="index, noindex">',
            links: '<a href="/">Back to the home page</a>',
          }),
        }),
        [`${SITE}/robots.txt`]: {
          statusCode: 200,
          headers: { 'content-type': 'text/plain' },
          body: Buffer.from('User-agent: *\nDisallow: /cart'),
        },
      })
      const found = await findings(id, '/cart')
      expect(found).toContain('directives-conflict')
      // Blocking crawlers is not proof that a URL stays out of the index: it is kept as a finding.
      expect(found).toContain('robots-blocked')
      expect(found).not.toContain('noindex')
      expect(found).not.toContain('expected-not-indexable-but-indexable')
      expect(await stateOf(id, '/cart')).toMatchObject({
        indexability: 'not-indexable',
        blockers: ['noindex', 'robots'],
      })
    })

    it('does not read a failed request as the expectation being met', async () => {
      await addRules([expecting(exactPath('/cart'), 'not-indexable')])
      const { id } = await crawl(shop({ '/cart': new FetchError('ETIMEDOUT', 'timed out') }))
      expect(await stateOf(id, '/cart')).toMatchObject({
        intent: 'not-indexable',
        indexability: 'unknown',
        blockers: [],
      })
      expect(await findings(id, '/cart')).not.toContain('expected-not-indexable-but-indexable')
      // It did not answer, so it is not a page, and it is not counted as one that cannot be indexed.
      const row = (await db.crawls.get(id))!
      expect(await stored(id, '/cart')).toMatchObject({ kind: 'unknown' })
      expect(row.pagesAudit!.notIndexable).toBe(0)
    })
  })

  describe('when it is expected to be indexable', () => {
    const only = async (page_: Answer, path = '/product') => {
      await addRules([expecting(exactPath(path), 'indexable')])
      const { id } = await crawl(shop({ [path]: page_ }))
      return { id, found: await findings(id, path) }
    }

    it('has only a quality opportunity on a page that can be indexed', async () => {
      const { id, found } = await only(page('/product'))
      expect(found).toEqual(['few-html-links'])
      expect(await stateOf(id, '/product')).toMatchObject({
        intent: 'indexable',
        indexability: 'indexable',
      })
    })

    it('finds a noindex as one finding that names it, not as two', async () => {
      const { found } = await only(
        page('/product', { head: '<meta name="robots" content="noindex">' }),
      )
      expect(found).toContain('expected-indexable-blocked')
      expect(found).not.toContain('noindex')
    })

    it('says what keeps it from being indexed, all of it', async () => {
      await addRules([expecting(exactPath('/product'), 'indexable')])
      const { id } = await crawl({
        ...shop({
          '/product': page('/product', {
            head: '<meta name="robots" content="noindex">',
            canonical: `${SITE}/about`,
            links: '<a href="/">Back to the home page</a>',
          }),
        }),
        [`${SITE}/robots.txt`]: {
          statusCode: 200,
          headers: { 'content-type': 'text/plain' },
          body: Buffer.from('User-agent: *\nDisallow: /product'),
        },
      })
      const rows = await db.crawls.issuesOf(id, [hashOf('/product')])
      const blocked = rows.filter((row) => row.issue === 'expected-indexable-blocked')
      expect(blocked).toHaveLength(1)
      expect(blocked[0]!.details).toEqual(['noindex', 'canonical', 'robots'])
      // What each blocker already had a finding for is not said a second time.
      const found = rows.map((row) => row.issue)
      for (const repeated of ['noindex', 'canonicalised', 'robots-blocked'] as const) {
        expect(found).not.toContain(repeated)
      }
    })

    it('leaves an error response to the finding that already names it', async () => {
      const { found } = await only({ statusCode: 404, headers: { 'content-type': 'text/html' } })
      expect(found).toContain('client-error')
      expect(found).not.toContain('expected-indexable-blocked')
    })

    it('does not read a request that failed as being fine, or as a blocker', async () => {
      const { id, found } = await only(new FetchError('ECONNRESET', 'reset'))
      expect(found).toContain('no-response')
      expect(found).not.toContain('expected-indexable-blocked')
      expect(await stateOf(id, '/product')).toMatchObject({ indexability: 'unknown' })
    })
  })

  it('leaves the checks as they were when nothing is declared', async () => {
    const { id } = await crawl(
      shop({ '/product': page('/product', { head: '<meta name="robots" content="noindex">' }) }),
    )
    const found = await findings(id, '/product')
    expect(found).toContain('noindex')
    expect(found).not.toContain('expected-indexable-blocked')
    // Nothing declared: it is expected to be indexable, and says where that comes from.
    expect(await stateOf(id, '/product')).toMatchObject({
      intent: 'indexable',
      intentRule: null,
      conditions: {},
      indexability: 'not-indexable',
    })
  })

  it('can be declared against a broader rule, with an exception for one URL', async () => {
    await addRules([
      expecting(prefix('/'), 'not-indexable'),
      expecting(exactUrl('/product'), 'indexable'),
    ])
    const { id } = await crawl(
      shop({ '/product': page('/product', { head: '<meta name="robots" content="noindex">' }) }),
    )
    expect(await stateOf(id, '/product')).toMatchObject({ intent: 'indexable' })
    expect(await stateOf(id, '/about')).toMatchObject({ intent: 'not-indexable' })
    // The exception says it is expected to be indexable, and it is not: one finding that names why.
    expect(await findings(id, '/product')).toContain('expected-indexable-blocked')
    expect(await findings(id, '/product')).not.toContain('noindex')
    // Without the exception, the URL goes back to what the rule says, and noindex is expected.
    await db.audit.setUrlConfig({
      domainId,
      host: 'example.com',
      urls: [absolute('/product')],
      intent: 'inherit',
    })
    await recomputeAudit({ db, domainId, log, finalAttempt: false })
    expect(await stateOf(id, '/product')).toMatchObject({
      intent: 'not-indexable',
      intentRule: expect.any(String),
    })
    expect(await findings(id, '/product')).not.toContain('expected-indexable-blocked')
    expect(await findings(id, '/product')).not.toContain('noindex')
  })

  describe('and the URL is excluded', () => {
    it('has no finding for failing the expectation, and keeps it as information', async () => {
      await addRules([
        exclusion(exactPath('/cart')),
        expecting(exactPath('/cart'), 'not-indexable'),
        exclusion(exactPath('/product')),
        expecting(exactPath('/product'), 'indexable'),
      ])
      const { id } = await crawl(
        shop({
          // Expected not to be indexable and is; expected to be indexable and is not.
          '/cart': page('/cart'),
          '/product': page('/product', { head: '<meta name="robots" content="noindex">' }),
        }),
      )
      expect(await findings(id, '/cart')).toEqual([])
      expect(await findings(id, '/product')).toEqual([])
      expect(await stateOf(id, '/cart')).toMatchObject({
        participation: 'excluded',
        intent: 'not-indexable',
        indexability: 'indexable',
      })
      expect(await stateOf(id, '/product')).toMatchObject({
        participation: 'excluded',
        intent: 'indexable',
        indexability: 'not-indexable',
      })
    })

    it('is not excluded by declaring it expected not to be indexable', async () => {
      await addRules([expecting(exactPath('/cart'), 'not-indexable')])
      const { id } = await crawl(shop())
      expect(await stateOf(id, '/cart')).toMatchObject({ participation: 'audited' })
    })
  })
})

// --- exceptions --------------------------------------------------------------------------------------

describe('an exception to a rule', () => {
  it('includes a URL a rule excludes, and returns to the rule when it is removed', async () => {
    await addRules([exclusion(prefix('/cart'))])
    const first = await crawl(shop())
    expect(await stateOf(first.id, '/cart/checkout')).toMatchObject({ participation: 'excluded' })

    const set = await db.audit.setUrlConfig({
      domainId,
      host: 'example.com',
      urls: [absolute('/cart/checkout')],
      audit: 'include',
      reason: 'The checkout is part of the audit',
    })
    expect(set.ok).toBe(true)
    await recomputeAudit({ db, domainId, log, finalAttempt: false })
    expect(await stateOf(first.id, '/cart/checkout')).toMatchObject({
      participation: 'audited',
      participationRule: (await db.audit.config(domainId)).rules.find(
        (rule) => rule.selector.kind === 'url',
      )!.id,
    })
    expect(await stateOf(first.id, '/cart')).toMatchObject({ participation: 'excluded' })

    await db.audit.setUrlConfig({
      domainId,
      host: 'example.com',
      urls: [absolute('/cart/checkout')],
      audit: 'inherit',
      reason: null,
    })
    await recomputeAudit({ db, domainId, log, finalAttempt: false })
    expect(await stateOf(first.id, '/cart/checkout')).toMatchObject({
      participation: 'excluded',
      participationRule: expect.any(String),
    })
    expect((await db.crawls.get(first.id))!.pagesAudit).toMatchObject({ excluded: 2 })
  })
})

// --- persistence and recalculation -------------------------------------------------------------------

describe('the configuration across crawls', () => {
  it('persists between crawls and after the results of old ones are gone', async () => {
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      retainCrawls: 1,
    })
    await addRules([exclusion(prefix('/cart'))])
    const first = await crawl(shop())
    const second = await crawl(shop())
    expect((await db.crawls.get(first.id))!.pruned).toBe(true)
    expect(await db.crawls.auditOf(first.id, [hashOf('/cart')])).toEqual([])

    // The new crawl was analysed with the rules, and the rules are still there.
    expect(await stateOf(second.id, '/cart')).toMatchObject({ participation: 'excluded' })
    expect((await db.audit.config(domainId)).rules).toHaveLength(1)
    // The old crawl still says what it concluded and how.
    expect((await db.crawls.get(first.id))!.pagesAudit).toMatchObject({ excluded: 2 })
    expect((await db.crawls.get(first.id))!.auditSnapshot?.rules).toHaveLength(1)
  })

  it('keeps each domain apart', async () => {
    const other = await createCompany(db, { name: 'Other', domain: 'other.com' })
    if (!other.ok) throw new Error('setup failed')
    await addRules([exclusion(prefix('/cart'))], other.domain.id)
    const { id } = await crawl(shop())
    expect(await stateOf(id, '/cart')).toMatchObject({ participation: 'audited' })
    expect((await db.crawls.get(id))!.auditVersion).toBe(0)
    // Changing the other domain's rules does not ask for this one to be analysed again.
    await recomputeAudit({ db, domainId, log, finalAttempt: false })
    expect((await db.crawls.get(id))!.auditSnapshot).toEqual({
      version: 0,
      semantics: AUDIT_SEMANTICS,
      languages: NO_LANGUAGES,
      unobserved: [
        ...RENDER_DIFFERENCE_IDS,
        'cls-poor',
        'inp-poor',
        'lcp-poor',
        'linked-only-by-javascript',
        'links-only-after-rendering',
      ].sort(),
      rules: [],
    })
  })
})

describe('analysing again after the configuration changes', () => {
  it('makes no request, updates the totals, and says which version it used', async () => {
    const { id, requests } = await crawl(shop())
    const before = (await db.crawls.get(id))!
    expect(before.auditVersion).toBe(0)
    expect(before.pagesAudit).toMatchObject({ audited: before.pagesCount, excluded: 0 })
    const requested = [...requests]

    await addRules([exclusion(exactPath('/cart'))])
    const result = await recomputeAudit({ db, domainId, log, finalAttempt: false })
    expect(result).toEqual({ crawlId: id, version: 1, analysed: 1 })

    const after = (await db.crawls.get(id))!
    expect(after.auditVersion).toBe(1)
    expect(after.pagesAudit).toMatchObject({ audited: before.pagesCount - 1, excluded: 1 })
    expect(before.pagesWithType!.warning).toBe(1)
    expect(after.pagesWithType).toEqual({ issue: 0, warning: 0, opportunity: 4 })
    expect(await findings(id, '/cart')).toEqual([])
    expect(requests).toEqual(requested)
    // The data is the crawl's own, untouched.
    expect(await stored(id, '/cart')).toMatchObject({ statusCode: 200, title: null })
  })

  it('does nothing when the crawl already has the current configuration', async () => {
    const { id } = await crawl(shop())
    expect(await recomputeAudit({ db, domainId, log, finalAttempt: false })).toMatchObject({
      crawlId: id,
      analysed: 0,
    })
    await addRules([exclusion(exactPath('/cart'))])
    expect((await recomputeAudit({ db, domainId, log, finalAttempt: false })).analysed).toBe(1)
    // A second job for the same change, as after a crash or a retry, changes nothing.
    const stable = (await db.crawls.get(id))!
    expect((await recomputeAudit({ db, domainId, log, finalAttempt: false })).analysed).toBe(0)
    expect(await db.crawls.get(id)).toEqual(stable)
  })

  it('leaves the analyses of older crawls as they were', async () => {
    const older = await crawl(shop())
    const newer = await crawl(shop())
    const olderBefore = (await db.crawls.get(older.id))!
    await addRules([exclusion(exactPath('/cart'))])
    await recomputeAudit({ db, domainId, log, finalAttempt: false })
    expect((await db.crawls.get(newer.id))!.pagesAudit).toMatchObject({ excluded: 1 })
    expect(await db.crawls.get(older.id)).toEqual(olderBefore)
    expect(await findings(older.id, '/cart')).toEqual(expect.arrayContaining(CART_PROBLEMS))
  })

  it('applies to the next crawl when there is none yet', async () => {
    await addRules([exclusion(exactPath('/cart'))])
    expect(await recomputeAudit({ db, domainId, log, finalAttempt: false })).toEqual({
      crawlId: null,
      version: 1,
      analysed: 0,
    })
    const { id } = await crawl(shop())
    expect(await stateOf(id, '/cart')).toMatchObject({ participation: 'excluded' })
    expect((await db.crawls.get(id))!.auditVersion).toBe(1)
  })

  it('is asked for by the change itself, once, for the domain that changed', async () => {
    const { id } = await crawl(shop())
    await addRules([exclusion(exactPath('/cart'))])
    await addRules([exclusion(exactPath('/about'))])
    const jobs = (await db.jobs.list({ status: 'pending', limit: 50 })).filter(
      (job) => job.type === 'audit.recompute',
    )
    expect(jobs.map((job) => job.payload)).toEqual([{ domainId }])
    // Until it runs, the crawl is behind the configuration, which is what the pages say.
    expect((await db.crawls.get(id))!.auditVersion).toBe(0)
    expect((await db.audit.config(domainId)).version).toBe(2)
  })

  describe('when the configuration changes while it runs', () => {
    /** The database, with something to do just before an analysis is saved. */
    function withHook(before: () => Promise<void>): Database {
      let first = true
      return new Proxy(db, {
        get(target, key, receiver) {
          if (key !== 'crawls') return Reflect.get(target, key, receiver)
          return new Proxy(target.crawls, {
            get(crawls, name, receiver2) {
              if (name !== 'saveAnalysis') return Reflect.get(crawls, name, receiver2)
              return async (input: Parameters<Database['crawls']['saveAnalysis']>[0]) => {
                if (first) {
                  first = false
                  await before()
                }
                return crawls.saveAnalysis(input)
              }
            },
          })
        },
      })
    }

    it('analyses again with the newest, so the crawl never ends up behind', async () => {
      const { id } = await crawl(shop())
      await addRules([exclusion(exactPath('/cart'))])
      const racing = withHook(async () => {
        await addRules([exclusion(exactPath('/about'))])
      })
      const result = await recomputeAudit({ db: racing, domainId, log, finalAttempt: false })

      expect(result).toMatchObject({ crawlId: id, version: 2, analysed: 2 })
      const after = (await db.crawls.get(id))!
      expect(after.auditVersion).toBe(2)
      expect(after.pagesAudit).toMatchObject({ audited: after.pagesCount - 2, excluded: 2 })
      expect(await stateOf(id, '/about')).toMatchObject({ participation: 'excluded' })
    })

    it('never lets a slow analysis with the old version overwrite the newer one', async () => {
      const { id } = await crawl(shop())
      await addRules([exclusion(exactPath('/cart'))])
      const old = auditSnapshotOf(1, (await db.audit.config(domainId)).rules)
      await addRules([exclusion(exactPath('/about'))])
      const current = auditSnapshotOf(2, (await db.audit.config(domainId)).rules)

      // The old one is slow: the newer analysis is saved before it gets to save.
      const slow = withHook(async () => {
        await analyseCrawl(db, id, current)
      })
      const late = await analyseCrawl(slow, id, old)
      expect(late.saved).toBe(false)

      const after = (await db.crawls.get(id))!
      expect(after.auditVersion).toBe(2)
      expect(after.auditSnapshot?.version).toBe(2)
      expect(after.pagesAudit).toMatchObject({ excluded: 2 })
      expect(await stateOf(id, '/about')).toMatchObject({ participation: 'excluded' })
    })

    it('ends with the newest when analyses with several versions race', async () => {
      const { id } = await crawl(shop())
      await addRules([exclusion(exactPath('/cart'))])
      const v1 = auditSnapshotOf(1, (await db.audit.config(domainId)).rules)
      await addRules([exclusion(exactPath('/about'))])
      const v2 = auditSnapshotOf(2, (await db.audit.config(domainId)).rules)
      await Promise.all([
        analyseCrawl(db, id, v1),
        analyseCrawl(db, id, v2),
        analyseCrawl(db, id, v1),
        analyseCrawl(db, id, v2),
      ])
      expect((await db.crawls.get(id))!.auditVersion).toBe(2)
      expect((await db.crawls.get(id))!.pagesAudit).toMatchObject({ excluded: 2 })
    })
  })

  describe('when it fails', () => {
    function failing(times: { value: number }): Database {
      return new Proxy(db, {
        get(target, key, receiver) {
          if (key !== 'crawls') return Reflect.get(target, key, receiver)
          return new Proxy(target.crawls, {
            get(crawls, name, receiver2) {
              if (name !== 'saveAnalysis') return Reflect.get(crawls, name, receiver2)
              return async (input: Parameters<Database['crawls']['saveAnalysis']>[0]) => {
                if (times.value-- > 0) throw new Error('database went away')
                return crawls.saveAnalysis(input)
              }
            },
          })
        },
      })
    }

    it('records the failure only when no attempt is left, and a retry succeeds and clears it', async () => {
      const { id } = await crawl(shop())
      await addRules([exclusion(exactPath('/cart'))])
      const times = { value: 2 }
      const flaky = failing(times)

      await expect(
        recomputeAudit({ db: flaky, domainId, log, finalAttempt: false }),
      ).rejects.toThrow('database went away')
      // The queue will try again, and nobody is told yet.
      expect((await db.audit.config(domainId)).recomputeError).toBeNull()
      expect((await db.crawls.get(id))!.auditVersion).toBe(0)

      await expect(
        recomputeAudit({ db: flaky, domainId, log, finalAttempt: true }),
      ).rejects.toThrow('database went away')
      expect((await db.audit.config(domainId)).recomputeError).toEqual({
        message: 'database went away',
        version: 1,
      })

      // Asking again, from the settings, runs it and forgets the failure.
      await db.audit.retryRecompute(domainId)
      expect(await recomputeAudit({ db: flaky, domainId, log, finalAttempt: false })).toMatchObject(
        {
          analysed: 1,
        },
      )
      expect((await db.audit.config(domainId)).recomputeError).toBeNull()
      expect((await db.crawls.get(id))!.auditVersion).toBe(1)
    })
  })
})

describe('the catalog changing', () => {
  it('analyses the history with the configuration each crawl had, not the current one', async () => {
    const older = await crawl(shop())
    const newer = await crawl(shop())
    await addRules([exclusion(exactPath('/cart'))])
    await recomputeAudit({ db, domainId, log, finalAttempt: false })
    expect((await db.crawls.get(newer.id))!.pagesAudit).toMatchObject({ excluded: 1 })

    // Both crawls were analysed with another version of the issue catalog.
    const stale = async (crawlId: string) => {
      const row = (await db.crawls.get(crawlId))!
      await db.crawls.saveAnalysis({
        crawlId,
        issues: [],
        pages: { issue: 99, warning: 0, opportunity: 0 },
        withType: { issue: 99, warning: 0, opportunity: 0 },
        catalog: 'old',
        audit: {
          snapshot: row.auditSnapshot ?? EMPTY_AUDIT_SNAPSHOT,
          pages: row.pagesAudit!,
          urls: [],
        },
      })
    }
    await stale(older.id)
    await stale(newer.id)
    // Then the cart rule is deleted: the current configuration is no longer what either used.
    const [rule] = (await db.audit.config(domainId)).rules
    await db.audit.deleteRule({ domainId, id: rule!.id })

    expect(await reanalyseOutdatedCrawls({ db, log })).toBe(2)

    const olderAfter = (await db.crawls.get(older.id))!
    const newerAfter = (await db.crawls.get(newer.id))!
    expect(olderAfter.issueCatalog).toBe(ISSUE_CATALOG_VERSION)
    expect(newerAfter.issueCatalog).toBe(ISSUE_CATALOG_VERSION)
    // The older one never had rules, and is not given today's; the newer one keeps what it had.
    expect(olderAfter.auditVersion).toBe(0)
    expect(olderAfter.pagesAudit).toMatchObject({ excluded: 0 })
    expect(await findings(older.id, '/cart')).toEqual(expect.arrayContaining(CART_PROBLEMS))
    expect(newerAfter.auditVersion).toBe(1)
    expect(newerAfter.pagesAudit).toMatchObject({ excluded: 1 })
    expect(await findings(newer.id, '/cart')).toEqual([])
    // The newer one is behind the configuration, which is now at version 2.
    expect((await db.audit.config(domainId)).version).toBe(2)
  })

  it('computes the new figures of a crawl from before them when its results are kept', async () => {
    const { id } = await crawl(shop())
    // What a crawl analysed before audit configuration existed looks like.
    await db.crawls.saveAnalysis({
      crawlId: id,
      issues: [],
      pages: { issue: 0, warning: 1, opportunity: 0 },
      withType: { issue: 0, warning: 1, opportunity: 0 },
      catalog: 'old',
      audit: {
        snapshot: EMPTY_AUDIT_SNAPSHOT,
        pages: { audited: 0, excluded: 0, indexable: 0, notIndexable: 0, unknownIndexability: 0 },
        urls: [],
      },
    })
    expect(await reanalyseOutdatedCrawls({ db, log })).toBe(1)
    const after = (await db.crawls.get(id))!
    expect(after.pagesAudit).toMatchObject({
      audited: after.pagesCount,
      indexable: 5,
      notIndexable: 0,
    })
  })
})

describe('the current configuration', () => {
  it('is read whole: its version is the one of the rules in it', async () => {
    await addRules([exclusion(exactPath('/cart')), exclusion(exactPath('/about'))])
    const snapshot = await currentAuditConfig(db, domainId)
    expect(snapshot.version).toBe(2)
    expect(snapshot.rules).toHaveLength(2)
    expect(snapshot.rules.every((rule) => rule.enabled)).toBe(true)
  })

  it('leaves out the rules that are switched off', async () => {
    const [id] = await addRules([exclusion(exactPath('/cart'))])
    await db.audit.setRuleEnabled({ domainId, id: id!, enabled: false })
    const snapshot = await currentAuditConfig(db, domainId)
    expect(snapshot).toEqual({
      version: 2,
      semantics: AUDIT_SEMANTICS,
      languages: NO_LANGUAGES,
      rules: [],
    })
    const { id: crawlId } = await crawl(shop())
    expect(await stateOf(crawlId, '/cart')).toMatchObject({ participation: 'audited' })
  })
})

// --- the default expectation -------------------------------------------------------------------------

describe('what is expected of a URL when nothing is declared', () => {
  const ROBOTS_BLOCKING_IMAGES = {
    statusCode: 200,
    headers: { 'content-type': 'text/plain' },
    body: Buffer.from('User-agent: *\nDisallow: /img/'),
  }
  /** A shop with an image robots.txt blocks, a stylesheet, and a redirect: none of them is a page. */
  const withAuxiliaryFiles = () => ({
    ...shop({
      '/': page('/', {
        links:
          '<a href="/about">About us</a><a href="/product">The product</a><a href="/cart">Your cart</a><a href="/old">Old</a>',
        head: '<link rel="stylesheet" href="/site.css">',
        body: '<img src="/img/logo.png" alt="Logo" width="10" height="10">',
      }),
      '/old': moved('/product'),
    }),
    [`${SITE}/img/logo.png`]: {
      statusCode: 200,
      headers: { 'content-type': 'image/png' },
      body: Buffer.from('png'),
    },
    [`${SITE}/site.css`]: {
      statusCode: 200,
      headers: { 'content-type': 'text/css' },
      body: Buffer.from('body { color: black }'),
    },
    [`${SITE}/robots.txt`]: ROBOTS_BLOCKING_IMAGES,
  })

  it('is that it can be indexed, saying where it comes from', async () => {
    const { id } = await crawl(shop())
    expect(await stateOf(id, '/about')).toMatchObject({
      intent: 'indexable',
      intentRule: null,
      participation: 'audited',
    })
  })

  it('raises no new finding for images, stylesheets, redirects or what the crawler only tried', async () => {
    const { id } = await crawl(withAuxiliaryFiles())
    // The image is blocked by robots.txt, and that is its own finding: nothing about its expectation.
    expect(await stateOf(id, '/img/logo.png')).toMatchObject({
      indexability: 'not-indexable',
      blockers: ['robots'],
    })
    const expected = (await db.crawls.issueCounts(id)).filter((row) =>
      row.issue.startsWith('expected-'),
    )
    expect(expected).toEqual([])
    for (const path of ['/img/logo.png', '/site.css', '/old', 'http://example.com/']) {
      expect(await findings(id, path)).not.toContain('expected-indexable-blocked')
    }
  })

  it('does not judge them either when the user states the expectation for everything', async () => {
    await addRules([expecting(prefix('/'), 'indexable')])
    const { id } = await crawl(withAuxiliaryFiles())
    for (const path of ['/img/logo.png', '/site.css', '/old']) {
      expect(await findings(id, path)).not.toContain('expected-indexable-blocked')
      expect(await stateOf(id, path)).toMatchObject({
        intent: 'indexable',
        intentRule: expect.any(String),
      })
    }
    expect(
      (await db.crawls.issueCounts(id)).filter((row) => row.issue.startsWith('expected-')),
    ).toEqual([])
  })

  it('does not judge the URLs the crawler tried on its own, even with a rule that covers them', async () => {
    await addRules([expecting(prefix('/'), 'not-indexable')])
    const { id } = await crawl({
      ...shop(),
      // The http variant of the home page answers, and nothing links to it.
      'http://example.com/': page('http://example.com/'),
    })
    expect(await findings(id, 'http://example.com/')).not.toContain(
      'expected-not-indexable-but-indexable',
    )
    expect(await findings(id, '/about')).toContain('expected-not-indexable-but-indexable')
  })

  it('leaves the generic findings of a page that cannot be indexed, one for each cause', async () => {
    const { id } = await crawl({
      ...shop({
        '/product': page('/product', {
          head: '<meta name="robots" content="noindex">',
          canonical: `${SITE}/about`,
        }),
      }),
    })
    const found = await findings(id, '/product')
    expect(found).toContain('noindex')
    // A canonical elsewhere is a state of the URL (its indexability says so), not a finding.
    expect(found).not.toContain('expected-indexable-blocked')
    expect(found.filter((issue) => issue === 'noindex')).toHaveLength(1)
  })

  it('is the expectation of a request that failed, with nothing known of whether it is met', async () => {
    const { id } = await crawl(shop({ '/product': new FetchError('ECONNRESET', 'reset') }))
    expect(await stateOf(id, '/product')).toMatchObject({
      intent: 'indexable',
      indexability: 'unknown',
    })
    expect(
      (await findings(id, '/product')).filter((issue) => issue.startsWith('expected-')),
    ).toEqual([])
  })
})

// --- nofollow ------------------------------------------------------------------------------------------

describe('a page that allows its own nofollow', () => {
  const robots = (content: string) => `<meta name="robots" content="${content}">`
  const product = (content: string, headers: Record<string, string> = {}) =>
    shop({ '/product': page('/product', { head: robots(content), headers }) })
  const allowing = (path = '/product') => asking(exactPath(path), 'nofollow', 'allowed')

  it('raises a finding for it, and is not made less indexable by it', async () => {
    const { id } = await crawl(product('nofollow'))
    expect(await findings(id, '/product')).toContain('nofollow')
    expect(await stateOf(id, '/product')).toMatchObject({
      indexability: 'indexable',
      blockers: [],
      conditions: {},
    })
  })

  it('stops raising it once a rule allows it, without changing how indexable the page is', async () => {
    await addRules([allowing()])
    const { id, requests } = await crawl(
      shop({
        '/product': page('/product', {
          head: robots('nofollow'),
          links: '<a href="/">Back to the home page</a><a href="/only-from-product">More</a>',
        }),
        '/only-from-product': page('/only-from-product'),
      }),
    )
    expect(await findings(id, '/product')).not.toContain('nofollow')
    expect(await stateOf(id, '/product')).toMatchObject({
      indexability: 'indexable',
      blockers: [],
      conditions: { nofollow: { requirement: 'allowed', observed: 'present' } },
    })
    // The crawler is the same: what the page links to was found and requested all the same.
    expect(requests).toContain(absolute('/only-from-product'))
    expect(await stored(id, '/only-from-product')).toMatchObject({ kind: 'page', state: 'done' })
  })

  it('does not need a nofollow to be there', async () => {
    await addRules([allowing()])
    const { id } = await crawl(shop())
    expect(await findings(id, '/product')).toEqual(['few-html-links'])
    expect(await stateOf(id, '/product')).toMatchObject({
      conditions: { nofollow: { requirement: 'allowed', observed: 'absent' } },
    })
  })

  it('is not allowed by expecting a page not to be indexable', async () => {
    await addRules([expecting(exactPath('/product'), 'not-indexable')])
    const { id } = await crawl(product('noindex, nofollow'))
    const found = await findings(id, '/product')
    // The noindex is what was expected; the nofollow was not said to be fine.
    expect(found).not.toContain('noindex')
    expect(found).toContain('nofollow')
    expect(found).not.toContain('expected-not-indexable-but-indexable')
  })

  it('goes with an expectation of not being indexable too, each by its own rule', async () => {
    await addRules([expecting(exactPath('/product'), 'not-indexable'), allowing()])
    const { id } = await crawl(product('noindex, nofollow'))
    const found = await findings(id, '/product')
    expect(found).not.toContain('noindex')
    expect(found).not.toContain('nofollow')
    expect(found).not.toContain('expected-not-indexable-but-indexable')
  })

  it('does not meet an expectation of not being indexable, a nofollow alone', async () => {
    await addRules([expecting(exactPath('/product'), 'not-indexable')])
    const { id } = await crawl(product('nofollow'))
    const found = await findings(id, '/product')
    expect(found).toContain('expected-not-indexable-but-indexable')
    expect(found).toContain('nofollow')
    expect(await stateOf(id, '/product')).toMatchObject({ indexability: 'indexable' })

    // Allowing the nofollow does not meet it either: it only stops the finding for the nofollow.
    await db.audit.saveRule({ domainId, rule: allowing() })
    await recomputeAudit({ db, domainId, log, finalAttempt: false })
    const after = await findings(id, '/product')
    expect(after).toContain('expected-not-indexable-but-indexable')
    expect(after).not.toContain('nofollow')
  })

  it('is allowed by an exception on the URL that leaves the expectation to the rules', async () => {
    // The rules expect the whole site not to be indexed; this page also has a nofollow.
    await addRules([expecting(prefix('/'), 'not-indexable')])
    const { id } = await crawl(product('noindex, nofollow'))
    expect(await findings(id, '/product')).toContain('nofollow')
    // Only the nofollow is said for the URL, through the same call the dialog uses.
    const changed = await db.audit.setUrlConfig({
      domainId,
      host: 'example.com',
      urls: [`${SITE}/product`],
      conditions: { nofollow: 'allowed' },
    })
    expect(changed).toMatchObject({ ok: true })
    await recomputeAudit({ db, domainId, log, finalAttempt: false })
    const found = await findings(id, '/product')
    expect(found).not.toContain('nofollow')
    // The expectation is still the rules': the noindex is what they expect, and it is met.
    expect(found).not.toContain('noindex')
    expect(found).not.toContain('expected-not-indexable-but-indexable')
    expect(await stateOf(id, '/product')).toMatchObject({
      intent: 'not-indexable',
      conditions: { nofollow: { requirement: 'allowed' } },
    })
  })

  it('reads `none` as a noindex and a nofollow, and keeps their consequences apart', async () => {
    const { id } = await crawl(product('none'))
    const found = await findings(id, '/product')
    expect(found).toContain('noindex')
    expect(found).toContain('nofollow')
    expect(await stateOf(id, '/product')).toMatchObject({
      indexability: 'not-indexable',
      blockers: ['noindex'],
    })

    // Allowing the nofollow of a page expected to be indexable: the noindex is still the problem.
    await addRules([expecting(exactPath('/product'), 'indexable'), allowing()])
    await recomputeAudit({ db, domainId, log, finalAttempt: false })
    const after = await findings(id, '/product')
    expect(after).toContain('expected-indexable-blocked')
    expect(after).not.toContain('noindex')
    expect(after).not.toContain('nofollow')
  })

  it('keeps a noindex a page is expected to be indexable with, whatever nofollow is allowed', async () => {
    await addRules([expecting(exactPath('/product'), 'indexable'), allowing()])
    const { id } = await crawl(product('noindex, nofollow'))
    const rows = await db.crawls.issuesOf(id, [hashOf('/product')])
    expect(rows.find((row) => row.issue === 'expected-indexable-blocked')?.details).toEqual([
      'noindex',
    ])
  })

  it('does not hide a conflict of directives', async () => {
    await addRules([allowing()])
    const { id } = await crawl(product('nofollow, follow'))
    const found = await findings(id, '/product')
    expect(found).toContain('directives-conflict')
    expect(found).not.toContain('nofollow')

    const second = await crawl(product('noindex, index, nofollow'))
    expect(await findings(second.id, '/product')).toContain('directives-conflict')
  })

  it('does not touch a link marked nofollow, or what other pages say', async () => {
    await addRules([allowing()])
    const { id } = await crawl(
      shop({
        '/': page('/', {
          head: robots('nofollow'),
          links:
            '<a href="/about">About us</a><a rel="nofollow" href="/product">The product</a><a href="/cart">Your cart</a>',
        }),
        '/product': page('/product', {
          head: robots('nofollow'),
          links: '<a href="/">Back</a><a rel="nofollow" href="/about">About us</a>',
        }),
      }),
    )
    // Its own links with rel="nofollow" are another finding, and the home page is another page.
    expect(await findings(id, '/product')).toContain('internal-nofollow-links')
    expect(await findings(id, '/product')).not.toContain('nofollow')
    expect(await findings(id, '/')).toContain('nofollow')
  })

  it('reads the directives of a header, and only those meant for the bot it follows', async () => {
    const forAll = await crawl(product('index', { 'x-robots-tag': 'nofollow' }))
    expect(await findings(forAll.id, '/product')).toContain('nofollow')
    await addRules([allowing()])
    await recomputeAudit({ db, domainId, log, finalAttempt: false })
    expect(await findings(forAll.id, '/product')).not.toContain('nofollow')

    // What is meant for another bot is not this page's nofollow, so there is nothing to allow.
    const other = await crawl(product('index', { 'x-robots-tag': 'bingbot: nofollow' }))
    expect(await findings(other.id, '/product')).not.toContain('nofollow')
    const forGoogle = await crawl(
      shop({
        '/product': page('/product', { head: '<meta name="googlebot" content="nofollow">' }),
      }),
    )
    expect(await findings(forGoogle.id, '/product')).not.toContain('nofollow')
    expect(await stateOf(forGoogle.id, '/product')).toMatchObject({
      conditions: { nofollow: { requirement: 'allowed', observed: 'present' } },
    })
  })

  it('leaves an excluded page without findings, as ever', async () => {
    await addRules([allowing(), exclusion(exactPath('/product'))])
    const { id } = await crawl(product('noindex, nofollow'))
    expect(await findings(id, '/product')).toEqual([])
    expect(await stateOf(id, '/product')).toMatchObject({
      participation: 'excluded',
      conditions: { nofollow: { requirement: 'allowed' } },
    })
  })

  it('is what the most specific rule decides', async () => {
    await addRules([
      asking(prefix('/'), 'nofollow', 'allowed'),
      asking(exactUrl('/product'), 'nofollow', 'forbidden'),
    ])
    const { id } = await crawl(product('nofollow'))
    expect(await findings(id, '/product')).toContain('nofollow')
    expect(await findings(id, '/about')).not.toContain('nofollow')
  })
})

// --- rules shared between language directories ------------------------------------------------------

describe('a rule shared between language directories', () => {
  const LANGS = { prefixes: ['/ca', '/en', '/es'], unprefixed: true }
  const CART_PATHS = [
    '/cart',
    '/es/cart',
    '/en/cart',
    '/ca/cart',
    '/fr/cart',
    '/es/cartoon',
    '/shop/es/cart',
    '/es/carrito',
    '/es/account/orders',
    '/en/account',
  ]
  /** A site in several languages, whose cart pages all have a problem of their own. */
  const multilingual = () => {
    const pages: Record<string, Answer> = {
      '/': page('/', {
        links: CART_PATHS.map((path) => `<a href="${path}">A link to ${path}</a>`).join(''),
      }),
    }
    for (const path of CART_PATHS)
      pages[path] = page(path, { title: null, links: '<a href="/">Home</a>' })
    const site: Record<string, Answer> = {
      [`${SITE}/sitemap.xml`]: xml(sitemapOf(Object.keys(pages))),
    }
    for (const [path, answer] of Object.entries(pages)) site[absolute(path)] = answer
    return site
  }
  const excluded = async (crawlId: string) =>
    (
      await Promise.all(
        CART_PATHS.map(async (path) => ({
          path,
          excluded: (await stateOf(crawlId, path))?.participation === 'excluded',
        })),
      )
    )
      .filter((row) => row.excluded)
      .map((row) => row.path)
      .sort()

  it('covers the path in every declared directory, and with none', async () => {
    await db.audit.setLanguages({ domainId, languages: LANGS })
    await addRules([exclusion(sharedPath('/cart'))])
    const { id } = await crawl(multilingual())
    expect(await excluded(id)).toEqual(['/ca/cart', '/cart', '/en/cart', '/es/cart'])
    // What it did not cover has the problem it had, and nothing was said about the rest.
    expect(await findings(id, '/fr/cart')).toContain('title-missing')
    expect(await findings(id, '/es/cartoon')).toContain('title-missing')
    expect(await findings(id, '/shop/es/cart')).toContain('title-missing')
    expect(await findings(id, '/es/cart')).toEqual([])
  })

  it('does not look at the root unless the domain has pages without a directory', async () => {
    await db.audit.setLanguages({ domainId, languages: { ...LANGS, unprefixed: false } })
    await addRules([exclusion(sharedPath('/cart'))])
    const { id } = await crawl(multilingual())
    expect(await excluded(id)).toEqual(['/ca/cart', '/en/cart', '/es/cart'])
  })

  it('covers nothing until the domain declares its languages', async () => {
    await addRules([exclusion(sharedPath('/cart'))])
    const { id } = await crawl(multilingual())
    expect(await excluded(id)).toEqual([])
  })

  it('covers a prefix in every directory, by segments', async () => {
    await db.audit.setLanguages({ domainId, languages: LANGS })
    await addRules([exclusion(prefix('/account', 'any', 'shared'))])
    const { id } = await crawl(multilingual())
    expect(await excluded(id)).toEqual(['/en/account', '/es/account/orders'])
  })

  it('does not translate slugs: each language needs its own rule', async () => {
    await db.audit.setLanguages({ domainId, languages: LANGS })
    await addRules([exclusion(sharedPath('/carrito'))])
    const { id } = await crawl(multilingual())
    expect(await excluded(id)).toEqual(['/es/carrito'])
  })

  it('lets a literal exception for one language beat the shared rule', async () => {
    await db.audit.setLanguages({ domainId, languages: LANGS })
    const [general] = await addRules([exclusion(sharedPath('/cart'))])
    const [exception] = await addRules([exclusion(exactPath('/es/cart'), 'include')])
    const { id } = await crawl(multilingual())
    expect(await excluded(id)).toEqual(['/ca/cart', '/cart', '/en/cart'])
    expect(await stateOf(id, '/es/cart')).toMatchObject({
      participation: 'audited',
      participationRule: exception,
    })
    expect(await stateOf(id, '/en/cart')).toMatchObject({ participationRule: general })
  })

  it('never changes the URLs: the crawl, their identity and what it found are the same', async () => {
    const plain = await crawl(multilingual())
    await db.audit.setLanguages({ domainId, languages: LANGS })
    await addRules([exclusion(sharedPath('/cart'))])
    const shared = await crawl(multilingual())
    const urls = async (crawlId: string) =>
      (await db.crawls.listUrls({ crawlId, view: 'pages', limit: 1000, offset: 0 }))
        .map((row) => `${row.urlHash} ${row.url} ${row.statusCode}`)
        .sort()
    expect(await urls(shared.id)).toEqual(await urls(plain.id))
    expect(shared.requests.sort()).toEqual(plain.requests.sort())
  })

  it('is kept with the analysis, and not applied to one made before the languages', async () => {
    await addRules([exclusion(sharedPath('/cart'))])
    const before = await crawl(multilingual())
    expect(await excluded(before.id)).toEqual([])
    expect((await db.crawls.get(before.id))!.auditSnapshot?.languages).toEqual(NO_LANGUAGES)

    await db.audit.setLanguages({ domainId, languages: LANGS })
    const after = await crawl(multilingual())
    expect(await excluded(after.id)).toEqual(['/ca/cart', '/cart', '/en/cart', '/es/cart'])
    expect((await db.crawls.get(after.id))!.auditSnapshot?.languages).toEqual(LANGS)

    // Analysing the older crawl again for a new catalog gives it what it had, not today's languages.
    await db.crawls.saveAnalysis({
      crawlId: before.id,
      issues: [],
      pages: { issue: 0, warning: 0, opportunity: 0 },
      withType: { issue: 0, warning: 0, opportunity: 0 },
      catalog: 'old',
      audit: {
        snapshot: (await db.crawls.get(before.id))!.auditSnapshot!,
        pages: { audited: 0, excluded: 0, indexable: 0, notIndexable: 0, unknownIndexability: 0 },
        urls: [],
      },
    })
    expect(await reanalyseOutdatedCrawls({ db, log })).toBe(1)
    expect(await excluded(before.id)).toEqual([])
  })

  it('asks for the latest crawl to be analysed again when the languages change, with no requests', async () => {
    await addRules([exclusion(sharedPath('/cart'))])
    const { id, requests } = await crawl(multilingual())
    const requested = [...requests]
    expect(await excluded(id)).toEqual([])
    await db.audit.setLanguages({ domainId, languages: LANGS })
    expect((await db.crawls.get(id))!.auditVersion).toBe(1)
    expect(await recomputeAudit({ db, domainId, log, finalAttempt: false })).toMatchObject({
      crawlId: id,
      version: 2,
      analysed: 1,
    })
    expect(await excluded(id)).toEqual(['/ca/cart', '/cart', '/en/cart', '/es/cart'])
    expect(requests).toEqual(requested)
    expect((await db.crawls.get(id))!.auditVersion).toBe(2)
  })

  it('does not reach another domain', async () => {
    const other = await createCompany(db, { name: 'Other', domain: 'other.com' })
    if (!other.ok) throw new Error('setup failed')
    await db.audit.setLanguages({ domainId: other.domain.id, languages: LANGS })
    await addRules([exclusion(sharedPath('/cart'))], other.domain.id)
    const { id } = await crawl(multilingual())
    expect(await excluded(id)).toEqual([])
  })
})

// --- what an analysis made before the second semantics means ---------------------------------------

describe('an analysis made before the default expectation', () => {
  it('is analysed again as it was made: nothing was expected of what no rule covered', async () => {
    const { id } = await crawl(shop())
    expect(await stateOf(id, '/about')).toMatchObject({ intent: 'indexable' })

    // What a crawl analysed before configuration had a meaning looks like.
    await db.crawls.saveAnalysis({
      crawlId: id,
      issues: [],
      pages: { issue: 0, warning: 0, opportunity: 0 },
      withType: { issue: 0, warning: 0, opportunity: 0 },
      catalog: 'old',
      audit: {
        snapshot: EMPTY_AUDIT_SNAPSHOT,
        pages: { audited: 0, excluded: 0, indexable: 0, notIndexable: 0, unknownIndexability: 0 },
        urls: [],
      },
    })
    expect(await reanalyseOutdatedCrawls({ db, log })).toBe(1)
    const stored = (await db.crawls.get(id))!
    expect(stored.auditSnapshot?.semantics).toBeUndefined()
    expect(await stateOf(id, '/about')).toMatchObject({ intent: 'none', intentRule: null })
    // The latest crawl is behind the meaning of today, which only a recalculation brings.
    expect(stored.auditVersion).toBe(0)
  })

  it('keeps a rule of `none` working as it did, for that analysis only', async () => {
    const { id } = await crawl(shop())
    const legacy = {
      version: 3,
      rules: [
        {
          id: 'legacy-blog',
          dimension: 'intent',
          value: 'indexable',
          selector: { kind: 'prefix', path: '/about', query: { mode: 'any' }, scope: 'literal' },
          acceptNofollow: false,
          reason: null,
          enabled: true,
        },
        {
          id: 'legacy-none',
          dimension: 'intent',
          value: 'none',
          selector: { kind: 'url', url: absolute('/product') },
          acceptNofollow: false,
          reason: null,
          enabled: true,
        },
      ],
    } as never
    await db.crawls.saveAnalysis({
      crawlId: id,
      issues: [],
      pages: { issue: 0, warning: 0, opportunity: 0 },
      withType: { issue: 0, warning: 0, opportunity: 0 },
      catalog: 'old',
      audit: {
        snapshot: legacy,
        pages: { audited: 0, excluded: 0, indexable: 0, notIndexable: 0, unknownIndexability: 0 },
        urls: [],
      },
    })
    expect(await reanalyseOutdatedCrawls({ db, log })).toBe(1)
    expect(await stateOf(id, '/about')).toMatchObject({
      intent: 'indexable',
      intentRule: 'legacy-blog',
    })
    expect(await stateOf(id, '/product')).toMatchObject({
      intent: 'none',
      intentRule: 'legacy-none',
    })
    expect((await db.crawls.get(id))!.auditVersion).toBe(3)
  })

  it('is brought to the new meaning by the recalculation the upgrade asks for', async () => {
    const { id } = await crawl(shop())
    await db.crawls.saveAnalysis({
      crawlId: id,
      issues: [],
      pages: { issue: 0, warning: 0, opportunity: 0 },
      withType: { issue: 0, warning: 0, opportunity: 0 },
      catalog: ISSUE_CATALOG_VERSION,
      audit: {
        snapshot: EMPTY_AUDIT_SNAPSHOT,
        pages: { audited: 0, excluded: 0, indexable: 0, notIndexable: 0, unknownIndexability: 0 },
        urls: [],
      },
    })
    // The upgrade moves the version of a domain with a crawl, which is what makes it behind.
    await db.settings.delete('audit.semantics')
    await db.migrate()
    expect((await db.audit.config(domainId)).version).toBe(1)
    expect(await recomputeAudit({ db, domainId, log, finalAttempt: false })).toMatchObject({
      analysed: 1,
    })
    expect(await stateOf(id, '/about')).toMatchObject({ intent: 'indexable' })
    expect((await db.crawls.get(id))!.auditSnapshot?.semantics).toBe(AUDIT_SEMANTICS)
  })
})

describe('recomputeAudit for a domain that was deleted', () => {
  it('finds nothing to do instead of failing', async () => {
    await db.domains.delete(domainId)
    await expect(recomputeAudit({ db, domainId, log, finalAttempt: true })).resolves.toEqual({
      crawlId: null,
      version: 0,
      analysed: 0,
    })
  })
})
