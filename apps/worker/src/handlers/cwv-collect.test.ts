import {
  createLogger,
  createSettings,
  emptyVitals,
  GOOGLE_VITALS_KEY,
  JOB_TYPES,
} from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runCrawl } from '../crawl/engine'
import { fakeSite } from '../crawl/fake-site'
import type { AuditedUrl } from '../crawl/site-audit'
import { SITE, page } from '../crawl/test-site'
import { ANALYSIS_WAIT_MS } from '../alerts/run'
import { JobDeferredError, JobInterruptedError } from '../types'
import { createCwvCollectHandler, selectVitalsPages } from './cwv-collect'
let db: Database
let crawlId: string
let domainId: string
const log = createLogger('test', 'silent')
const signal = () => new AbortController().signal
const settings = () => createSettings(db.settings, 'test-secret')
beforeEach(async () => {
  db = await createTestDatabase()
  const created = await createCompany(db, { name: 'Test', domain: 'example.com' })
  if (!created.ok) throw new Error('setup')
  domainId = created.domain.id
  const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
  if (!crawl) throw new Error('setup')
  crawlId = crawl.id
  await runCrawl(crawlId, {
    db,
    log,
    signal: signal(),
    createFetcher: fakeSite({ [SITE + '/']: page('/') }, 0).createFetcher,
    retryBaseMs: 1,
  })
})
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await db.close()
})
async function job() {
  return db.jobs.enqueue({ type: JOB_TYPES.cwvCollect, payload: { crawlId } })
}
const body = { record: { metrics: { largest_contentful_paint: { percentiles: { p75: 4500 } } } } }
it('paces field requests, persists results, resumes after shutdown, and reanalyses', async () => {
  await settings().setJson(GOOGLE_VITALS_KEY, 'key', { encrypted: true })
  const times: number[] = []
  const stop = new AbortController()
  const fetcher = vi.fn<typeof fetch>(async () => {
    times.push(Date.now())
    if (times.length === 2) stop.abort()
    return new Response(JSON.stringify(body))
  })
  vi.stubGlobal('fetch', fetcher)
  vi.useFakeTimers()
  const handler = createCwvCollectHandler({ db, settings: settings(), paused: false })
  const pending = expect(
    handler(await job(), { log, signal: stop.signal, getMailer: async () => null }),
  ).rejects.toBeInstanceOf(JobInterruptedError)
  await vi.runAllTimersAsync()
  await pending
  expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(500)
  const before = await db.vitals.origins(crawlId)
  expect(before.some((row) => row.formFactor === 'PHONE')).toBe(true)
  fetcher.mockImplementation(async () => new Response(JSON.stringify(body)))
  const resumed = handler(await job(), { log, signal: signal(), getMailer: async () => null })
  await vi.runAllTimersAsync()
  await resumed
  expect((await db.vitals.origins(crawlId)).find((row) => row.formFactor === 'all')?.status).toBe(
    'collected',
  )
  expect((await db.crawls.issueCounts(crawlId)).some((row) => row.issue === 'lcp-poor')).toBe(true)
  expect((await db.crawls.get(crawlId))?.auditSnapshot?.unobserved ?? []).not.toContain('lcp-poor')
})
it('sends nothing without a key or when paused', async () => {
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetcher)
  await createCwvCollectHandler({ db, settings: settings(), paused: false })(await job(), {
    log,
    signal: signal(),
    getMailer: async () => null,
  })
  await settings().setJson(GOOGLE_VITALS_KEY, 'key', { encrypted: true })
  await createCwvCollectHandler({ db, settings: settings(), paused: true })(await job(), {
    log,
    signal: signal(),
    getMailer: async () => null,
  })
  expect(fetcher).not.toHaveBeenCalled()
  expect(await db.vitals.origins(crawlId)).toEqual([])
})
it('retains no-data rows and limits lab requests to the first 50 priorities', async () => {
  await settings().setJson(GOOGLE_VITALS_KEY, 'key', { encrypted: true })
  for (const formFactor of ['PHONE', 'DESKTOP'])
    await db.vitals.saveOrigin({
      ...emptyVitals(),
      crawlId,
      formFactor,
      status: 'no-data',
      error: null,
      collectedAt: new Date(),
    })
  for (let i = 0; i < 51; i++)
    await db.priorityUrls.add({ domainId, url: `https://example.com/priority-${i}` })
  const fetcher = vi.fn<typeof fetch>(async (input) =>
    String(input).includes('pagespeedonline')
      ? new Response(JSON.stringify({ lighthouseResult: { audits: {} } }))
      : new Response('', { status: 404 }),
  )
  vi.stubGlobal('fetch', fetcher)
  vi.useFakeTimers()
  const pending = createCwvCollectHandler({ db, settings: settings(), paused: false })(
    await job(),
    { log, signal: signal(), getMailer: async () => null },
  )
  await vi.runAllTimersAsync()
  await pending
  expect(fetcher).toHaveBeenCalledTimes(51)
  const lab = fetcher.mock.calls
    .map(([url]) => new URL(String(url)))
    .filter((url) => url.hostname === 'www.googleapis.com')
  expect(lab).toHaveLength(50)
  expect(lab.map((url) => url.searchParams.get('url'))).toEqual(
    (await db.priorityUrls.list(domainId)).slice(0, 50).map((row) => row.url),
  )
})

