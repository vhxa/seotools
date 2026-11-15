import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import {
  captureHtmlBasisBaseline,
  captureHtmlComparisonBaseline,
} from './html-rendered-basis.baseline'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  createLogger,
  crawlUrlHash,
  ISSUE_BASIS,
  PAGE_ISSUE_IDS,
  evidenceOf,
  classifyFinding,
  isPageLocalIssue,
  observe,
  indexTraces,
  type PageIssueId,
} from '@seotools/core'
import { createCompany, compareWithPrevious, type Crawl } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { runCrawl } from './engine'
import { fakeSite, type Answer } from './fake-site'
import { page, SITE, xml, sitemapOf } from './test-site'
import { renderedOutcome } from './render-fixture'
import { loadSite } from './site-audit'
import { currentAuditConfig, analyseCrawl } from './analysis'
import { presenceOf } from './conditions'
import type { RenderInput, RenderOutcome } from '../render/types'

let db: Database
let domainId: string
const log = createLogger('basis-test', 'silent')
const hash = (path: string) => crawlUrlHash(`${SITE}${path}`)
const ready = async () => ({ state: 'ready' as const, checkedAt: new Date().toISOString() })
beforeEach(async () => {
  db = await createTestDatabase()
  const created = await createCompany(db, { name: 'Basis', domain: 'example.com' })
  if (!created.ok) throw new Error('setup failed')
  domainId = created.domain.id
  await db.crawls.saveSettings(domainId, {
    ...(await db.crawls.settings(domainId)),
    renderingMode: 'headless',
    requestsPerSecond: 100,
    maxRetries: 0,
    retainCrawls: null,
  })
})
afterEach(async () => {
  await db.close()
})
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
    signal: new AbortController().signal,
  })
  return (await db.crawls.get(started.id))!
}
const ids = async (crawl: Crawl, path = '/') =>
  (await db.crawls.issuesOf(crawl.id, [hash(path)])).map(({ issue }) => issue)
const body = (path: string, options: Parameters<typeof page>[1]) =>
  page(path, options).body!.toString()

it('uses rendered scalars, directives, canonical, facts and exact link removals, retaining HTML diagnostics', async () => {
  const before = page('/', {
    title: 'X',
    description: null,
    h1: null,
    canonical: null,
    social: null,
    links: '<a href="/child" rel="nofollow">Child</a><img src="/missing.png">',
  })
  const rendered = body('/', {
    head: '<meta name="robots" content="noindex">',
    canonical: '/child',
    links: '',
  })
  const result = await crawl(
    {
      [`${SITE}/`]: before,
      [`${SITE}/child`]: page('/child'),
      [`${SITE}/missing.png`]: { statusCode: 404, headers: {}, body: Buffer.from('missing') },
    },
    async (input) => ({
      ...renderedOutcome(input),
      ...(input.url === `${SITE}/` ? { html: rendered } : {}),
    }),
  )
  const issues = await ids(result)
  expect(issues).not.toContain('title-too-short')
  expect(issues).not.toContain('description-missing')
  expect(issues).not.toContain('h1-missing')
  expect(issues).not.toContain('internal-nofollow-links')
  expect(issues).not.toContain('resources-broken')
  expect(issues).toEqual(
    expect.arrayContaining([
      'no-outgoing-links',
      'noindex',
      'title-changed-by-javascript',
      'description-only-after-rendering',
      'h1-only-after-rendering',
      'canonical-only-after-rendering',
      'noindex-added-by-javascript',
      'og-missing',
    ]),
  )
  const site = await loadSite(db, result, result.auditSnapshot!)
  const home = site.get(`${SITE}/`)!
  expect(home.indexability).toMatchObject({
    state: 'not-indexable',
    blockers: ['noindex', 'canonical'],
  })
  expect(presenceOf('noindex', home, site)).toBe('present')
  expect(presenceOf('canonical', home, site)).toBe('present')
  expect((await db.crawls.getUrl(result.id, hash('/')))?.title).toBe('X')
  expect((await db.crawls.renderOf(result.id, hash('/')))?.data.documentLinks).toMatchObject({
    internal: 0,
    nofollow: 0,
    embedsComplete: true,
  })
})

