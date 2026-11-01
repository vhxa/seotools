import { createLogger } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FetchedResponse, Fetcher, FetcherConfig } from '../crawl/fetcher'
import { FetchError } from '../crawl/fetcher'
import {
  FAVICON_REFRESH_INTERVAL_MS,
  FAVICON_RETRY_INTERVAL_MS,
  createFaviconRefresher,
} from './refresh'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9])
const log = createLogger('test', 'silent')
const start = new Date('2026-06-15T10:00:00Z')

type Site = 'with-icon' | 'no-icon' | 'down'

let db: Database
let clock: Date
let site: Site
let configs: Omit<FetcherConfig, 'allowPrivateNetworks'>[]
let closed: number

const response = (overrides: Partial<FetchedResponse>): FetchedResponse => ({
  statusCode: 200,
  headers: {},
  body: null,
  truncated: false,
  bytes: null,
  responseTimeMs: 1,
  ...overrides,
})

/** Serves `https://example.com/` and its `/icon.png`, or nothing, depending on `site`. */
const createFetcher = (config: Omit<FetcherConfig, 'allowPrivateNetworks'>): Fetcher => {
  configs.push(config)
  return {
    close: () => void closed++,
    async fetch(url) {
      if (site === 'down') throw new FetchError('ECONNREFUSED', 'refused')
      if (url === 'https://example.com/') {
        const link = site === 'with-icon' ? '<link rel="icon" href="/icon.png">' : ''
        return response({
          headers: { 'content-type': 'text/html' },
          body: Buffer.from(`<html><head>${link}</head></html>`),
        })
      }
      if (url === 'https://example.com/icon.png' && site === 'with-icon') {
        return response({ headers: { 'content-type': 'image/png' }, body: PNG })
      }
      return response({ statusCode: 404, headers: { 'content-type': 'text/html' } })
    },
  }
}

const refresher = () =>
  createFaviconRefresher({ db, log, createFetcher, appVersion: '1.2.3', now: () => clock })

let domainId: string
beforeEach(async () => {
  db = await createTestDatabase()
  clock = start
  site = 'with-icon'
  configs = []
  closed = 0
  const created = await createCompany(db, { name: 'Acme', domain: 'example.com' })
  if (!created.ok) throw new Error('setup failed')
  domainId = created.domain.id
})
afterEach(async () => {
  await db.close()
})

describe('createFaviconRefresher', () => {
  it('stores the icon of a new domain, and leaves it alone until a day has passed', async () => {
    await refresher().tick()
    expect((await db.favicons.get(domainId))?.data.equals(PNG)).toBe(true)
    expect(closed).toBe(1)

    configs = []
    const same = refresher()
    await same.tick()
    clock = new Date(start.getTime() + FAVICON_REFRESH_INTERVAL_MS - 1000)
    await same.tick()
    expect(configs).toEqual([])

    clock = new Date(start.getTime() + FAVICON_REFRESH_INTERVAL_MS + 1000)
    await same.tick()
    expect(configs).toHaveLength(1)
  })

  it('picks up a changed icon, and the loss of one', async () => {
    const r = refresher()
    await r.tick()
    const before = await db.favicons.get(domainId)

    site = 'no-icon'
    clock = new Date(start.getTime() + FAVICON_REFRESH_INTERVAL_MS + 1000)
    await r.tick()
    expect(before).not.toBeNull()
    expect(await db.favicons.get(domainId)).toBeNull()
    expect((await db.favicons.versions()).size).toBe(0)
  })

  it('keeps the icon when the site is down, and retries within the hour', async () => {
    const r = refresher()
    await r.tick()

    site = 'down'
    clock = new Date(start.getTime() + FAVICON_REFRESH_INTERVAL_MS + 1000)
    await r.tick()
    expect((await db.favicons.get(domainId))?.data.equals(PNG)).toBe(true)

    configs = []
    clock = new Date(clock.getTime() + FAVICON_RETRY_INTERVAL_MS - 1000)
    await r.tick()
    expect(configs).toEqual([])
    site = 'with-icon'
    clock = new Date(clock.getTime() + 2000)
    await r.tick()
    expect(configs).toHaveLength(1)
  })

  it('identifies itself like the crawler, honouring the domain settings, with a short timeout', async () => {
    await db.crawls.saveSettings(domainId, {
      renderingMode: 'http',
      userAgent: null,
      concurrency: 2,
      requestsPerSecond: 5,
      timeoutMs: 60_000,
      maxRetries: 2,
      maxUrls: null,
      retainCrawls: null,
    })
    await refresher().tick()
    expect(configs[0]).toMatchObject({
      userAgent: expect.stringContaining('SeoToolsBot/1.2.3'),
      timeoutMs: 15_000,
      concurrency: 1,
    })

    await db.crawls.saveSettings(domainId, {
      renderingMode: 'http',
      userAgent: 'MyBot/9',
      concurrency: 2,
      requestsPerSecond: 5,
      timeoutMs: 3000,
      maxRetries: 2,
      maxUrls: null,
      retainCrawls: null,
    })
    clock = new Date(start.getTime() + FAVICON_REFRESH_INTERVAL_MS + 1000)
    await refresher().tick()
    expect(configs[1]).toMatchObject({ userAgent: 'MyBot/9', timeoutMs: 3000 })
  })

  it('does not run two passes at once', async () => {
    const r = refresher()
    await Promise.all([r.tick(), r.tick(), r.tick()])
    expect(configs).toHaveLength(1)
  })

  it('does nothing once told to stop', async () => {
    const r = refresher()
    const stopped = r.stop()
    await r.tick()
    await stopped
    expect(configs).toEqual([])
    expect(await db.favicons.get(domainId)).toBeNull()
  })
})