it('skips an archived domain and a removed key', async () => {
  await settings().setJson(GOOGLE_VITALS_KEY, 'key', { encrypted: true })
  await db.domains.archive(domainId)
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetcher)
  await createCwvCollectHandler({ db, settings: settings(), paused: false })(await job(), {
    log,
    signal: signal(),
    getMailer: async () => null,
  })
  await settings().delete(GOOGLE_VITALS_KEY)
  expect(fetcher).not.toHaveBeenCalled()
})

it('caps field URLs at 1000, puts priority first, then click depth, and excludes non-indexable URLs', () => {
  const urls = Array.from(
    { length: 1005 },
    (_, i) =>
      ({
        internal: true,
        contentPage: i !== 1002,
        indexable: i !== 1004,
        clickDepth: i,
        url: { urlHash: String(i).padStart(4, '0') },
      }) as AuditedUrl,
  )
  const selected = selectVitalsPages(urls, new Set(['1003', '1004']))
  expect(selected).toHaveLength(1000)
  expect(selected.slice(0, 3).map((page) => page.url.urlHash)).toEqual(['1003', '0000', '0001'])
  expect(selected.some((page) => page.url.urlHash === '1004')).toBe(false)
})

it('backs off quota responses and finishes from recorded answers', async () => {
  await settings().setJson(GOOGLE_VITALS_KEY, 'key', { encrypted: true })
  const times: number[] = []
  const fetcher = vi.fn<typeof fetch>(async () => {
    times.push(Date.now())
    return times.length === 1
      ? new Response('', { status: 429 })
      : new Response(JSON.stringify(body))
  })
  vi.stubGlobal('fetch', fetcher)
  vi.useFakeTimers()
  const pending = createCwvCollectHandler({ db, settings: settings(), paused: false })(
    await job(),
    { log, signal: signal(), getMailer: async () => null },
  )
  await vi.runAllTimersAsync()
  await pending
  expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(60_000)
  expect((await db.vitals.origins(crawlId)).find((row) => row.formFactor === 'all')?.status).toBe(
    'collected',
  )
})