it.each([
  {
    served: '<meta name="robots" content="noindex,nofollow">',
    after: '<meta name="robots" content="index,follow">',
    noindex: true,
    nofollow: false,
  },
  {
    served: '<meta name="googlebot" content="noindex">',
    after: '',
    noindex: true,
    nofollow: false,
  },
  {
    served: '',
    after: '<meta name="googlebot" content="noindex,nofollow">',
    noindex: true,
    nofollow: true,
  },
])(
  'retains served noindex but uses selected nofollow: %j',
  async ({ served, after, noindex, nofollow }) => {
    const result = await crawl({ [`${SITE}/`]: page('/', { head: served }) }, async (input) => ({
      ...renderedOutcome(input),
      html: body('/', { head: after }),
    }))
    const site = await loadSite(db, result, result.auditSnapshot!)
    const home = site.get(`${SITE}/`)!
    expect(home.noindex).toBe(noindex)
    expect(home.nofollow).toBe(nofollow)
    expect(await ids(result)).not.toContain('directives-conflict')
  },
)

it.each([
  {
    canonical: '/other',
    head: '',
    header: undefined,
    expected: 'present',
    indexability: 'not-indexable',
  },
  { canonical: null, head: '', header: undefined, expected: 'absent', indexability: 'indexable' },
  {
    canonical: null,
    head: '',
    header: '<https://example.com/header>; rel="canonical"',
    expected: 'present',
    indexability: 'not-indexable',
  },
  {
    canonical: '/other',
    head: '<link rel="canonical" href="/conflict">',
    header: undefined,
    expected: 'unknown',
    indexability: 'unknown',
  },
])(
  'selects added/removed/header/conflicting canonicals: %j',
  async ({ canonical, head, header, expected, indexability }) => {
    const result = await crawl(
      {
        [`${SITE}/`]: page('/', {
          canonical: '/served',
          links: '<a href="/child">Child</a>',
          headers: header ? { link: header } : {},
        }),
        [`${SITE}/child`]: page('/child'),
      },
      async (input) => ({ ...renderedOutcome(input), html: body('/', { canonical, head }) }),
    )
    const site = await loadSite(db, result, result.auditSnapshot!)
    const home = site.get(`${SITE}/`)!
    expect(presenceOf('canonical', home, site)).toBe(expected)
    expect(home.indexability.state).toBe(indexability)
    if (expected === 'unknown') expect(await ids(result)).toContain('canonical-conflict')
  },
)

it.each([
  'failed',
  'truncated',
  'unsettled',
  'missing',
  'legacy',
  'redirected',
  'other-2xx',
] as const)(
  'never judges the served document after %s; preserves known response blockers',
  async (cause) => {
    const source = page('/', { title: null, head: '<meta name="robots" content="noindex">' })
    if (cause === 'other-2xx') source.statusCode = 201
    const result = await crawl({ [`${SITE}/`]: source }, async (input) => ({
      ...renderedOutcome(input),
      ...(cause === 'failed'
        ? { status: 'failed', failure: { code: 'serialization', message: 'test' } }
        : {}),
      ...(cause === 'truncated' ? { truncated: true } : {}),
      ...(cause === 'unsettled' ? { settled: false } : {}),
      ...(cause === 'redirected'
        ? { redirected: true, settled: false, finalUrl: `${SITE}/target` }
        : {}),
    }))
    if (cause === 'missing' || cause === 'legacy') {
      const renders = db.crawls.renders
      db.crawls.renders = async (id) =>
        cause === 'missing'
          ? []
          : (await renders(id)).map((row) => ({ ...row, data: { ...row.data, page: undefined } }))
      await analyseCrawl(db, result.id, await currentAuditConfig(db, domainId))
    }
    expect(
      (await ids(result)).filter((id) => ISSUE_BASIS[id as PageIssueId] === 'document'),
    ).toEqual([])
    expect(
      (await db.crawls.acceptedOf(result.id, [hash('/')])).filter(
        ({ issue }) => ISSUE_BASIS[issue as PageIssueId] === 'document',
      ),
    ).toEqual([])
    const audit = (await db.crawls.auditOf(result.id, [hash('/')]))[0]!
    expect(audit.indexability).toBe('not-indexable')
    expect(audit.blockers).toContain('noindex')
    expect(audit.documentObservation).toBe(cause === 'redirected' ? 'redirected' : 'unobserved')
    if (cause === 'failed') expect(await ids(result)).toContain('render-failed')
    else expect(await ids(result)).not.toContain('render-failed')
  },
)

