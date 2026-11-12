import { createLogger, type Job } from '@seotools/core'
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