it('defers before initial analysis saves, then collects after it saves', async () => {
  await settings().setJson(GOOGLE_VITALS_KEY, 'key', { encrypted: true })
  const crawl = (await db.crawls.get(crawlId))!
  const get = vi
    .spyOn(db.crawls, 'get')
    .mockResolvedValue({ ...crawl, auditSnapshot: null, pagesByWorstIssue: null })
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)))
  vi.stubGlobal('fetch', fetcher)
  const handler = createCwvCollectHandler({ db, settings: settings(), paused: false })
  await expect(
    handler(await job(), { log, signal: signal(), getMailer: async () => null }),
  ).rejects.toBeInstanceOf(JobDeferredError)
  expect(fetcher).not.toHaveBeenCalled()
  expect(await db.vitals.origins(crawlId)).toEqual([])
  get.mockRestore()
  vi.useFakeTimers()
  const pending = handler(await job(), { log, signal: signal(), getMailer: async () => null })
  await vi.runAllTimersAsync()
  await pending
  expect((await db.crawls.issueCounts(crawlId)).some((row) => row.issue === 'lcp-poor')).toBe(true)
})

it('continues after bad field URLs and lab errors without failing the field status', async () => {
  await settings().setJson(GOOGLE_VITALS_KEY, 'key', { encrypted: true })
  await db.priorityUrls.add({ domainId, url: 'https://example.com/bad' })
  let calls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => {
      calls++
      return calls <= 2
        ? new Response(JSON.stringify(body))
        : new Response('{}', { status: calls === 3 ? 500 : 404 })
    }),
  )
  vi.useFakeTimers()
  const pending = createCwvCollectHandler({ db, settings: settings(), paused: false })(
    await job(),
    { log, signal: signal(), getMailer: async () => null },
  )
  await vi.runAllTimersAsync()
  await pending
  expect(calls).toBe(4)
  expect((await db.vitals.origins(crawlId)).find((row) => row.formFactor === 'all')?.status).toBe(
    'collected',
  )
  expect((await db.vitals.urls(crawlId)).map((row) => row.status)).toEqual(['no-data', 'no-data'])
})

it('defers repeated quota responses without reanalysis and honours Retry-After', async () => {
  await settings().setJson(GOOGLE_VITALS_KEY, 'key', { encrypted: true })
  const times: number[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => {
      times.push(Date.now())
      return new Response('{}', { status: 429, headers: { 'Retry-After': '70' } })
    }),
  )
  vi.useFakeTimers()
  const pending = expect(
    createCwvCollectHandler({ db, settings: settings(), paused: false })(await job(), {
      log,
      signal: signal(),
      getMailer: async () => null,
    }),
  ).rejects.toMatchObject({ delayMs: 70_000 })
  await vi.runAllTimersAsync()
  await pending
  expect(times).toHaveLength(3)
  expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(70_000)
  expect(await db.vitals.origins(crawlId)).toEqual([])
})

it.each(['before', 'after'] as const)(
  'runs collection %s the engine analysis without losing findings',
  async (order) => {
    await settings().setJson(GOOGLE_VITALS_KEY, 'key', { encrypted: true })
    const next = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    if (!next) throw new Error('setup')
    crawlId = next.id
    const handler = createCwvCollectHandler({ db, settings: settings(), paused: false })
    const ctx = { log, signal: signal(), getMailer: async () => null }
    const finish = db.crawls.finish.bind(db.crawls)
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)))
    vi.stubGlobal('fetch', fetcher)
    const spy = vi.spyOn(db.crawls, 'finish').mockImplementation(async (...args) => {
      const finished = await finish(...args)
      if (order === 'before') {
        await expect(handler(await job(), ctx)).rejects.toBeInstanceOf(JobDeferredError)
        expect(fetcher).not.toHaveBeenCalled()
      }
      return finished
    })
    await runCrawl(crawlId, {
      db,
      log,
      signal: signal(),
      createFetcher: fakeSite({ [SITE + '/']: page('/') }, 0).createFetcher,
      retryBaseMs: 1,
    })
    spy.mockRestore()
    vi.useFakeTimers()
    const pending = handler(await job(), ctx)
    await vi.runAllTimersAsync()
    await pending
    expect((await db.crawls.issueCounts(crawlId)).some((row) => row.issue === 'lcp-poor')).toBe(
      true,
    )
  },
)