it('keeps incomplete A unknown and B normally comparable in both directions, including stored history and alert counts', async () => {
  const data = {
    [`${SITE}/`]: page('/', { links: '<a href="/a">A</a><a href="/b">B</a>' }),
    [`${SITE}/a`]: page('/a', { title: null }),
    [`${SITE}/b`]: page('/b', { title: null }),
    [`${SITE}/sitemap.xml`]: xml(sitemapOf(['/a', '/b'])),
  }
  const crawls: Crawl[] = []
  for (const partial of [false, true, false])
    crawls.push(
      await crawl(data, async (input) => ({
        ...renderedOutcome(input),
        ...(partial && input.url === `${SITE}/a`
          ? { status: 'failed', failure: { code: 'serialization', message: 'test' } }
          : {}),
      })),
    )
  const traces = indexTraces(
    await db.crawls.urlHistory({
      domainId,
      crawlIds: crawls.map((c) => c.id),
      urlHashes: [hash('/a'), hash('/b')],
    }),
  )
  for (const path of ['/a', '/b']) {
    const evidence = evidenceOf(crawls, traces, hash(path))
    for (const [a, b] of [
      [0, 1],
      [1, 0],
      [1, 2],
      [2, 1],
    ]) {
      expect(
        classifyFinding('title-missing', { base: evidence[a!]!, target: evidence[b!]! })?.kind,
      ).toBe(path === '/a' ? 'unverified' : 'persistent')
      // Every page-local document issue: unknown for A only, never for B.
      for (const issue of PAGE_ISSUE_IDS.filter(
        (id) => ISSUE_BASIS[id] === 'document' && isPageLocalIssue(id),
      )) {
        const change = classifyFinding(issue, { base: evidence[a!]!, target: evidence[b!]! })
        if (path === '/b') expect(change?.kind, issue).not.toBe('unverified')
        else if (change) expect(change.kind, issue).toBe('unverified')
        if (path === '/a') expect(observe(issue, evidence[1]!).presence, issue).toBe('unknown')
      }
      // Issues that read other pages stay unknown crawl-wide, for B too.
      for (const issue of ['title-duplicate', 'hreflang-no-return', 'canonical-not-indexable'])
        expect(observe(issue, evidence[1]!).presence, issue).toBe('unknown')
    }
  }
  expect(crawls[1]!.auditSnapshot?.unobserved).toContain('title-duplicate')
  expect(crawls[1]!.auditSnapshot?.unobserved).toContain('hreflang-no-return')
  expect(crawls[1]!.auditSnapshot?.unobserved).not.toContain('title-missing')
  expect(crawls[1]!.auditSnapshot?.documentCoverage).toMatchObject({ complete: 2, unobserved: 1 })
  for (const result of crawls.slice(1)) {
    const changes = await compareWithPrevious({ db, target: result, exact: true })
    for (const [issue, tally] of changes.byIssue)
      if (['document', 'graph'].includes(ISSUE_BASIS[issue as PageIssueId]))
        expect(tally).toMatchObject({ fresh: 0, back: 0, resolved: 0 })
    expect(changes.important).toEqual([])
  }
})

it('keeps every reported document/graph difference unverified across modes and out of fresh/back alerts', async () => {
  const data = { [`${SITE}/`]: page('/', { title: null, links: '' }) }
  await db.crawls.saveSettings(domainId, {
    ...(await db.crawls.settings(domainId)),
    renderingMode: 'http',
  })
  const html = await crawl(data)
  await db.crawls.saveSettings(domainId, {
    ...(await db.crawls.settings(domainId)),
    renderingMode: 'headless',
  })
  const rendered = await crawl(data, async (input) => ({
    ...renderedOutcome(input),
    html: body('/', { links: '<a href="/new">New</a>' }),
  }))
  const traces = indexTraces(
    await db.crawls.urlHistory({
      domainId,
      crawlIds: [html.id, rendered.id],
      urlHashes: [hash('/')],
    }),
  )
  const [a, b] = evidenceOf([html, rendered], traces, hash('/'))
  for (const issue of PAGE_ISSUE_IDS.filter((id) =>
    ['document', 'graph'].includes(ISSUE_BASIS[id]),
  )) {
    for (const pair of [
      { base: a!, target: b! },
      { base: b!, target: a! },
    ]) {
      const result = classifyFinding(issue, pair)
      if (result) expect(result).toMatchObject({ kind: 'unverified' })
    }
  }
  const comparison = await compareWithPrevious({ db, target: rendered, exact: true })
  expect(comparison.important).toEqual([])
  expect(comparison.findings).toMatchObject({ fresh: 0, back: 0, resolved: 0 })
})

