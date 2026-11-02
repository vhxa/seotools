import {
  auditSnapshotOf,
  compileAuditSnapshot,
  crawlUrlHash,
  type LanguageConfig,
  type NewAuditRule,
} from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { previewRule } from './audit-preview'

const SITE = 'https://acme.com'

let db: Database
let domainId: string

beforeEach(async () => {
  db = await createTestDatabase()
  const created = await createCompany(db, { name: 'Acme', domain: 'acme.com' })
  if (!created.ok) throw new Error('setup failed')
  domainId = created.domain.id
})
afterEach(async () => {
  await db.close()
})

const rule = (
  path: string,
  value: 'exclude' | 'include' = 'exclude',
  query: { mode: 'any' } | { mode: 'exact'; value: string } = { mode: 'any' },
  scope: 'literal' | 'shared' = 'literal',
): NewAuditRule => ({
  dimension: 'audit',
  value,
  selector: { kind: 'prefix', path, query, scope },
  reason: null,
  enabled: true,
})

/** A finished full crawl that knows these URLs, plus one on another site. */
async function crawlOf(urls: string[]) {
  const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
  if (!crawl) throw new Error('crawl did not start')
  await db.crawls.addUrls(
    crawl.id,
    urls.map((url) => ({
      url,
      urlHash: crawlUrlHash(url),
      scope: url.startsWith(SITE) || url.includes('www.acme.com') ? 'internal' : 'external',
      source: 'link',
      depth: 1,
    })),
  )
  for (const url of urls.filter((u) => u.includes('acme.com'))) {
    await db.crawls.recordResult({
      crawlId: crawl.id,
      urlHash: crawlUrlHash(url),
      result: {
        kind: 'page',
        statusCode: 200,
        contentType: 'text/html',
        redirectTo: null,
        title: null,
        metaRobots: null,
        xRobotsTag: null,
        canonical: null,
        responseTimeMs: 1,
        bytes: 1,
        error: null,
        data: null,
      },
    })
  }
  await db.crawls.finish(crawl.id, { status: 'completed' })
  return (await db.crawls.get(crawl.id))!
}

const preview = async (
  candidate: NewAuditRule,
  options: {
    crawl?: Awaited<ReturnType<typeof crawlOf>> | null
    replacing?: string | null
    languages?: LanguageConfig
  } = {},
) => {
  const config = await db.audit.config(domainId)
  return previewRule({
    db,
    host: 'acme.com',
    crawl: options.crawl === undefined ? null : options.crawl,
    rules: config.rules,
    languages: options.languages ?? config.languages,
    replacing: options.replacing ?? null,
    candidate,
  })
}

describe('previewing a rule', () => {
  it('says it cannot be worked out when no crawl has results, without refusing the rule', async () => {
    expect(await preview(rule('/cart'))).toEqual({ status: 'no-results' })
  })

  it('counts what the last crawl knows that the rule covers, and gives examples', async () => {
    const crawl = await crawlOf([
      `${SITE}/cart`,
      `${SITE}/cart/`,
      `${SITE}/cart/items`,
      `${SITE}/cartoons`,
      `${SITE}/about`,
      'https://www.acme.com/cart/help',
      'https://elsewhere.org/cart',
    ])
    const found = await preview(rule('/cart'), { crawl })
    expect(found).toMatchObject({ status: 'ok', matches: 4, decides: 4 })
    if (found.status !== 'ok') throw new Error('unreachable')
    // The URLs of other sites are not looked at, and /cartoons is not under /cart.
    expect(found.scanned).toBe(6)
    expect([...found.matchSamples].sort()).toEqual(
      [
        `${SITE}/cart`,
        `${SITE}/cart/`,
        `${SITE}/cart/items`,
        'https://www.acme.com/cart/help',
      ].sort(),
    )
    expect(found.overridden).toEqual([])
    expect(found.crawledAt).toEqual(expect.any(String))
  })

  it('tells what another, more specific rule keeps from being decided', async () => {
    const crawl = await crawlOf([`${SITE}/cart`, `${SITE}/cart/help`, `${SITE}/cart/help/faq`])
    const saved = await db.audit.saveRule({ domainId, rule: rule('/cart/help', 'include') })
    if (!saved.ok) throw new Error('rule not saved')
    const found = await preview(rule('/cart'), { crawl })
    expect(found).toMatchObject({ status: 'ok', matches: 3, decides: 1 })
    if (found.status !== 'ok') throw new Error('unreachable')
    expect(found.changeSamples).toEqual([`${SITE}/cart`])
    expect(found.overridden.map((row) => row.url).sort()).toEqual([
      `${SITE}/cart/help`,
      `${SITE}/cart/help/faq`,
    ])
    expect(found.overridden[0]!.by).toMatchObject({
      id: saved.rule!.id,
      value: 'include',
      selector: { kind: 'prefix', path: '/cart/help' },
    })
  })

  it('previews an edit as the rule replacing the one it edits, and a rule that is off as if on', async () => {
    const crawl = await crawlOf([`${SITE}/cart`, `${SITE}/shop`])
    const saved = await db.audit.saveRule({ domainId, rule: rule('/cart') })
    const id = saved.ok ? saved.rule!.id : ''
    // The same selector, edited from itself: not a clash.
    expect(await preview(rule('/cart', 'include'), { crawl, replacing: id })).toMatchObject({
      status: 'ok',
      matches: 1,
      decides: 1,
    })
    expect(await preview({ ...rule('/shop'), enabled: false }, { crawl })).toMatchObject({
      status: 'ok',
      matches: 1,
      decides: 1,
    })
  })

  it('refuses to preview what would clash with an enabled rule', async () => {
    const crawl = await crawlOf([`${SITE}/cart`])
    const saved = await db.audit.saveRule({ domainId, rule: rule('/cart') })
    expect(await preview(rule('/cart', 'include'), { crawl })).toMatchObject({
      status: 'conflict',
      with: { id: saved.ok ? saved.rule!.id : '' },
    })
    // Another query is another selector.
    expect(
      await preview(rule('/cart', 'include', { mode: 'exact', value: 'a=1' }), { crawl }),
    ).toMatchObject({ status: 'ok' })
  })

  it('works over a crawl that is bigger than one batch', async () => {
    const urls = Array.from({ length: 5200 }, (_, i) => `${SITE}/p/${i}`)
    const crawl = await crawlOf(urls)
    expect(await preview(rule('/p'), { crawl })).toMatchObject({
      status: 'ok',
      scanned: 5200,
      matches: 5200,
    })
  })
})

