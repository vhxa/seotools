import { createLogger, domainRequestSettings, type Job } from '@seotools/core'
import { BOT_USER_AGENTS } from '@seotools/core/bot-access'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FetchError, type Fetcher } from '../crawl/fetcher'
import { JobDeferredError, JobInterruptedError } from '../types'
import { createBotTestHandler } from './bot-test'
let db: Database
let domainId: string
let runId: string
beforeEach(async () => {
  db = await createTestDatabase()
  const made = await createCompany(db, { name: 'Acme', domain: 'example.com' })
  if (!made.ok) throw new Error('setup failed')
  domainId = made.domain.id
  await db.crawls.saveSettings(domainId, {
    ...(await db.crawls.settings(domainId)),
    requestsPerSecond: 1000,
    maxRetries: 0,
  })
  runId = (await db.botTests.start({ domainId, requestedBy: 'editor' }))!.id
})
afterEach(async () => db.close())
const ctx = () => ({
  log: createLogger('test', 'silent'),
  signal: new AbortController().signal,
  getMailer: async () => null,
})
const job = () => ({ id: 'job', payload: { runId }, attempts: 1, maxAttempts: 3 }) as Job
const response = (statusCode = 200) => ({
  statusCode,
  headers: {},
  body: Buffer.from('ok'),
  bytes: 2,
  truncated: false,
  responseTimeMs: 1,
})
const make = (fetch: Fetcher['fetch']) =>
  createBotTestHandler({
    db,
    allowPrivateNetworks: false,
    createFetcher: () => ({ fetch, close() {} }),
  })
it('compares bot 403 against baseline OK and requests only the homepage', async () => {
  let n = 0
  const fetch = vi.fn(async () => response(n++ === 1 ? 403 : 200))
  await make(fetch)(job(), ctx())
  const results = await db.botTests.results(runId)
  expect(results.find((row) => row.botToken === BOT_USER_AGENTS[0].token)).toMatchObject({
    verdict: 'different',
    statusCode: 403,
  })
  expect(fetch.mock.calls).toHaveLength(BOT_USER_AGENTS.length + 1)
  expect((await db.botTests.get(runId))?.status).toBe('done')
})
it('reports all unknown when baseline fails', async () => {
  let n = 0
  await make(async () => {
    if (n++ === 0) throw new FetchError('ENOTFOUND', 'DNS')
    return response()
  })(job(), ctx())
  expect((await db.botTests.results(runId)).every((row) => row.verdict === 'unknown')).toBe(true)
})
it('resumes partial results without requesting saved identities', async () => {
  await db.botTests.record({
    runId,
    botToken: 'baseline',
    statusCode: 200,
    finalUrl: 'https://example.com/',
    responseTimeMs: 1,
    bytes: 2,
    errorCode: null,
    verdict: 'unknown',
    reasons: [],
  })
  const fetch = vi.fn(async () => response())
  await make(fetch)(job(), ctx())
  expect(fetch).toHaveBeenCalledTimes(BOT_USER_AGENTS.length)
})
it('defers for a crawl and while paused without making requests', async () => {
  const fetch = vi.fn(async () => response())
  await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
  await expect(make(fetch)(job(), ctx())).rejects.toBeInstanceOf(JobDeferredError)
  expect(fetch).not.toHaveBeenCalled()
})
it('hands back interrupted work and ignores archived domains', async () => {
  const context = ctx(),
    stop = new AbortController()
  stop.abort()
  await expect(
    make(async () => response())(job(), { ...context, signal: stop.signal }),
  ).rejects.toBeInstanceOf(JobInterruptedError)
  await db.domains.archive(domainId)
  const fetch = vi.fn(async () => response())
  await make(fetch)(job(), ctx())
  expect(fetch).not.toHaveBeenCalled()
})

it('uses domain settings and changes only the user agent while following redirects', async () => {
  const settings = await db.crawls.settings(domainId)
  await db.crawls.saveSettings(domainId, {
    ...settings,
    userAgent: 'Custom baseline',
    timeoutMs: 12345,
  })
  const agents: string[] = []
  const urls: string[] = []
  const handler = createBotTestHandler({
    db,
    allowPrivateNetworks: false,
    createFetcher: (config) => {
      agents.push(config.userAgent)
      expect(config.timeoutMs).toBe(12345)
      expect(config.concurrency).toBe(settings.concurrency)
      return {
        close() {},
        fetch: async (url) => {
          urls.push(url)
          return url.endsWith('/home')
            ? response()
            : { ...response(301), headers: { location: '/home' } }
        },
      }
    },
  })
  await handler(job(), ctx())
  expect(agents).toEqual(['Custom baseline', ...BOT_USER_AGENTS.map((bot) => bot.userAgent)])
  expect(new Set(urls)).toEqual(new Set(['https://example.com/', 'https://example.com/home']))
  expect(
    (await db.botTests.results(runId)).every((row) => row.finalUrl === 'https://example.com/home'),
  ).toBe(true)
})
it('pauses automation without spending requests', async () => {
  const fetch = vi.fn(async () => response())
  const handler = createBotTestHandler({
    db,
    paused: true,
    allowPrivateNetworks: false,
    createFetcher: () => ({ fetch, close() {} }),
  })
  await expect(handler(job(), ctx())).rejects.toBeInstanceOf(JobDeferredError)
  expect(fetch).not.toHaveBeenCalled()
})
it('keeps an interrupted request unsaved for resume', async () => {
  const stop = new AbortController()
  const handler = make(async () => {
    stop.abort()
    throw new FetchError('ABORT_ERR', 'stopped')
  })
  await expect(handler(job(), { ...ctx(), signal: stop.signal })).rejects.toBeInstanceOf(
    JobInterruptedError,
  )
  expect(await db.botTests.results(runId)).toEqual([])
  expect((await db.botTests.get(runId))?.status).toBe('running')
})
it('steps aside if a crawl starts after the baseline', async () => {
  let n = 0
  const fetch = vi.fn(async () => {
    if (n++ === 0) await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    return response()
  })
  await expect(make(fetch)(job(), ctx())).rejects.toBeInstanceOf(JobDeferredError)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('preserves credentials but prevents a custom header from overriding the tested UA', async () => {
  await domainRequestSettings(db.crawls, domainId, 'test-key').setJson(
    'request',
    {
      headers: [
        { name: 'User-Agent', value: 'Override' },
        { name: 'Cookie', value: 'staging=yes' },
      ],
      username: 'user',
      password: 'secret',
    },
    { encrypted: true },
  )
  const configs: string[] = []
  const handler = createBotTestHandler({
    db,
    settingsSecret: 'test-key',
    allowPrivateNetworks: false,
    createFetcher: (config) => {
      expect(config.siteHeaders?.headers).toEqual({
        cookie: 'staging=yes',
        authorization: 'Basic dXNlcjpzZWNyZXQ=',
      })
      configs.push(config.userAgent)
      return { fetch: async () => response(), close() {} }
    },
  })
  await handler(job(), ctx())
  expect(configs.slice(1)).toEqual(BOT_USER_AGENTS.map((bot) => bot.userAgent))
})
