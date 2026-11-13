import { createLogger, crawlUrlHash } from '@seotools/core'
import { createCompany } from '@seotools/db'
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