it.each(['indexable', 'not-indexable'] as const)(
  'uses selected blockers for explicit %s expectations and keeps incomplete conditions unknown',
  async (intent) => {
    await db.audit.saveRule({
      domainId,
      rule: {
        dimension: 'intent',
        value: intent,
        selector: { kind: 'path', path: '/a', query: { mode: 'any' }, scope: 'literal' },
        reason: null,
        enabled: true,
      },
    })
    await db.audit.saveRule({
      domainId,
      rule: {
        dimension: 'canonical',
        value: 'required',
        selector: { kind: 'path', path: '/a', query: { mode: 'any' }, scope: 'literal' },
        reason: null,
        enabled: true,
      },
    })
    const data = {
      [`${SITE}/`]: page('/', { links: '<a href="/a">A</a>' }),
      [`${SITE}/a`]: page('/a', { canonical: null }),
    }
    const result = await crawl(data, async (input) => ({
      ...renderedOutcome(input),
      html: body(new URL(input.url).pathname, {
        head: '<meta name="robots" content="noindex">',
        canonical: '/target',
      }),
    }))
    const found = await ids(result, '/a')
    if (intent === 'indexable') expect(found).toContain('expected-indexable-blocked')
    else expect(found).not.toContain('expected-not-indexable-but-indexable')
    expect(found).not.toContain('canonical-required-missing')
    const site = await loadSite(db, result, result.auditSnapshot!)
    expect(presenceOf('canonical', site.get(`${SITE}/a`)!, site)).toBe('present')
  },
)

it('does not infer missing hreflang returns or duplicate eligibility from incomplete targets, nor accept an unknown origin', async () => {
  await db.audit.saveRule({
    domainId,
    rule: {
      dimension: 'noindex',
      value: 'allowed',
      selector: { kind: 'path', path: '/a', query: { mode: 'any' }, scope: 'literal' },
      reason: null,
      enabled: true,
    },
  })
  const data = {
    [`${SITE}/`]: page('/', { links: '<a href="/a">A</a>' }),
    [`${SITE}/a`]: page('/a', {
      head: '<meta name="robots" content="noindex"><link rel="alternate" hreflang="es" href="/b">',
    }),
    [`${SITE}/b`]: page('/b', { title: null }),
  }
  const result = await crawl(data, async (input) => ({
    ...renderedOutcome(input),
    ...(input.url.endsWith('/b')
      ? { status: 'failed', failure: { code: 'serialization', message: 'test' } }
      : {}),
  }))
  expect(await ids(result, '/a')).not.toContain('hreflang-no-return')
  const site = await loadSite(db, result, result.auditSnapshot!)
  expect([...site.titles.values()].flat().some((url) => url.url.url.endsWith('/b'))).toBe(false)
})

// Captured from origin/feat/0.6.0 at 78ec808, preserving the earlier 139-scenario baseline too.
it('keeps HTML findings, accepted rows, counts, audit state and scope byte-identical to the WP6 base', async () => {
  const expected = gunzipSync(
    readFileSync(new URL('./html-rendered-basis.json.gz', import.meta.url)),
  ).toString()
  expect(JSON.stringify(await captureHtmlBasisBaseline())).toBe(expected)
})

// Captured from origin/feat/0.6.0 at 78ec808: every comparison and alert between HTML crawls.
it('keeps comparisons and alerts between HTML crawls byte-identical to the WP6 base', async () => {
  const expected = gunzipSync(
    readFileSync(new URL('./html-comparison-basis.json.gz', import.meta.url)),
  ).toString()
  expect(JSON.stringify(await captureHtmlComparisonBaseline())).toBe(expected)
})

it.each(['required', 'forbidden'] as const)(
  'judges response checks on the served projection with the whole site graph (sitemap %s)',
  async (requirement) => {
    await db.audit.saveRule({
      domainId,
      rule: {
        dimension: 'sitemap',
        value: requirement,
        selector: { kind: 'path', path: '/a', query: { mode: 'any' }, scope: 'literal' },
        reason: null,
        enabled: true,
      },
    })
    const result = await crawl({
      [`${SITE}/`]: page('/', { links: '<a href="/a">A</a>' }),
      [`${SITE}/a`]: page('/a'),
      [`${SITE}/sitemap.xml`]: xml(sitemapOf(['/', '/a'])),
    })
    const found = await ids(result, '/a')
    if (requirement === 'required') expect(found).not.toContain('sitemap-required-missing')
    else expect(found).toContain('sitemap-forbidden-present')
    const site = await loadSite(db, result, result.auditSnapshot!)
    const a = site.get(`${SITE}/a`)!
    for (const key of ['sitemaps', 'linksIn', 'anchorsIn', 'clickDepth'] as const)
      expect(a.served![key], key).toEqual(a[key])
  },
)
