import { existsSync } from 'node:fs'
import { chromium } from '@playwright/test'
import puppeteer, { type Browser, type Target } from 'puppeteer-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLogger, DEFAULT_CRAWL_SETTINGS } from '@seotools/core'
import { fakeRenderSite, moved, type Answer } from '../crawl/fake-site'
import { createHttpFetcher, type Fetcher } from '../crawl/fetcher'
import { createRequester } from '../crawl/requester'
import { createRenderResourceCache } from './cache'
import { checkIsolation } from './isolation'
import { createRenderService } from './service'
import { RENDER_LIMITS } from './limits'
import { renderPage } from './page'
import type { RenderInput } from './types'

const executablePath = chromium.executablePath()
const available = existsSync(executablePath)
const site: Record<string, Answer> = {
  'http://site.test/nav.js': {
    headers: { 'content-type': 'application/javascript' },
    body: Buffer.from(
      "document.querySelector('nav').innerHTML='<a href=\"/menu\">Menu</a>';document.querySelector('footer').innerHTML='<a href=\"/legal\">Legal</a>'",
    ),
  },
  'http://site.test/old.js': moved('/new.js'),
  'http://site.test/new.js': {
    body: Buffer.from("document.querySelector('main').textContent='redirected script'"),
  },
  'http://site.test/poll': { body: Buffer.from('ok') },
  'http://api.other.test/graphql': {
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'content-type': 'application/json',
    },
    body: Buffer.from('{"text":"from api"}'),
  },
}
const pages = {
  nav: '<nav></nav><footer></footer><script src="/nav.js"></script>',
  head: `<title>Raw</title><meta name="robots" content="noindex"><script>document.title='JS title';document.querySelector('meta').content='index,follow';const c=document.createElement('link');c.rel='canonical';c.href='/canonical';document.head.append(c)</script>`,
  cors: `<main></main><script>fetch('http://api.other.test/graphql',{method:'POST',headers:{'content-type':'application/json'},body:'{"query":"x"}'}).then(r=>r.json()).then(x=>document.querySelector('main').textContent=x.text)</script>`,
  redirectScript: '<main></main><script src="/old.js"></script>',
  lazy: `<meta name="viewport" content="width=device-width,initial-scale=1"><div style="height:1800px"></div><main></main><script>new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting))document.querySelector('main').innerHTML='<a href="/lazy">lazy content</a>'}).observe(document.querySelector('main'))</script>`,
  shadow: `<x-card></x-card><script>document.querySelector('x-card').attachShadow({mode:'open'}).innerHTML='<a href="/shadow">Shadow content</a>'</script>`,
  redirect: '<title>Redirect</title><script>location.href="/target"</script>',
  hostile: `<script>for(const u of ['http://169.254.169.254/latest/meta-data/','http://127.0.0.1:9223/json/version','http://localhost:3113/','http://127.0.0.1:3113/'])fetch(u).catch(()=>{});new WebSocket('ws://localhost:3113/');navigator.sendBeacon('http://google-analytics.com/g/collect','x')</script><img src="/image"><script src="https://dev.visualwebsiteoptimizer.com/j.php"></script>`,
}

