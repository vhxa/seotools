import { createLogger, crawlUrlHash } from '@seotools/core'
import { compareWithPrevious, createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BrowserUnavailableError, type RenderInput } from '../render/types'
import { JobInterruptedError } from '../types'
import { runCrawl, type CrawlEngineOptions } from './engine'
import { fakeSite, type Answer } from './fake-site'
import { renderedOutcome } from './render-fixture'
import { SITE, page, xml, sitemapOf } from './test-site'
import { analyseCrawl, currentAuditConfig } from './analysis'
import { loadSite } from './site-audit'
import { presenceOf } from './conditions'
import { RENDERED_GRAPH_ISSUES } from './observed-inputs'
import { detectFindings } from './issue-checks'
import { runCrawlAlerts } from '../alerts/run'

let db: Database
let domainId: string
const log = createLogger('test', 'silent')
const menu = '<a href="/menu">Menu</a><a href="/only-js">Only JS</a>'
const siteData: Record<string, Answer> = {
  [`${SITE}/`]: page('/', { links: '' }),
  [`${SITE}/menu`]: page('/menu'),
  [`${SITE}/only-js`]: page('/only-js'),
  [`${SITE}/orphan`]: page('/orphan'),
  [`${SITE}/sitemap.xml`]: xml(sitemapOf(['/menu', '/orphan'])),
}
const ready = async () => ({ state: 'ready' as const, checkedAt: new Date().toISOString() })
const render = (input: RenderInput) =>
  Promise.resolve(renderedOutcome(input, input.url === `${SITE}/` ? menu : ''))
const hash = (path: string) => crawlUrlHash(`${SITE}${path}`)
const issues = async (crawlId: string, path: string) =>
  (await db.crawls.issuesOf(crawlId, [hash(path)])).map((row) => row.issue)