it('keeps an older crawl configuration when the current rules exclude its home page', async () => {
  await settings().setJson(GOOGLE_VITALS_KEY, 'key', { encrypted: true })
  const old = crawlId
  const next = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
  if (!next) throw new Error('setup')
  await runCrawl(next.id, {
    db,
    log,
    signal: signal(),
    createFetcher: fakeSite({ [SITE + '/']: page('/') }, 0).createFetcher,
    retryBaseMs: 1,
  })
  await db.audit.saveRule({
    domainId,
    rule: {
      selector: { kind: 'prefix', path: '/', query: { mode: 'any' }, scope: 'literal' },
      dimension: 'audit',
      value: 'exclude',
      enabled: true,
      reason: null,
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body))),
  )
  vi.useFakeTimers()
  const handler = createCwvCollectHandler({ db, settings: settings(), paused: false })
  const pending = handler(await job(), { log, signal: signal(), getMailer: async () => null })
  await vi.runAllTimersAsync()
  await pending
  expect((await db.crawls.issueCounts(old)).some((row) => row.issue === 'lcp-poor')).toBe(true)
  crawlId = next.id
  const latest = handler(await job(), { log, signal: signal(), getMailer: async () => null })
  await vi.runAllTimersAsync()
  await latest
  expect((await db.crawls.issueCounts(next.id)).some((row) => row.issue === 'lcp-poor')).toBe(false)
  expect((await db.crawls.get(next.id))?.auditVersion).toBe(
    (await db.audit.config(domainId)).version,
  )
})

it('gives up on a crawl whose analysis never arrives', async () => {
  await settings().setJson(GOOGLE_VITALS_KEY, 'key', { encrypted: true })
  const crawl = (await db.crawls.get(crawlId))!
  const finishedAt = new Date(Date.now() - ANALYSIS_WAIT_MS - 1000)
  vi.spyOn(db.crawls, 'get').mockResolvedValue({
    ...crawl,
    finishedAt,
    auditSnapshot: null,
    pagesByWorstIssue: null,
  })
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)))
  vi.stubGlobal('fetch', fetcher)
  const handler = createCwvCollectHandler({ db, settings: settings(), paused: false })
  await expect(
    handler(await job(), { log, signal: signal(), getMailer: async () => null }),
  ).resolves.toBeUndefined()
  expect(fetcher).not.toHaveBeenCalled()
})

it('queues vitals alerts after reanalysis only for a regression against collected origin data', async () => {
  await settings().setJson(GOOGLE_VITALS_KEY, 'key', { encrypted: true })
  await db.vitals.saveOrigin({
    ...emptyVitals(),
    crawlId,
    formFactor: 'PHONE',
    lcp: 2000,
    status: 'collected',
    error: null,
    collectedAt: new Date(),
  })
  const next = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
  if (!next) throw new Error('setup')
  await runCrawl(next.id, {
    db,
    log,
    signal: signal(),
    createFetcher: fakeSite({ [SITE + '/']: page('/') }, 0).createFetcher,
    retryBaseMs: 1,
  })
  crawlId = next.id
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body))),
  )
  vi.useFakeTimers()
  const handler = createCwvCollectHandler({ db, settings: settings(), paused: false })
  const pending = handler(await job(), { log, signal: signal(), getMailer: async () => null })
  await vi.runAllTimersAsync()
  await pending
  expect((await db.jobs.list()).filter((j) => j.type === JOB_TYPES.vitalsAlerts)).toHaveLength(1)
  const retried = handler(await job(), { log, signal: signal(), getMailer: async () => null })
  await vi.runAllTimersAsync()
  await retried
  expect((await db.jobs.list()).filter((j) => j.type === JOB_TYPES.vitalsAlerts)).toHaveLength(1)
})
