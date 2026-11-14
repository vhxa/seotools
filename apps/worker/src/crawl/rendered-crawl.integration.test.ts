import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { once } from 'node:events'
import { chromium } from '@playwright/test'
import puppeteer, { type Browser } from 'puppeteer-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLogger, crawlUrlHash } from '@seotools/core'
import { PAGE_ISSUES } from '@seotools/core/crawl/issues'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { createRenderService, type RenderService } from '../render/service'
import { runCrawl } from './engine'
import { fakeSite } from './fake-site'
import { htmlBaseline } from './html-baseline'
import {
  DIFFERENCE_FIXTURES,
  differenceDocuments,
  type DifferenceId,
} from './render-difference-fixtures'
import { renderedOutcome } from './render-fixture'
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

function launchBrowser(port = 0) {
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      `--remote-debugging-port=${port}`,
      '--no-sandbox',
      '--site-per-process',
      '--proxy-server=http://127.0.0.1:9',
      '--proxy-bypass-list=<-loopback>',
      '--host-resolver-rules=MAP * ~NOTFOUND',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ],
  })
}

describe.skipIf(!executablePath || !existsSync(executablePath))(
  'rendered crawl with isolated Chromium',
  () => {
    let browser: Browser
    let service: RenderService
    let db: Database
    let domainId: string
    beforeAll(async () => {
      browser = await launchBrowser()
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
    it.each([false, true])(
      'handles a browser killed mid-crawl: recovery=%s',
      async (recovers) => {
        // Use one crawler request at a time so the kill happens after the first page committed.
        await db.crawls.saveSettings(domainId, {
          ...(await db.crawls.settings(domainId)),
          concurrency: 1,
        })
        await service.close()
        await browser.close()
        browser = await launchBrowser()
        const port = Number(new URL(browser.wsEndpoint()).port)
        service = createRenderService({
          browserUrl: `http://127.0.0.1:${port}`,
          concurrency: 2,
          writeStatus: async () => {},
        })
        let killed = false
        let returned = false
        const successes: string[] = []
        const site = fakeSite(
          {
            [`${SITE}/`]: page('/', { links: '<a href="/child">Child</a>' }),
            [`${SITE}/child`]: page('/child'),
          },
          0,
        )
        const crawl = (await db.crawls.start({ domainId, type: 'full', trigger: 'manual' }))!
        await runCrawl(crawl.id, {
          db,
          log: createLogger('test', 'silent'),
          createFetcher: site.createFetcher,
          signal: new AbortController().signal,
          browserMaxWaitMs: recovers ? 10000 : 150,
          browserPollMs: 25,
          renderService: {
            check: async () => {
              const status = await service.check()
              if (killed && recovers && !returned && status.state === 'unreachable') {
                browser = await launchBrowser(port)
                returned = true
              }
              return status
            },
            render: async (input) => {
              if (input.url.endsWith('/child') && !killed) {
                killed = true
                const process = browser.process()!
                const exited = once(process, 'exit')
                process.kill('SIGKILL')
                await exited
              }
              const result = await service.render(input)
              if (result.status === 'rendered') successes.push(input.url)
              return result
            },
          },
        })
        const stored = (await db.crawls.get(crawl.id))!
        expect(killed).toBe(true)
        expect(stored.status).toBe(recovers ? 'completed' : 'failed')
        expect(stored.error).toBe(recovers ? null : 'browser-unavailable')
        expect(new Set(successes).size).toBe(successes.length)
        const renders = await db.crawls.renders(crawl.id)
        expect(renders).toHaveLength(recovers ? 2 : 1)
        expect(renders.every((row) => row.status === 'rendered')).toBe(true)
        if (!recovers) {
          expect(stored.browserWaitMs).toBe(150)
          expect((await db.crawls.getUrl(crawl.id, crawlUrlHash(`${SITE}/child`)))?.state).toBe(
            'queued',
          )
        }
      },
      60000,
    )
    it('script-free charset declarations and meta refresh never become JavaScript differences', async () => {
      const title = 'Café, piñata y déjà vu'
      const utf8 = page('/utf8', { title, h1: title, document: '' })
      const conflict = page('/conflict', {
        title,
        h1: title,
        document: '<meta charset="windows-1252">',
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
      const latin1 = page('/latin1', {
        title,
        h1: title,
        document: '<meta charset="utf-8">',
        headers: { 'content-type': 'text/html; charset=iso-8859-1' },
      })
      latin1.body = Buffer.from(latin1.body!.toString('utf8'), 'latin1')
      const metaLatin1 = page('/meta-latin1', {
        title,
        h1: title,
        document: '<meta charset="iso-8859-1">',
      })
      metaLatin1.body = Buffer.from(metaLatin1.body!.toString('utf8'), 'latin1')
      const fake = fakeSite(
        {
          [`${SITE}/`]: page('/', {
            links: ['/utf8', '/conflict', '/latin1', '/meta-latin1', '/refresh']
              .map((path) => `<a href="${path}">${path}</a>`)
              .join(''),
          }),
          [`${SITE}/utf8`]: utf8,
          [`${SITE}/conflict`]: conflict,
          [`${SITE}/latin1`]: latin1,
          [`${SITE}/meta-latin1`]: metaLatin1,
          [`${SITE}/refresh`]: page('/refresh', {
            head: '<meta http-equiv="refresh" content="0;url=/target">',
          }),
        },
        0,
      )
      const crawl = (await db.crawls.start({ domainId, type: 'full', trigger: 'manual' }))!
      await runCrawl(crawl.id, {
        db,
        log: createLogger('test', 'silent'),
        createFetcher: fake.createFetcher,
        renderService: service,
        signal: new AbortController().signal,
      })
      const stored = (await db.crawls.get(crawl.id))!
      expect(stored.status).toBe('completed')
      expect(stored.auditSnapshot?.rendersUnobserved).toBe(0)
      const javascript = new Set<string>(
        Object.entries(PAGE_ISSUES)
          .filter(([, issue]) => issue.category === 'javascript')
          .map(([id]) => id),
      )
      const renders = await db.crawls.renders(crawl.id)
      for (const path of ['/utf8', '/conflict', '/latin1', '/meta-latin1', '/refresh']) {
        const hash = crawlUrlHash(`${SITE}${path}`)
        const issues = (await db.crawls.issuesOf(crawl.id, [hash])).map((row) => row.issue)
        expect(issues.filter((id) => javascript.has(id))).toEqual([])
        const render = renders.find((row) => row.urlHash === hash)!
        expect(render.status).toBe('rendered')
        if (path === '/refresh') {
          expect(issues).toContain('refresh-redirect')
          expect(render).toMatchObject({
            settled: false,
            data: { redirected: true, facts: null },
            finalUrl: `${SITE}/target`,
          })
          expect(
            (await db.crawls.linksFrom(crawl.id, [hash])).some((link) => link.rendered === 1),
          ).toBe(false)
        } else {
          expect(render.settled).toBe(true)
          expect(render.data.page).toMatchObject({ title, h1: title })
          if (path === '/utf8') expect(issues).toContain('charset-missing')
        }
      }
    }, 60000)
    it('three redirecting crawls stay complete, preserve orphans and ignore the abandoned DOM', async () => {
      let previous: unknown
      let baselineOrphans: string[] = []
      for (let iteration = -1; iteration < 3; iteration++) {
        const fake = fakeSite(
          {
            [`${SITE}/`]: page('/', { links: '<a href="/redirect">Redirect</a>' }),
            [`${SITE}/redirect`]: page('/redirect', {
              links: '<a href="/html-link">HTML link</a>',
              head: '<script src="/redirect.js" defer></script>',
            }),
            [`${SITE}/redirect.js`]: {
              statusCode: 200,
              headers: { 'content-type': 'application/javascript' },
              body: Buffer.from(
                iteration === -1
                  ? ''
                  : `
              document.title='Abandoned title';
              document.body.innerHTML+='<a href="/orphan">Abandoned link</a><a href="/phantom">Phantom</a>';
              location.href='/target';
            `,
              ),
            },
            [`${SITE}/html-link`]: page('/html-link'),
            [`${SITE}/orphan`]: page('/orphan'),
            [`${SITE}/sitemap.xml`]: xml(sitemapOf(['/orphan'])),
          },
          0,
        )
        const crawl = (await db.crawls.start({ domainId, type: 'full', trigger: 'manual' }))!
        await runCrawl(crawl.id, {
          db,
          log: createLogger('test', 'silent'),
          createFetcher: fake.createFetcher,
          renderService: service,
          signal: new AbortController().signal,
        })
        const stored = (await db.crawls.get(crawl.id))!
        expect(stored.status).toBe('completed')
        expect(stored.auditSnapshot?.rendersUnobserved).toBe(0)
        expect(stored.auditSnapshot?.renderCoverage).toEqual({
          failedOrMissing: 0,
          truncated: 0,
          unsettled: 0,
        })
        expect(stored.auditSnapshot?.unobserved).not.toContain('orphan-in-sitemap')
        expect(stored.auditSnapshot?.unobserved).not.toContain('javascript-redirect')
        const orphan = (await db.crawls.issuesOf(crawl.id, [crawlUrlHash(`${SITE}/orphan`)])).map(
          (row) => row.issue,
        )
        if (iteration === -1) baselineOrphans = orphan
        expect(orphan).toEqual(baselineOrphans)
        expect(orphan).toContain('orphan-in-sitemap')
        expect(fake.requests).toContain(`${SITE}/html-link`)
        expect(fake.requests).not.toContain(`${SITE}/phantom`)
        expect(fake.requests).not.toContain(`${SITE}/target`)
        if (iteration === -1) continue
        const hash = crawlUrlHash(`${SITE}/redirect`)
        const render = (await db.crawls.renders(crawl.id)).find((row) => row.urlHash === hash)!
        expect(render).toMatchObject({
          status: 'rendered',
          settled: false,
          truncated: false,
          finalUrl: `${SITE}/target`,
          data: { redirected: true, facts: null },
        })
        expect(render.data.page).toBeUndefined()
        const links = await db.crawls.linksFrom(crawl.id, [hash])
        expect(links.some((row) => row.rendered === 1)).toBe(false)
        const findings = await db.crawls.issuesOf(crawl.id, [hash])
        expect(findings.map((row) => row.issue)).toContain('javascript-redirect')
        expect(findings.map((row) => row.issue)).not.toContain('title-changed-by-javascript')
        expect(stored.auditSnapshot?.unobserved).toContain('title-changed-by-javascript')
        const result = await htmlBaseline(db, crawl.id)
        if (previous) expect(JSON.stringify(result)).toBe(JSON.stringify(previous))
        previous = result
      }
    }, 120000)
    it('three real JavaScript-menu crawls have identical findings, accepted rows, counts and snapshot', async () => {
      let previous: unknown
      const differencePages: Record<string, ReturnType<typeof page>> = {}
      const ids = Object.keys(DIFFERENCE_FIXTURES) as DifferenceId[]
      for (const id of ids) {
        const path = `/differences/${id}`
        const { before, after } = differenceDocuments(id, path)
        differencePages[`${SITE}${path}`] = {
          ...page(path),
          body: Buffer.from(
            before.replace('</head>', `<script src="${path}.js" defer></script></head>`),
          ),
        }
        let script = `const parsed=new DOMParser().parseFromString(${JSON.stringify(after)},'text/html');document.head.replaceChildren(...parsed.head.childNodes);document.body.replaceChildren(...parsed.body.childNodes);`
        if (id === 'javascript-redirect') script = `location.href='/redirect-target'`
        if (id === 'render-script-errors')
          script = `throw new Error('deterministic script failure')`
        if (id === 'render-resources-blocked-by-robots')
          script = `const s=document.createElement('script');s.src='/blocked.js';document.head.append(s)`
        differencePages[`${SITE}${path}.js`] = {
          statusCode: 200,
          headers: { 'content-type': 'application/javascript' },
          body: Buffer.from(script),
        }
      }
      for (let iteration = 0; iteration < 3; iteration++) {
        const site = fakeSite(
          {
            ...differencePages,
            [`${SITE}/robots.txt`]: {
              statusCode: 200,
              headers: { 'content-type': 'text/plain' },
              body: Buffer.from('User-agent: *\nDisallow: /blocked.js'),
            },
            [`${SITE}/`]: page('/', {
              links: ids.map((id) => `<a href="/differences/${id}">${id}</a>`).join(''),
              head: '<script src="/menu.js" defer></script>',
            }),
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
          renderService: {
            check: () => service.check(),
            render: async (input) =>
              input.url.endsWith('/render-failed')
                ? {
                    ...renderedOutcome(input),
                    status: 'failed',
                    failure: { code: 'serialization', message: 'deterministic failure' },
                  }
                : service.render(input),
          },
          signal: new AbortController().signal,
          browserMaxWaitMs: 0,
        })
        expect((await db.crawls.get(crawl.id))?.status).toBe('completed')
        const menu = await db.crawls.issuesOf(crawl.id, [crawlUrlHash(`${SITE}/menu`)])
        // Failed/unsettled observations make the site-wide link absence unknown.
        expect(menu.map((row) => row.issue)).not.toContain('linked-only-by-javascript')
        expect(menu.map((row) => row.issue)).not.toContain('orphan-in-sitemap')
        const home = await db.crawls.issuesOf(crawl.id, [crawlUrlHash(`${SITE}/`)])
        expect(home.map((row) => row.issue)).not.toContain('links-only-after-rendering')
        for (const id of ids) {
          const rows = await db.crawls.issuesOf(crawl.id, [
            crawlUrlHash(`${SITE}/differences/${id}`),
          ])
          const reported = rows.map((row) => row.issue)
          expect(reported).toContain(id)
        }
        const result = await htmlBaseline(db, crawl.id)
        if (previous) expect(JSON.stringify(result)).toBe(JSON.stringify(previous))
        previous = result
      }
    }, 300000)
    it('three real DOM audits use rendered document values and exact removals while preserving served diagnostics', async () => {
      let previous: unknown
      for (let iteration = 0; iteration < 3; iteration++) {
        const after = page('/a', {
          title: 'A complete rendered title long enough for the audit',
          canonical: '/target',
          head: '<meta name="robots" content="noindex"><link rel="alternate" hreflang="en" href="/a">',
          links: '',
        }).body!.toString()
        const script = `const parsed=new DOMParser().parseFromString(${JSON.stringify(after)},'text/html');document.head.replaceChildren(...parsed.head.childNodes);document.body.replaceChildren(...parsed.body.childNodes);`
        const fake = fakeSite(
          {
            [`${SITE}/`]: page('/', { links: '<a href="/a">A</a>' }),
            [`${SITE}/a`]: page('/a', {
              title: 'X',
              description: null,
              h1: null,
              canonical: null,
              social: null,
              head: '<script src="/audit.js" defer></script>',
              links: '<a href="/target" rel="nofollow">Target</a><img src="/missing.png">',
            }),
            [`${SITE}/target`]: page('/target'),
            [`${SITE}/missing.png`]: { statusCode: 404, headers: {}, body: Buffer.from('missing') },
            [`${SITE}/audit.js`]: {
              statusCode: 200,
              headers: { 'content-type': 'application/javascript' },
              body: Buffer.from(script),
            },
          },
          0,
        )
        const crawl = (await db.crawls.start({ domainId, type: 'full', trigger: 'manual' }))!
        await runCrawl(crawl.id, {
          db,
          log: createLogger('test', 'silent'),
          createFetcher: fake.createFetcher,
          renderService: service,
          signal: new AbortController().signal,
        })
        const hash = crawlUrlHash(`${SITE}/a`)
        const found = (await db.crawls.issuesOf(crawl.id, [hash])).map((row) => row.issue)
        expect(found).toEqual(
          expect.arrayContaining([
            'noindex',
            'no-outgoing-links',
            'title-changed-by-javascript',
            'description-only-after-rendering',
            'h1-only-after-rendering',
            'canonical-only-after-rendering',
            'noindex-added-by-javascript',
            'og-missing',
          ]),
        )
        for (const id of [
          'title-too-short',
          'description-missing',
          'h1-missing',
          'resources-broken',
          'internal-nofollow-links',
        ])
          expect(found).not.toContain(id)
        expect((await db.crawls.auditOf(crawl.id, [hash]))[0]).toMatchObject({
          documentObservation: 'complete',
          indexability: 'not-indexable',
          blockers: ['noindex', 'canonical'],
        })
        expect((await db.crawls.getUrl(crawl.id, hash))?.title).toBe('X')
        const result = await htmlBaseline(db, crawl.id)
        if (previous) expect(JSON.stringify(result)).toBe(JSON.stringify(previous))
        previous = result
      }
    }, 120000)
  },
)