describe.skipIf(!available)('isolated Chromium rendering', () => {
  let browser: Browser
  let fetcher: Fetcher
  let base: Omit<RenderInput, 'url' | 'document'>
  beforeAll(async () => {
    // Chromium switches are defined by net/base/net_switches.cc and host_resolver_rules.cc.
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--remote-debugging-port=0',
        '--no-sandbox',
        '--proxy-server=http://127.0.0.1:9',
        '--proxy-bypass-list=<-loopback>',
        '--host-resolver-rules=MAP * ~NOTFOUND',
      ],
    })
    fetcher = fakeRenderSite(
      site,
      createHttpFetcher({
        userAgent: 'render-test',
        timeoutMs: 500,
        concurrency: 2,
        allowPrivateNetworks: false,
      }),
    )
    base = {
      host: 'site.test',
      userAgent: 'render-test',
      signal: new AbortController().signal,
      cache: createRenderResourceCache(),
      allowedByRobots: () => true,
      requester: createRequester({
        fetcher,
        settings: { ...DEFAULT_CRAWL_SETTINGS, requestsPerSecond: 1000, maxRetries: 0 },
        signal: new AbortController().signal,
        retryBaseMs: 1,
        log: createLogger('test', 'silent'),
      }),
    }
  }, 30_000)
  afterAll(async () => {
    fetcher?.close()
    await browser?.close()
  })
  const render = (key: keyof typeof pages, extra: Partial<RenderInput> = {}) =>
    renderPage(browser, {
      ...base,
      url: `http://site.test/${key}`,
      document: {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: Buffer.from(pages[key]),
        bytes: pages[key].length,
        truncated: false,
        responseTimeMs: 0,
      },
      ...extra,
    })
  it('passes every isolation probe without interception', async () => {
    expect((await checkIsolation(browser)).state).toBe('ready')
  }, 15_000)
  it('renders script-built navigation/footer and mutated head declarations', async () => {
    const nav = await render('nav')
    expect(nav.status).toBe('rendered')
    expect(nav.html).toContain('href="/menu"')
    expect(nav.html).toContain('href="/legal"')
    const head = await render('head')
    expect(head.html).toContain('<title>JS title</title>')
    expect(head.html).toContain('content="index,follow"')
    expect(head.html).toContain('rel="canonical"')
  })
  it('fulfills CORS OPTIONS and POST and script redirects', async () => {
    const cors = await render('cors')
    expect(cors.html).toContain('<main>from api</main>')
    expect(cors.requests.made).toBe(2)
    expect((await render('redirectScript')).html).toContain('<main>redirected script</main>')
  })
  it('observes viewport lazy content and serializes open shadow roots', async () => {
    expect((await render('lazy')).html).toContain('href="/lazy"')
    expect((await render('shadow')).html).toContain(
      '<template shadowrootmode="open"><a href="/shadow">',
    )
  })
  it('stops at a client redirect without fetching its target', async () => {
    const result = await render('redirect')
    expect(result.status).toBe('rendered')
    expect(result.finalUrl).toBe('http://site.test/target')
    expect(result.requests.made).toBe(0)
  })
  it('refuses private literals, localhost and the application port, and omits measurement and experiments', async () => {
    const result = await render('hostile')
    expect(result.requests.refused).toEqual([
      'http://127.0.0.1:3113/',
      'http://127.0.0.1:9223/json/version',
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3113/',
    ])
    expect(result.requests.omitted).toEqual(
      expect.arrayContaining([
        { url: 'https://dev.visualwebsiteoptimizer.com/j.php', reason: 'experiment' },
        { url: 'http://google-analytics.com/g/collect', reason: 'type' },
      ]),
    )
  })
  it('obeys robots only for tracked resources, and shares script answers across a crawl', async () => {
    const cache = createRenderResourceCache()
    const first = await render('nav', { cache })
    const second = await render('nav', { cache })
    expect(first.requests.made).toBe(1)
    expect(second.requests.cached).toBe(1)
    const blocked = await render('nav', { allowedByRobots: () => false })
    expect(blocked.requests.blockedByRobots).toEqual(['http://site.test/nav.js'])
    expect(blocked.requests.made).toBe(0)
  })
  it('takes a never-quiet page at the wait limit without reporting failure', async () => {
    const document = {
      body: Buffer.from(
        `<main>still useful</main><script>setInterval(()=>fetch('/poll').catch(()=>{}),50)</script>`,
      ),
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      truncated: false,
      bytes: 0,
      responseTimeMs: 0,
    }
    const start = Date.now()
    const result = await render('head', { document, waitMs: 800 })
    expect(result.status).toBe('rendered')
    expect(result.settled).toBe(false)
    expect(Date.now() - start).toBeLessThan(1800)
  })
  it('bounds requests, diagnostics and script errors', async () => {
    const body = `<main>bounded</main><script>
      for(let n=0;n<400;n++) fetch('/poll').catch(()=>{});
      for(let n=0;n<60;n++) setTimeout(()=>{throw new Error('error '+n+' '+ 'x'.repeat(300))},0);
    </script>`
    const result = await render('head', {
      waitMs: 1500,
      document: {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: Buffer.from(body),
        bytes: body.length,
        truncated: false,
        responseTimeMs: 0,
      },
    })
    expect(result.status).toBe('rendered')
    expect(result.requests.made).toBeLessThanOrEqual(RENDER_LIMITS.requests)
    expect(result.requests.omittedCount).toBeGreaterThan(50)
    expect(result.requests.omitted).toHaveLength(RENDER_LIMITS.diagnosticItems)
    expect(result.scriptErrors.count).toBe(60)
    expect(result.scriptErrors.first).toHaveLength(RENDER_LIMITS.scriptErrors)
    expect(result.scriptErrors.first.every((error) => error.length <= 200)).toBe(true)
  })
  it('bounds UTF-8 DOM bytes and ignores page overrides of serialization builtins', async () => {
    const body = `<main>${'é'.repeat(RENDER_LIMITS.domBytes / 2 + 100)}</main><script>Element.prototype.getHTML=()=>'<p>fake</p>';window.TextEncoder=function(){throw Error('fake')}</script>`
    const result = await render('head', {
      document: {
        statusCode: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: Buffer.from(body),
        bytes: Buffer.byteLength(body),
        truncated: false,
        responseTimeMs: 0,
      },
    })
    expect(result.status).toBe('rendered')
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.html)).toBeLessThanOrEqual(RENDER_LIMITS.domBytes)
    expect(result.html).toContain('<main>é')
  }, 15_000)
  it('renders the same page identically twenty times, excluding timing', async () => {
    const outcomes = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const { durationMs: _duration, ...outcome } = await render('nav', {
        cache: createRenderResourceCache(),
      })
      outcomes.add(JSON.stringify(outcome))
    }
    expect(outcomes.size).toBe(1)
  }, 30_000)
  it('retries a crashed page once and then returns failed', async () => {
    const service = createRenderService({
      browserUrl: `http://127.0.0.1:${new URL(browser.wsEndpoint()).port}`,
      concurrency: 1,
      writeStatus: async () => {},
    })
    let crashes = 0
    const kill = async (target: Target) => {
      const page = await target.page()
      if (!page) return
      page.on('domcontentloaded', () => {
        if (page.url() !== 'http://site.test/crash') return
        crashes++
        void page
          .createCDPSession()
          .then((cdp) => cdp.send('Page.crash'))
          .catch(() => {})
      })
    }
    browser.on('targetcreated', kill)
    try {
      const result = await service.render({
        ...base,
        url: 'http://site.test/crash',
        document: {
          statusCode: 200,
          headers: { 'content-type': 'text/html' },
          body: Buffer.from('<main>crash me</main>'),
          bytes: 0,
          truncated: false,
          responseTimeMs: 0,
        },
      })
      expect(result.status).toBe('failed')
      expect(result.failure?.code).toBe('crashed')
      expect(crashes).toBe(2)
    } finally {
      browser.off('targetcreated', kill)
      await service.close()
    }
  }, 30_000)
  it('refuses a browser with actual network access (when this machine has network)', async (context) => {
    const networked = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--remote-debugging-port=0'],
    })
    try {
      const result = await checkIsolation(networked)
      if (result.state !== 'has-network') {
        context.skip()
        return
      }
      expect(result.state).toBe('has-network')
    } finally {
      await networked.close()
    }
  }, 20_000)
})