describe('previewing a rule shared between languages', () => {
  const LANGS: LanguageConfig = { prefixes: ['/ca', '/en', '/es'], unprefixed: true }
  const PATHS = [
    '/cart',
    '/es/cart',
    '/en/cart',
    '/ca/cart',
    '/fr/cart',
    '/es/cartoon',
    '/shop/es/cart',
    '/es/account/orders',
    '/about',
  ]
  const crawled = () => crawlOf(PATHS.map((path) => `${SITE}${path}`))
  const shared = (path: string, value: 'exclude' | 'include' = 'exclude') =>
    rule(path, value, { mode: 'any' }, 'shared')

  it('shows the real URLs it covers in every declared directory, and no other', async () => {
    const crawl = await crawled()
    const found = await preview(shared('/cart'), { crawl, languages: LANGS })
    expect(found).toMatchObject({ status: 'ok', matches: 4, decides: 4, changes: 4 })
    if (found.status !== 'ok') throw new Error('unreachable')
    expect([...found.matchSamples].sort()).toEqual(
      ['/cart', '/es/cart', '/en/cart', '/ca/cart'].map((path) => `${SITE}${path}`).sort(),
    )
  })

  it('does not look at the root unless the domain has pages without a directory', async () => {
    const crawl = await crawled()
    const found = await preview(shared('/cart'), {
      crawl,
      languages: { ...LANGS, unprefixed: false },
    })
    expect(found).toMatchObject({ matches: 3 })
  })

  it('covers nothing, and says so, before any language is declared', async () => {
    const crawl = await crawled()
    expect(
      await preview(shared('/cart'), { crawl, languages: { prefixes: [], unprefixed: false } }),
    ).toMatchObject({ status: 'ok', matches: 0, decides: 0, changes: 0 })
  })

  it('covers a prefix in every directory', async () => {
    const crawl = await crawled()
    const found = await preview(rule('/account', 'exclude', { mode: 'any' }, 'shared'), {
      crawl,
      languages: LANGS,
    })
    expect(found).toMatchObject({ matches: 1, decides: 1 })
  })

  it('tells where a literal exception for one language prevails over it', async () => {
    const crawl = await crawled()
    const exception = await db.audit.saveRule({
      domainId,
      rule: {
        dimension: 'audit',
        value: 'include',
        selector: { kind: 'path', path: '/es/cart', query: { mode: 'any' }, scope: 'literal' },
        reason: null,
        enabled: true,
      },
    })
    const found = await preview(shared('/cart'), { crawl, languages: LANGS })
    expect(found).toMatchObject({ matches: 4, decides: 3, changes: 3, overriddenCount: 1 })
    if (found.status !== 'ok') throw new Error('unreachable')
    expect(found.overridden).toEqual([
      {
        url: `${SITE}/es/cart`,
        by: expect.objectContaining({ id: exception.ok ? exception.rule!.id : '' }),
      },
    ])
  })

  it('says how many results would really change, not only how many it decides', async () => {
    const crawl = await crawled()
    const intent = (
      value: 'indexable' | 'not-indexable',
      acceptNofollow = false,
    ): NewAuditRule => ({
      dimension: 'intent',
      value,
      selector: { kind: 'prefix', path: '/cart', query: { mode: 'any' }, scope: 'shared' },
      acceptNofollow,
      reason: null,
      enabled: true,
    })
    // Everything is expected to be indexable already: saying so again changes nothing…
    expect(await preview(intent('indexable'), { crawl, languages: LANGS })).toMatchObject({
      matches: 4,
      decides: 4,
      changes: 0,
    })
    // …unless it also accepts nofollow, which is a different result.
    expect(await preview(intent('indexable', true), { crawl, languages: LANGS })).toMatchObject({
      decides: 4,
      changes: 4,
    })
    expect(await preview(intent('not-indexable'), { crawl, languages: LANGS })).toMatchObject({
      decides: 4,
      changes: 4,
    })
  })

  it('agrees, URL by URL, with what the analysis resolves for the same rules', async () => {
    const crawl = await crawled()
    const candidate = shared('/cart')
    const found = await preview(candidate, { crawl, languages: LANGS })
    if (found.status !== 'ok') throw new Error('unreachable')

    // Save the rule, and resolve every URL with what the worker resolves with.
    const saved = await db.audit.saveRule({ domainId, rule: candidate })
    if (!saved.ok) throw new Error('rule not saved')
    await db.audit.setLanguages({ domainId, languages: LANGS })
    const config = await db.audit.config(domainId)
    const resolver = compileAuditSnapshot(
      auditSnapshotOf(config.version, config.rules, config.languages),
      'acme.com',
    )
    const excluded = PATHS.map((path) => `${SITE}${path}`).filter(
      (url) => resolver.resolve(url).audit.value === 'excluded',
    )
    expect(excluded.sort()).toEqual([...found.matchSamples].sort())
    expect(excluded).toHaveLength(found.decides)
  })
})
