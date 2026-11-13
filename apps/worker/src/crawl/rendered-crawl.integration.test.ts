import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import puppeteer, { type Browser } from 'puppeteer-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLogger, crawlUrlHash } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { createRenderService, type RenderService } from '../render/service'
import { runCrawl } from './engine'
import { fakeSite } from './fake-site'
import { htmlBaseline } from './html-baseline'
import { SITE, page, xml, sitemapOf } from './test-site'

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

describe.skipIf(!executablePath || !existsSync(executablePath))(
  'rendered crawl with isolated Chromium',
  () => {
    let browser: Browser
    let service: RenderService
    let db: Database
    let domainId: string
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
      service = createRenderService({
        browserUrl: `http://127.0.0.1:${new URL(browser.wsEndpoint()).port}`,
        concurrency: 2,
        writeStatus: async () => {},
      })
      db = await createTestDatabase()
      const created = await createCompany(db, { name: 'Chromium', domain: 'example.com' })
      if (!created.ok) throw new Error('setup failed')
      domainId = created.domain.id
      await db.crawls.saveSettings(domainId, {
        ...(await db.crawls.settings(domainId)),
        renderingMode: 'headless',
        renderWaitMs: 1000,
        requestsPerSecond: 100,
        maxRetries: 0,
        retainCrawls: null,
      })
    }, 60000)
    afterAll(async () => {
      await service?.close()
      await browser?.close()
      await db?.close()
    })
    it('three real JavaScript-menu crawls have identical findings, accepted rows, counts and snapshot', async () => {
      let previous: unknown
      for (let iteration = 0; iteration < 3; iteration++) {
        const site = fakeSite(
          {
            [`${SITE}/`]: page('/', { links: '', head: '<script src="/menu.js" defer></script>' }),
            [`${SITE}/menu.js`]: {
              statusCode: 200,
              headers: { 'content-type': 'application/javascript' },
              body: Buffer.from(
                `const a=document.createElement('a');a.href='/menu';a.textContent='Menu';document.body.append(a)`,
              ),
            },
            [`${SITE}/menu`]: page('/menu'),
            [`${SITE}/sitemap.xml`]: xml(sitemapOf(['/menu'])),
          },
          0,
        )
        const crawl = (await db.crawls.start({ domainId, type: 'full', trigger: 'manual' }))!
        await runCrawl(crawl.id, {
          db,
          log: createLogger('test', 'silent'),
          createFetcher: site.createFetcher,
          renderService: service,
          signal: new AbortController().signal,
          browserMaxWaitMs: 0,
        })
        expect((await db.crawls.get(crawl.id))?.status).toBe('completed')
        const menu = await db.crawls.issuesOf(crawl.id, [crawlUrlHash(`${SITE}/menu`)])
        expect(menu.map((row) => row.issue)).toContain('linked-only-by-javascript')
        expect(menu.map((row) => row.issue)).not.toContain('orphan-in-sitemap')
        const home = await db.crawls.issuesOf(crawl.id, [crawlUrlHash(`${SITE}/`)])
        expect(home.map((row) => row.issue)).toContain('links-only-after-rendering')
        const result = await htmlBaseline(db, crawl.id)
        if (previous) expect(JSON.stringify(result)).toBe(JSON.stringify(previous))
        previous = result
      }
    }, 120000)
  },
)