beforeEach(async () => {
  db = await createTestDatabase()
  const created = await createCompany(db, { name: 'Rendered', domain: 'example.com' })
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
async function start(type: 'full' | 'priority' = 'full') {
  const crawl = await db.crawls.start({ domainId, type, trigger: 'manual' })
  if (!crawl) throw new Error('start failed')
  return crawl
}
function options(extra: Partial<CrawlEngineOptions> = {}): CrawlEngineOptions {
  return {
    db,
    log,
    signal: new AbortController().signal,
    createFetcher: fakeSite(siteData, 0).createFetcher,
    renderService: { check: ready, render },
    browserMaxWaitMs: 30,
    browserPollMs: 5,
    ...extra,
  }
}
it('discovers and follows the rendered menu, retains HTML checks and both graph origins', async () => {
  const crawl = await start()
  const rendering = vi.fn(render)
  const fake = fakeSite(siteData, 0)
  await runCrawl(
    crawl.id,
    options({
      createFetcher: fake.createFetcher,
      renderService: { check: ready, render: rendering },
    }),
  )
  expect(await issues(crawl.id, '/menu')).toContain('linked-only-by-javascript')
  expect(await issues(crawl.id, '/menu')).not.toContain('orphan-in-sitemap')
  expect(await issues(crawl.id, '/only-js')).toContain('linked-only-by-javascript')
  expect(await issues(crawl.id, '/')).toContain('links-only-after-rendering')
  expect(await issues(crawl.id, '/')).toContain('few-html-links')
  expect(fake.requests).toContain(`${SITE}/only-js`)
  const links = await db.crawls.linksFrom(crawl.id, [hash('/')])
  expect(links.filter((link) => link.rendered === 1)).toHaveLength(2)
  expect((await db.crawls.getUrl(crawl.id, hash('/only-js')))?.depth).toBe(1)
  expect(await db.crawls.renders(crawl.id)).toHaveLength(4)
  expect(new Set(rendering.mock.calls.map(([input]) => input.url)).size).toBe(4)
  const homeInput = rendering.mock.calls.find(([input]) => input.url === `${SITE}/`)![0]
  expect(homeInput.document.body).toEqual((siteData[`${SITE}/`] as { body: Buffer }).body)
  expect(homeInput.allowedByRobots('https://unseen.test/a')).toBe('unknown')
  expect((await db.crawls.get(crawl.id))?.auditSnapshot?.rendersUnobserved).toBe(0)
})
it('HTML crawls do not render and report the sitemap orphan with JavaScript unknown', async () => {
  await db.crawls.saveSettings(domainId, {
    ...(await db.crawls.settings(domainId)),
    renderingMode: 'http',
  })
  const crawl = await start()
  const rendering = vi.fn(render)
  await runCrawl(crawl.id, options({ renderService: { check: ready, render: rendering } }))
  expect(rendering).not.toHaveBeenCalled()
  expect(await issues(crawl.id, '/menu')).toContain('orphan-in-sitemap')
  expect((await db.crawls.get(crawl.id))?.auditSnapshot?.unobserved).toEqual(
    expect.arrayContaining(['linked-only-by-javascript', 'links-only-after-rendering']),
  )
  expect(await db.crawls.renders(crawl.id)).toEqual([])
})
it('keeps a twice-failed page unknown, suppressing orphan and unlinked absence everywhere', async () => {
  const crawl = await start()
  const rendering = vi.fn(async (input: RenderInput) =>
    input.url.endsWith('/menu')
      ? {
          ...renderedOutcome(input),
          status: 'failed' as const,
          failure: { code: 'serialization' as const, message: 'failed' },
        }
      : render(input),
  )
  await runCrawl(crawl.id, options({ renderService: { check: ready, render: rendering } }))
  expect(rendering.mock.calls.filter(([input]) => input.url.endsWith('/menu'))).toHaveLength(2)
  expect(await issues(crawl.id, '/orphan')).not.toContain('orphan-in-sitemap')
  const stored = (await db.crawls.get(crawl.id))!
  expect(stored.auditSnapshot?.rendersUnobserved).toBe(1)
  expect(stored.auditSnapshot?.unobserved).toEqual(
    expect.arrayContaining(['linked-only-by-javascript', 'links-only-after-rendering']),
  )
  const allUrls = await db.crawls.listUrls({
    crawlId: crawl.id,
    view: 'all',
    limit: 1000,
    offset: 0,
  })
  const allFindings = await db.crawls.issuesOf(
    crawl.id,
    allUrls.map((url) => url.urlHash),
  )
  expect(allFindings.some((row) => row.issue === 'orphan-in-sitemap')).toBe(false)
  const site = await loadSite(db, stored, stored.auditSnapshot!)
  for (const url of site.urls.filter((url) => url.contentPage && url.anchorsIn === 0))
    expect(presenceOf('unlinked', url, site)).toBe('unknown')
})
it('replaces only a successful second attempt, and follows its newly discovered links', async () => {
  const crawl = await start()
  let attempts = 0
  const rendering = vi.fn(async (input: RenderInput) => {
    if (input.url === `${SITE}/` && ++attempts === 1)
      return { ...renderedOutcome(input), status: 'failed' as const }
    return render(input)
  })
  await runCrawl(crawl.id, options({ renderService: { check: ready, render: rendering } }))
  expect(attempts).toBe(2)
  expect(await issues(crawl.id, '/only-js')).toContain('linked-only-by-javascript')
  expect((await db.crawls.renders(crawl.id)).every((row) => row.status === 'rendered')).toBe(true)
})
it.each([false, true])('recovers from a mid-crawl disconnect: recovery=%s', async (recovers) => {
  const crawl = await start()
  let disconnected = false
  let checks = 0
  let thrown = false
  const successes: string[] = []
  const rendering = vi.fn(async (input: RenderInput) => {
    if (!input.url.endsWith('/') && !thrown) {
      thrown = true
      disconnected = true
      throw new BrowserUnavailableError()
    }
    if (disconnected) throw new BrowserUnavailableError()
    successes.push(input.url)
    return render(input)
  })
  const check = async () => {
    if (disconnected && recovers && ++checks >= 2) disconnected = false
    return {
      state: disconnected ? ('unreachable' as const) : ('ready' as const),
      checkedAt: new Date().toISOString(),
    }
  }
  await runCrawl(crawl.id, options({ renderService: { check, render: rendering } }))
  const stored = (await db.crawls.get(crawl.id))!
  expect(stored.status).toBe(recovers ? 'completed' : 'failed')
  expect(stored.error).toBe(recovers ? null : 'browser-unavailable')
  expect(new Set(successes).size).toBe(successes.length)
  if (recovers) expect(await db.crawls.renders(crawl.id)).toHaveLength(4)
  else expect(stored.browserWaitMs).toBe(30)
})
it('shutdown hands back waiting work with its budget and no done URL or render', async () => {
  const crawl = await start()
  const shutdown = new AbortController()
  const save = db.crawls.saveBrowserWait
  db.crawls.saveBrowserWait = async (...args) => {
    await save(...args)
    shutdown.abort()
  }
  await expect(
    runCrawl(
      crawl.id,
      options({
        signal: shutdown.signal,
        renderService: {
          check: async () => ({ state: 'unreachable', checkedAt: new Date().toISOString() }),
          render,
        },
      }),
    ),
  ).rejects.toBeInstanceOf(JobInterruptedError)
  expect((await db.crawls.get(crawl.id))?.browserWaitMs).toBe(5)
  expect((await db.crawls.countUrls(crawl.id)).urlsDoneCount).toBe(0)
  expect(await db.crawls.renders(crawl.id)).toEqual([])
})
it('resumes from committed results without re-rendering done URLs, using its original mode', async () => {
  const crawl = await start()
  const shutdown = new AbortController()
  const record = db.crawls.recordResult
  db.crawls.recordResult = async (input) => {
    await record(input)
    if (input.render) shutdown.abort()
  }
  await expect(runCrawl(crawl.id, options({ signal: shutdown.signal }))).rejects.toBeInstanceOf(
    JobInterruptedError,
  )
  const committed = await db.crawls.renders(crawl.id)
  expect(committed.length).toBeGreaterThan(0)
  db.crawls.recordResult = record
  await db.crawls.saveSettings(domainId, {
    ...(await db.crawls.settings(domainId)),
    renderingMode: 'http',
    renderWaitMs: 30000,
  })
  const rendering = vi.fn(render)
  await runCrawl(crawl.id, options({ renderService: { check: ready, render: rendering } }))
  for (const row of committed)
    expect(
      rendering.mock.calls.some(([input]) => hash(new URL(input.url).pathname) === row.urlHash),
    ).toBe(false)
  for (const [input] of rendering.mock.calls) expect(input.waitMs).toBe(5000)
  expect((await db.crawls.get(crawl.id))?.status).toBe('completed')
})
it('renders priority URLs without analysing the priority crawl', async () => {
  await db.priorityUrls.add({ domainId, url: `${SITE}/` })
  const crawl = await start('priority')
  await runCrawl(crawl.id, options())
  expect(await db.crawls.renders(crawl.id)).toHaveLength(1)
  expect((await db.crawls.get(crawl.id))?.issueCatalog).toBeNull()
})
it('keeps other 2xx pages served-only and their render unknown', async () => {
  const crawl = await start()
  const data = { ...siteData, [`${SITE}/menu`]: { ...page('/menu'), statusCode: 201 } }
  await runCrawl(crawl.id, options({ createFetcher: fakeSite(data, 0).createFetcher }))
  expect((await db.crawls.renders(crawl.id)).some((row) => row.urlHash === hash('/menu'))).toBe(
    false,
  )
  expect((await db.crawls.get(crawl.id))?.auditSnapshot?.rendersUnobserved).toBe(1)
  await analyseCrawl(db, crawl.id, await currentAuditConfig(db, domainId))
  expect((await db.crawls.get(crawl.id))?.auditSnapshot?.rendering).toBe('rendered')
})

it('keeps a committed failed render unknown on resume without retrying its lost body', async () => {
  const crawl = await start()
  const shutdown = new AbortController()
  const record = db.crawls.recordResult
  db.crawls.recordResult = async (input) => {
    await record(input)
    if (input.render?.status === 'failed') shutdown.abort()
  }
  await expect(
    runCrawl(
      crawl.id,
      options({
        signal: shutdown.signal,
        renderService: {
          check: ready,
          render: async (input) => ({
            ...renderedOutcome(input),
            status: 'failed' as const,
            failure: { code: 'serialization', message: 'failed' },
          }),
        },
      }),
    ),
  ).rejects.toBeInstanceOf(JobInterruptedError)
  const failed = (await db.crawls.renders(crawl.id)).filter((row) => row.status === 'failed')
  expect(failed.length).toBeGreaterThan(0)
  db.crawls.recordResult = record
  const rendering = vi.fn(render)
  await runCrawl(crawl.id, options({ renderService: { check: ready, render: rendering } }))
  for (const row of failed) {
    expect(rendering.mock.calls.some(([input]) => crawlUrlHash(input.url) === row.urlHash)).toBe(
      false,
    )
    expect(
      (await db.crawls.renders(crawl.id)).find((kept) => kept.urlHash === row.urlHash),
    ).toEqual(row)
  }
  expect((await db.crawls.get(crawl.id))?.auditSnapshot?.rendersUnobserved).toBe(failed.length)
})

it.each(['failed', 'truncated', 'unsettled', 'served-truncated', 'legacy'] as const)(
  '%s observation never resolves or creates graph findings or alert regressions in either direction',
  async (cause) => {
    const user = await db.users.create({
      email: 'render@example.com',
      name: 'Render',
      role: 'admin',
    })
    await db.alerts.save({
      userId: user.id,
      locale: 'en',
      domains: [{ domainId, kinds: ['change-summary', 'important-findings'] }],
    })
    // The unrelated /menu changes observation quality only; /orphan never gains a link.
    for (const partial of [false, true, false]) {
      const crawl = await start()
      const data = {
        ...siteData,
        ...(partial && cause === 'served-truncated'
          ? { [`${SITE}/menu`]: { ...page('/menu'), truncated: true } }
          : {}),
      }
      await runCrawl(
        crawl.id,
        options({
          createFetcher: fakeSite(data, 0).createFetcher,
          renderService: {
            check: ready,
            render: async (input) => {
              const outcome = await render(input)
              if (!partial || !input.url.endsWith('/menu')) return outcome
              if (cause === 'failed') return { ...outcome, status: 'failed' as const }
              if (cause === 'truncated') return { ...outcome, truncated: true }
              if (cause === 'unsettled') return { ...outcome, settled: false }
              return outcome
            },
          },
        }),
      )
      if (partial && cause === 'legacy') {
        const url = (await db.crawls.getUrl(crawl.id, hash('/menu')))!
        const row = (await db.crawls.renders(crawl.id)).find((row) => row.urlHash === url.urlHash)!
        await db.crawls.recordResult({
          crawlId: crawl.id,
          urlHash: url.urlHash,
          result: url,
          render: { ...row, truncated: null },
        })
        await analyseCrawl(db, crawl.id, await currentAuditConfig(db, domainId))
      }
      const stored = (await db.crawls.get(crawl.id))!
      expect(stored.auditSnapshot?.rendersUnobserved).toBe(partial ? 1 : 0)
      expect(stored.auditSnapshot?.renderCoverage).toEqual({
        failedOrMissing: partial && (cause === 'failed' || cause === 'legacy') ? 1 : 0,
        truncated: partial && (cause === 'truncated' || cause === 'served-truncated') ? 1 : 0,
        unsettled: partial && cause === 'unsettled' ? 1 : 0,
      })
      expect((await issues(crawl.id, '/orphan')).includes('orphan-in-sitemap')).toBe(!partial)
      const site = await loadSite(db, stored, stored.auditSnapshot!)
      expect(presenceOf('unlinked', site.get(`${SITE}/orphan`)!, site)).toBe(
        partial ? 'unknown' : 'present',
      )
      // Even in a partial snapshot, the rendered menu positively proves that /only-js is linked.
      expect(presenceOf('unlinked', site.get(`${SITE}/only-js`)!, site)).toBe('absent')
      if (partial)
        expect(stored.auditSnapshot?.unobserved).toEqual(
          expect.arrayContaining([...RENDERED_GRAPH_ISSUES]),
        )
      // A served page cut at the body limit cannot prove `few-html-links` absent anywhere.
      expect(stored.auditSnapshot?.unobserved?.includes('few-html-links') ?? false).toBe(
        partial && cause === 'served-truncated',
      )
      const comparison = await compareWithPrevious({ db, target: stored, exact: true })
      if (comparison.base) {
        expect(comparison.byIssue.get('orphan-in-sitemap')).toMatchObject({
          fresh: 0,
          back: 0,
          resolved: 0,
          unverified: 1,
          reasons: ['unobserved'],
        })
        expect(
          [...comparison.byIssue].filter(
            ([id, counts]) => id !== 'render-failed' && (counts.resolved > 0 || counts.fresh > 0),
          ),
        ).toEqual([])
        expect(comparison.findings).toMatchObject({
          fresh: cause === 'failed' && partial ? 1 : 0,
          back: 0,
          resolved: cause === 'failed' && !partial ? 1 : 0,
        })
        expect(comparison.important.every((finding) => finding.issue === 'render-failed')).toBe(
          true,
        )
        const messages: string[] = []
        await runCrawlAlerts({
          db,
          log,
          crawlId: crawl.id,
          signal: new AbortController().signal,
          publicUrl: 'https://seo.example.com',
          getMailer: async () => ({
            send: async (message) => {
              messages.push(message.text ?? '')
              return { id: 'sent' }
            },
            verify: async () => {},
          }),
        })
        expect(messages).toHaveLength(1)
        expect(messages[0]).toContain(
          `Findings: ${cause === 'failed' && partial ? 1 : 0} new, 0 back, ${cause === 'failed' && !partial ? 1 : 0} resolved,`,
        )
      }
    }
  },
)

it.each(['failed', 'truncated', 'unsettled'] as const)(
  'a %s /menu cannot prove only-nofollow/noindex inlinks or deep pages, including accepted findings',
  async (cause) => {
    await db.audit.setThresholds({ domainId, thresholds: { clickDepthMax: 1 } })
    const data = {
      [`${SITE}/`]: page('/', {
        links:
          '<a href="/nofollow" rel="nofollow">Target</a><a href="/noindex-source">Source</a><a href="/step">Step</a><a href="/menu">Menu</a>',
      }),
      [`${SITE}/noindex-source`]: page('/noindex-source', {
        head: '<meta name="robots" content="noindex">',
        links: '<a href="/noindex">Target</a><a href="/accepted">Accepted</a>',
      }),
      [`${SITE}/step`]: page('/step', { links: '<a href="/deep">Deep</a>' }),
      [`${SITE}/deep`]: page('/deep'),
      [`${SITE}/nofollow`]: page('/nofollow'),
      [`${SITE}/noindex`]: page('/noindex'),
      [`${SITE}/accepted`]: page('/accepted', { head: '<meta name="robots" content="noindex">' }),
      [`${SITE}/menu`]: page('/menu'),
    }
    await db.audit.saveRule({
      domainId,
      rule: {
        dimension: 'intent',
        value: 'not-indexable',
        selector: { kind: 'path', path: '/accepted', query: { mode: 'any' }, scope: 'literal' },
        reason: null,
        enabled: true,
      },
    })
    const rendering = vi.fn(async (input: RenderInput) => {
      const outcome = renderedOutcome(input)
      if (!input.url.endsWith('/menu')) return outcome
      // The omitted menu could have followed, indexable links and shorter routes to these pages.
      if (cause === 'failed') return { ...outcome, status: 'failed' as const }
      return { ...outcome, truncated: cause === 'truncated', settled: cause !== 'unsettled' }
    })
    const crawl = await start()
    await runCrawl(
      crawl.id,
      options({
        createFetcher: fakeSite(data, 0).createFetcher,
        renderService: { check: ready, render: rendering },
      }),
    )
    if (cause === 'failed')
      expect(rendering.mock.calls.filter(([input]) => input.url.endsWith('/menu'))).toHaveLength(2)
    const stored = (await db.crawls.get(crawl.id))!
    const site = await loadSite(db, stored, stored.auditSnapshot!)
    const absent = ['only-nofollow-inlinks', 'only-noindex-inlinks', 'deep-page']
    for (const url of site.urls) {
      const findings = detectFindings(url, site)
      expect(
        [...findings.found, ...findings.accepted].filter(({ issue }) => absent.includes(issue)),
      ).toEqual([])
    }
    // Prove the fixtures would reproduce all three errors without the coverage guard.
    const unchecked = { ...site, rendersUnobserved: 0 }
    expect(
      detectFindings(site.get(`${SITE}/nofollow`)!, unchecked).found.map(({ issue }) => issue),
    ).toContain('only-nofollow-inlinks')
    expect(
      detectFindings(site.get(`${SITE}/noindex`)!, unchecked).found.map(({ issue }) => issue),
    ).toContain('only-noindex-inlinks')
    expect(
      detectFindings(site.get(`${SITE}/deep`)!, unchecked).found.map(({ issue }) => issue),
    ).toContain('deep-page')
    expect(
      detectFindings(site.get(`${SITE}/accepted`)!, unchecked).accepted.map(({ issue }) => issue),
    ).toContain('only-noindex-inlinks')
  },
)

it.each([false, true])(
  'keeps resources-broken identical across a twice-failed home render (HTML embed=%s)',
  async (htmlEmbed) => {
    const data = {
      ...siteData,
      [`${SITE}/`]: page('/', { links: htmlEmbed ? '<img src="/html-missing.png">' : '' }),
      [`${SITE}/js-missing.png`]: { statusCode: 404, headers: {}, body: Buffer.from('missing') },
      [`${SITE}/html-missing.png`]: { statusCode: 404, headers: {}, body: Buffer.from('missing') },
    }
    const findings = []
    for (const partial of [false, true, false]) {
      const crawl = await start()
      const rendering = vi.fn(async (input: RenderInput) => {
        const outcome = renderedOutcome(
          input,
          input.url === `${SITE}/` ? '<img src="/js-missing.png">' : '',
        )
        return partial && input.url === `${SITE}/`
          ? { ...outcome, status: 'failed' as const }
          : outcome
      })
      await runCrawl(
        crawl.id,
        options({
          createFetcher: fakeSite(data, 0).createFetcher,
          renderService: { check: ready, render: rendering },
        }),
      )
      expect(rendering.mock.calls.filter(([input]) => input.url === `${SITE}/`)).toHaveLength(
        partial ? 2 : 1,
      )
      const rows = (await db.crawls.issuesOf(crawl.id, [hash('/')]))
        .filter((row) => row.issue === 'resources-broken')
        .map(({ issue, details }) => ({ issue, details }))
      expect(rows).toHaveLength(htmlEmbed ? 1 : 0)
      findings.push(rows)
      const links = await db.crawls.linksFrom(crawl.id, [hash('/')])
      expect(
        links.some((link) => link.targetHash === hash('/js-missing.png') && link.rendered === 1),
      ).toBe(!partial)
      const comparison = await compareWithPrevious({
        db,
        target: (await db.crawls.get(crawl.id))!,
        exact: true,
      })
      const changes = comparison.byIssue.get('resources-broken')
      expect(changes?.fresh ?? 0).toBe(0)
      expect(changes?.back ?? 0).toBe(0)
      expect(changes?.resolved ?? 0).toBe(0)
    }
    expect(findings[1]).toEqual(findings[0])
    expect(findings[2]).toEqual(findings[0])
  },
)

it.each(['failed', 'truncated', 'unsettled', 'legacy-values'] as const)(
  'keeps difference comparisons unverified through a %s render in both directions',
  async (cause) => {
    const { RENDER_DIFFERENCE_IDS } = await import('./render-differences')
    const snapshots = []
    for (let iteration = 0; iteration < 3; iteration++) {
      const partial = iteration === 1
      const crawl = await start()
      await runCrawl(
        crawl.id,
        options({
          renderService: {
            check: ready,
            render: async (input) => {
              const result = renderedOutcome(input, '<title>Rendered title</title>')
              // Replace rather than add a second title: the extractor keeps the first one.
              result.html = result.html.replace(
                /<title>.*?<\/title>/,
                '<title>Changed rendered title</title>',
              )
              if (partial && input.url === SITE + '/') {
                if (cause === 'failed')
                  return {
                    ...result,
                    status: 'failed',
                    failure: { code: 'serialization', message: 'failed' },
                  }
                if (cause === 'truncated') result.truncated = true
                if (cause === 'unsettled') result.settled = false
              }
              return result
            },
          },
        }),
      )
      if (partial && cause === 'legacy-values') {
        const url = (await db.crawls.getUrl(crawl.id, hash('/')))!
        const row = (await db.crawls.renders(crawl.id)).find((row) => row.urlHash === hash('/'))!
        delete row.data.page
        await db.crawls.recordResult({
          crawlId: crawl.id,
          urlHash: hash('/'),
          result: url,
          render: row,
        })
        await analyseCrawl(db, crawl.id, await currentAuditConfig(db, domainId))
      }
      const stored = (await db.crawls.get(crawl.id))!
      snapshots.push(stored)
      const home = await issues(crawl.id, '/')
      if (partial) {
        expect(home.filter((id) => RENDER_DIFFERENCE_IDS.some((issue) => issue === id))).toEqual(
          cause === 'failed' ? ['render-failed'] : [],
        )
        expect(stored.auditSnapshot?.unobserved).toEqual(
          expect.arrayContaining(RENDER_DIFFERENCE_IDS.filter((id) => id !== 'render-failed')),
        )
      } else expect(home).toContain('title-changed-by-javascript')
      expect(stored.auditSnapshot?.unobserved).not.toContain('render-failed')
      if (iteration > 0) {
        const comparison = await compareWithPrevious({ db, target: stored, exact: true })
        expect(comparison.byIssue.get('title-changed-by-javascript')?.unverified).toBeGreaterThan(0)
        expect(comparison.byIssue.get('title-changed-by-javascript')).toMatchObject({
          fresh: 0,
          back: 0,
          resolved: 0,

          reasons: ['unobserved'],
        })
      }
    }
    // With the same rendered input but HTML mode, every JavaScript issue is still unknown.
    const html = snapshots[0]!
    await analyseCrawl(db, html.id, { ...html.auditSnapshot!, rendering: undefined })
    // The persisted crawl mode, not a caller's supplied snapshot, decides what was observed.
    expect((await db.crawls.get(html.id))?.auditSnapshot?.rendering).toBe('rendered')
  },
)
