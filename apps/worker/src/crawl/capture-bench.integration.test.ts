import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import puppeteer, { type Browser } from 'puppeteer-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLogger } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { createRenderService } from '../render/service'
import { runCrawl } from './engine'
import { nuxtSite } from './nuxt-site'

const shellDirectory = chromium
  .executablePath()
  .replace(/chromium-(\d+)[/\\].*$/, 'chromium_headless_shell-$1')
const executable = existsSync(shellDirectory)
  ? readdirSync(shellDirectory, { recursive: true }).find(
      (path) =>
        typeof path === 'string' && /(?:^|[/\\])chrome-headless-shell(?:\.exe)?$/.test(path),
    )
  : undefined
const executablePath = typeof executable === 'string' ? join(shellDirectory, executable) : ''

/**
 * Pages per minute of a rendered crawl of the Nuxt-like site, at 5 requests per second. Slow (it
 * crawls the site four times), so it runs only on request: `RENDER_BENCH=1`.
 */
describe.skipIf(!process.env.RENDER_BENCH || !executablePath || !existsSync(executablePath))(
  'rendered crawl throughput',
  () => {
    let browser: Browser
    beforeAll(async () => {
      browser = await puppeteer.launch({
        executablePath,
        headless: true,
        args: [
          '--remote-debugging-port=0',
          '--no-sandbox',
          '--site-per-process',
          '--proxy-server=http://127.0.0.1:9',
          '--proxy-bypass-list=<-loopback>',
          '--host-resolver-rules=MAP * ~NOTFOUND',
          '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        ],
      })
    }, 60000)
    afterAll(async () => {
      await browser?.close()
    })
    it.each([2, 4])(
      'renders at concurrency %i',
      async (concurrency) => {
        const db: Database = await createTestDatabase()
        const created = await createCompany(db, {
          name: `Bench ${concurrency}`,
          domain: 'example.com',
        })
        if (!created.ok) throw new Error('setup failed')
        const domainId = created.domain.id
        await db.crawls.saveSettings(domainId, {
          ...(await db.crawls.settings(domainId)),
          renderingMode: 'headless',
          renderWaitMs: 5000,
          requestsPerSecond: 5,
          concurrency,
          maxRetries: 0,
          retainCrawls: null,
        })
        const service = createRenderService({
          browserUrl: `http://127.0.0.1:${new URL(browser.wsEndpoint()).port}`,
          concurrency,
          writeStatus: async () => {},
        })
        const site = nuxtSite({ pages: 16 })
        const crawl = (await db.crawls.start({ domainId, type: 'full', trigger: 'manual' }))!
        const started = Date.now()
        await runCrawl(crawl.id, {
          db,
          log: createLogger('bench', 'silent'),
          createFetcher: site.createFetcher,
          signal: new AbortController().signal,
          renderService: service,
        })
        const minutes = (Date.now() - started) / 60000
        await service.close()
        const stored = (await db.crawls.get(crawl.id))!
        const renders = await db.crawls.renders(crawl.id)
        const states = renders.reduce<Record<string, number>>((counts, render) => {
          const key = render.status === 'failed' ? 'failed' : render.settled ? 'settled' : 'loading'
          counts[key] = (counts[key] ?? 0) + 1
          return counts
        }, {})
        console.log(
          JSON.stringify({
            concurrency,
            pages: stored.pagesCount,
            minutes: Number(minutes.toFixed(2)),
            pagesPerMinute: Number((stored.pagesCount / minutes).toFixed(1)),
            renders: states,
          }),
        )
        await db.close()
        expect(stored.status).toBe('completed')
      },
      30 * 60_000,
    )
  },
)
