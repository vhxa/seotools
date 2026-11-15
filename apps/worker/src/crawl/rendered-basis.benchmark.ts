/** Local fake-site measurement: pnpm exec tsx apps/worker/src/crawl/rendered-basis.benchmark.ts */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { platform, arch } from 'node:os'
import { chromium } from '@playwright/test'
import puppeteer from 'puppeteer-core'
import { createLogger } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase } from '@seotools/db/test'
import { createRenderService } from '../render/service'
import { createRenderResourceCache } from '../render/cache'
import { runCrawl } from './engine'
import { fakeSite, type Answer } from './fake-site'
import { SITE, page } from './test-site'

const exec = promisify(execFile)
const dir = chromium
  .executablePath()
  .replace(/chromium-(\d+)[/\\].*$/, 'chromium_headless_shell-$1')
const executable = readdirSync(dir, { recursive: true }).find(
  (p) => typeof p === 'string' && /(?:^|[/\\])chrome-headless-shell(?:\.exe)?$/.test(p),
)
if (typeof executable !== 'string' || !existsSync(join(dir, executable)))
  throw new Error('Install Playwright Chromium first')
const browser = await puppeteer.launch({
  executablePath: join(dir, executable),
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
const service = createRenderService({
  browserUrl: `http://127.0.0.1:${new URL(browser.wsEndpoint()).port}`,
  concurrency: 2,
  writeStatus: async () => {},
})
const db = await createTestDatabase()
const log = createLogger('benchmark', 'silent')
const results: unknown[] = []
let peakRssKiB = 0
let sampling: Promise<void> | undefined
async function sample() {
  const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,rss='])
  const rows = stdout
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
  const pids = new Set([browser.process()!.pid!])
  let added = true
  while (added) {
    added = false
    for (const [pid, ppid] of rows)
      if (pids.has(ppid!) && !pids.has(pid!)) {
        pids.add(pid!)
        added = true
      }
  }
  peakRssKiB = Math.max(
    peakRssKiB,
    rows.filter(([pid]) => pids.has(pid!)).reduce((sum, row) => sum + row[2]!, 0),
  )
}
const timer = setInterval(() => {
  if (!sampling)
    sampling = sample().finally(() => {
      sampling = undefined
    })
}, 100)
try {
  const version = await browser.version()
  const created = await createCompany(db, { name: 'Benchmark', domain: 'example.com' })
  if (!created.ok) throw new Error('setup failed')
  const domainId = created.domain.id
  await service.check()
  for (const mode of ['html', 'rendered-cached', 'rendered-uncached'] as const) {
    peakRssKiB = 0
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      renderingMode: mode === 'html' ? 'http' : 'headless',
      renderWaitMs: 1000,
      requestsPerSecond: 100,
      concurrency: 2,
      maxRetries: 0,
    })
    const paths = ['/', ...Array.from({ length: 39 }, (_, i) => `/page-${i}`)]
    const data: Record<string, Answer> = {}
    for (const path of paths)
      data[`${SITE}${path}`] = page(path, {
        head: '<link rel="stylesheet" href="/shared.css"><script src="/shared.js" defer></script>',
        links: paths
          .filter((p) => p !== path)
          .map((p) => `<a href="${p}">${p}</a>`)
          .join(''),
      })
    data[`${SITE}/shared.js`] = {
      statusCode: 200,
      headers: { 'content-type': 'application/javascript' },
      body: Buffer.from("document.title='A stable rendered title for this benchmark';"),
    }
    data[`${SITE}/shared.css`] = {
      statusCode: 200,
      headers: { 'content-type': 'text/css' },
      body: Buffer.from('body{color:#123}'),
    }
    const fake = fakeSite(data, 0)
    const crawl = (await db.crawls.start({ domainId, type: 'full', trigger: 'manual' }))!
    let resourceRequests = 0,
      cachedRequests = 0
    const start = performance.now()
    await runCrawl(crawl.id, {
      db,
      log,
      createFetcher: fake.createFetcher,
      signal: new AbortController().signal,
      renderService: {
        check: () => service.check(),
        render: async (input) => {
          const outcome = await service.render(
            mode === 'rendered-uncached'
              ? { ...input, cache: createRenderResourceCache(0) }
              : input,
          )
          resourceRequests += outcome.requests.made
          cachedRequests += outcome.requests.cached
          return outcome
        },
      },
    })
    const durationMs = performance.now() - start
    await sample()
    const stored = (await db.crawls.get(crawl.id))!
    const pages = await db.crawls.listUrls({
      crawlId: crawl.id,
      view: 'pages',
      limit: 100,
      offset: 0,
    })
    if (stored.status !== 'completed' || pages.length !== 40)
      throw new Error('Incomplete benchmark workload')
    results.push({
      mode,
      pages: pages.length,
      durationMs,
      pagesPerMinute: (pages.length * 60000) / durationMs,
      siteRequests: fake.requests.length,
      siteRequestsPerPage: fake.requests.length / pages.length,
      renderResourceRequests: resourceRequests,
      cachedRenderRequests: cachedRequests,
      browserPeakSummedRssMiB: mode === 'html' ? null : peakRssKiB / 1024,
      documentCoverage: stored.auditSnapshot?.documentCoverage,
    })
  }
  process.stdout.write(
    JSON.stringify(
      {
        platform: platform(),
        arch: arch(),
        browser: version,
        concurrency: 2,
        renderWaitMs: 1000,
        pages: 40,
        resourceCache: '64 MiB per crawl; disabled with a zero-capacity cache per render',
        memoryMetric:
          '100 ms sampled sum of ps RSS for browser and descendants; includes shared mappings repeatedly; not a worst-case bound',
        results,
      },
      null,
      2,
    ) + '\n',
  )
} finally {
  clearInterval(timer)
  await sampling
  await service.close()
  await browser.close()
  await db.close()
}
