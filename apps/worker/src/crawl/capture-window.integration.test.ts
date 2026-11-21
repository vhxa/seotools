import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import puppeteer, { type Browser } from 'puppeteer-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLogger, crawlUrlHash } from '@seotools/core'
import { CURRENT_CAPTURE_RULE } from '@seotools/core/crawl/render-state'
import { compareWithPrevious, createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { createRenderService, type RenderService } from '../render/service'
import { RENDER_LIMITS } from '../render/limits'
import { runCrawl, type CrawlEngineOptions } from './engine'
import { nuxtSite, NUXT_TIMINGS } from './nuxt-site'
import { RENDERED_GRAPH_ISSUES } from './observed-inputs'
import { SITE } from './test-site'

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

/** How late after the end of the window a capture may happen: polling and the DOM snapshot. */
const MARGIN_MS = 400
const WINDOW_MS = 5000

describe.skipIf(!executablePath || !existsSync(executablePath))(
  'capture window on a Nuxt-like site',
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
      const created = await createCompany(db, { name: 'Nuxt', domain: 'example.com' })
      if (!created.ok) throw new Error('setup failed')
      domainId = created.domain.id
    }, 60000)
    afterAll(async () => {
      await service?.close()
      await browser?.close()
      await db?.close()
    })

    async function crawl(options: { waitMs?: number; stuck?: boolean; timeoutMs?: number } = {}) {
      await db.crawls.saveSettings(domainId, {
        ...(await db.crawls.settings(domainId)),
        renderingMode: 'headless',
        renderWaitMs: options.waitMs ?? WINDOW_MS,
        requestsPerSecond: 50,
        concurrency: 2,
        timeoutMs: options.timeoutMs ?? 15000,
        maxRetries: 0,
        retainCrawls: null,
      })
      const site = nuxtSite({ pages: 3, stuck: options.stuck })
      const renderService: CrawlEngineOptions['renderService'] = {
        check: service.check,
        concurrency: service.concurrency,
        // The DOM of `/stuck` never parses: give up on it sooner than the 25 s of production.
        render: (input) => service.render({ ...input, loadGraceMs: 3000 }),
      }
      const started = (await db.crawls.start({ domainId, type: 'full', trigger: 'manual' }))!
      await runCrawl(started.id, {
        db,
        log: createLogger('test', 'silent'),
        createFetcher: site.createFetcher,
        signal: new AbortController().signal,
        renderService,
      })
      const stored = (await db.crawls.get(started.id))!
      const hashes = new Map(site.paths.map((path) => [crawlUrlHash(`${SITE}${path}`), path]))
      const findings = (await db.crawls.issuesOf(stored.id, [...hashes.keys()]))
        .map((row) => `${hashes.get(row.urlHash)} ${row.issue}`)
        .sort()
      const renders = await db.crawls.renders(stored.id)
      return { crawl: stored, site, hashes, findings, renders }
    }
    const has = (findings: string[], path: string, issue: string) =>
      findings.includes(`${path} ${issue}`)

    it('captures at the window after the DOM is parsed and gives the same findings three times', async () => {
      const runs = [await crawl(), await crawl(), await crawl()]
      for (const run of runs) {
        expect(run.crawl.status).toBe('completed')
        // Every page, including the one only JavaScript links to, was found and rendered.
        expect(run.renders).toHaveLength(run.site.paths.length)
        for (const render of run.renders) {
          expect(render.status, render.finalUrl).toBe('rendered')
          // A request never ends: every capture is at the window's end, whatever was queued
          // before the DOM was parsed (about 75 resources of 200–800 ms each).
          expect(render.settled).toBe(false)
          expect(render.data.capture?.pending).toBeGreaterThanOrEqual(1)
          expect(render.data.capture?.afterMs).toBeGreaterThanOrEqual(WINDOW_MS)
          expect(render.data.capture?.afterMs).toBeLessThanOrEqual(WINDOW_MS + MARGIN_MS)
          expect(render.truncated).toBe(false)
        }
        // Captures made while loading are observations: nothing is unknown for the crawl.
        const unobserved = run.crawl.auditSnapshot?.unobserved ?? []
        for (const issue of ['title-changed-by-javascript', ...RENDERED_GRAPH_ISSUES])
          expect(unobserved).not.toContain(issue)
        expect(run.crawl.auditSnapshot?.rendersUnobserved).toBe(0)
        expect(run.crawl.auditSnapshot?.renderCoverage?.unsettled).toBe(run.site.paths.length)
        // What happened within the window is reported.
        expect(has(run.findings, '/p/1', 'title-changed-by-javascript')).toBe(true)
        expect(has(run.findings, '/p/1', 'links-only-after-rendering')).toBe(true)
        expect(has(run.findings, '/js-only', 'linked-only-by-javascript')).toBe(true)
        // What happens after it never is.
        expect(run.findings.some((finding) => finding.endsWith(' h1-changed-by-javascript'))).toBe(
          false,
        )
        const late = await db.crawls.getUrl(run.crawl.id, crawlUrlHash(`${SITE}/late`))
        expect(late).toBeNull()
        const audit = await db.crawls.auditOf(run.crawl.id, [...run.hashes.keys()])
        expect(audit.every((row) => row.documentLoading === true)).toBe(true)
      }
      expect(runs[1]!.findings).toEqual(runs[0]!.findings)
      expect(runs[2]!.findings).toEqual(runs[0]!.findings)
      // Nothing is new or fixed between identical crawls.
      const comparison = await compareWithPrevious({ db, target: runs[2]!.crawl, exact: true })
      for (const [issue, counts] of comparison.byIssue) {
        expect(counts.fresh, issue).toBe(0)
        expect(counts.resolved, issue).toBe(0)
      }
    }, 600_000)

    it('never reports what appears after the window as fixed', async () => {
      // A window long enough to see the change made at 8 s, then the usual one.
      const long = await crawl({ waitMs: NUXT_TIMINGS.lateMs + 2000 })
      expect(has(long.findings, '/p/1', 'h1-changed-by-javascript')).toBe(true)
      expect(await db.crawls.getUrl(long.crawl.id, crawlUrlHash(`${SITE}/late`))).not.toBeNull()
      const short = await crawl()
      expect(has(short.findings, '/p/1', 'h1-changed-by-javascript')).toBe(false)
      const comparison = await compareWithPrevious({ db, target: short.crawl, exact: true })
      expect(comparison.base?.id).toBe(long.crawl.id)
      for (const [issue, counts] of comparison.byIssue) expect(counts.resolved, issue).toBe(0)
      expect(comparison.byIssue.get('h1-changed-by-javascript')).toMatchObject({
        resolved: 0,
        unverified: long.site.paths.length,
      })
    }, 600_000)

    it('keeps a page whose DOM never parses unknown for that page only', async () => {
      // Its script never answers within the crawl (the fetcher's timeout is longer), so the retry
      // after the drain waits for the same request and fails too. With a shorter timeout the
      // retry would render the page without that script, as a browser would after its timeout.
      const run = await crawl({ stuck: true, timeoutMs: 600_000 })
      expect(run.crawl.status).toBe('completed')
      const stuck = crawlUrlHash(`${SITE}/stuck`)
      const render = run.renders.find((row) => row.urlHash === stuck)!
      expect(render).toMatchObject({ status: 'failed', failure: 'load-timeout' })
      expect(render.data.capture).toEqual({
        pending: 0,
        afterMs: null,
        delayMs: null,
        rule: CURRENT_CAPTURE_RULE,
      })
      expect(has(run.findings, '/stuck', 'render-failed')).toBe(true)
      const [audit] = await db.crawls.auditOf(run.crawl.id, [stuck])
      expect(audit!.documentUnobserved).toContain('title-changed-by-javascript')
      // The other pages keep their findings; only the graph is unknown for the whole crawl.
      expect(has(run.findings, '/p/1', 'title-changed-by-javascript')).toBe(true)
      const unobserved = run.crawl.auditSnapshot?.unobserved ?? []
      expect(unobserved).not.toContain('title-changed-by-javascript')
      expect(unobserved).toEqual(expect.arrayContaining(RENDERED_GRAPH_ISSUES))
      expect(has(run.findings, '/js-only', 'linked-only-by-javascript')).toBe(false)
    }, 600_000)

    it('fetches at most six resources of a page at a time', async () => {
      // Checked through the crawl-wide slots: one render at a time, so the page's own bound shows.
      await db.crawls.saveSettings(domainId, {
        ...(await db.crawls.settings(domainId)),
        renderingMode: 'headless',
        renderWaitMs: 1000,
        requestsPerSecond: 50,
        concurrency: 1,
        timeoutMs: 15000,
        maxRetries: 0,
      })
      const site = nuxtSite({ pages: 1 })
      let active = 0
      let peak = 0
      const createFetcher: CrawlEngineOptions['createFetcher'] = (config) => {
        const inner = site.createFetcher(config)
        return {
          close: () => inner.close(),
          async fetch(url, options) {
            const resource = url.includes('/_nuxt/')
            if (resource) peak = Math.max(peak, ++active)
            try {
              return await inner.fetch(url, options)
            } finally {
              if (resource) active--
            }
          },
        }
      }
      const started = (await db.crawls.start({ domainId, type: 'full', trigger: 'manual' }))!
      await runCrawl(started.id, {
        db,
        log: createLogger('test', 'silent'),
        createFetcher,
        signal: new AbortController().signal,
        renderService: { check: service.check, render: service.render, concurrency: 1 },
      })
      expect(peak).toBe(RENDER_LIMITS.pageResources)
    }, 300_000)
  },
)
