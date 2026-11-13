import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import puppeteer, { type Browser, type Target } from 'puppeteer-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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

// headless-shell applies the WebRTC switch; full Chrome ignores this content-shell flag.
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
const available = !!executablePath && existsSync(executablePath)
const site: Record<string, Answer> = {
  'http://frames.other.test/random': {
    headers: { 'content-type': 'text/html' },
    body: Buffer.from(`<script>parent.postMessage({ random: Math.random() },'*')</script>`),
  },
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
  'http://site.test/worker.js': {
    headers: { 'content-type': 'application/javascript' },
    body: Buffer.from("setTimeout(()=>postMessage('worker survived'),100)"),
  },
  'http://site.test/binary': { body: Buffer.from('ok') },
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

const baseDocument = (body: string) => ({
  statusCode: 200,
  headers: { 'content-type': 'text/html' },
  body: Buffer.from(body),
  bytes: Buffer.byteLength(body),
  truncated: false,
  responseTimeMs: 0,
})

describe.skipIf(!available)('isolated Chromium rendering', () => {
  const binaryBodies: Buffer[] = []
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
        '--site-per-process',
        '--proxy-server=http://127.0.0.1:9',
        '--proxy-bypass-list=<-loopback>',
        '--host-resolver-rules=MAP * ~NOTFOUND',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
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
    const original = fetcher
    fetcher = {
      close: () => original.close(),
      fetch: (url, options) => {
        if (url === 'http://site.test/binary' && options.body) binaryBodies.push(options.body)
        return url === 'http://site.test/hang'
          ? new Promise((_resolve, reject) => {
              if (options.signal.aborted) {
                reject(new DOMException('Stopped', 'AbortError'))
                return
              }
              options.signal.addEventListener(
                'abort',
                () => reject(new DOMException('Stopped', 'AbortError')),
                { once: true },
              )
            })
          : original.fetch(url, options)
      },
    }
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
    const status = await checkIsolation(browser)
    expect(status.state, status.detail).toBe('ready')
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
  it('omits methods other than GET, HEAD, OPTIONS and POST', async () => {
    const result = await render('head', {
      document: {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: Buffer.from(
          `<script>for(const method of ['PUT','PATCH','DELETE'])fetch('/binary',{method}).catch(()=>{})</script>`,
        ),
        bytes: 0,
        truncated: false,
        responseTimeMs: 0,
      },
    })
    expect(result.requests.made).toBe(0)
    expect(result.requests.omitted.filter((item) => item.reason === 'method')).toHaveLength(3)
  })
  it('forwards binary POST bodies without UTF-8 replacement', async () => {
    const body = `<main></main><script>fetch('/binary',{method:'POST',body:new Uint8Array([0,128,255,65])}).then(r=>r.text()).then(text=>document.querySelector('main').textContent=text)</script>`
    const result = await render('head', {
      document: {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: Buffer.from(body),
        bytes: body.length,
        truncated: false,
        responseTimeMs: 0,
      },
    })
    expect(binaryBodies.at(-1)).toEqual(Buffer.from([0, 128, 255, 65]))
    expect(result.html).toContain('<main>ok</main>')
  })
  it('observes viewport lazy content and serializes open shadow roots', async () => {
    expect((await render('lazy')).html).toContain('href="/lazy"')
    expect((await render('shadow')).html).toContain(
      '<template shadowrootmode="open"><a href="/shadow">',
    )
  })
  it.each(['http://site.test', 'http://site.test/space here', 'http://síté.test/#fragment'])(
    'supplies the first document when Chrome normalizes %s',
    async (url) => {
      const result = await render('head', { url })
      expect(result.status).toBe('rendered')
      expect(result.html).toContain('<title>JS title</title>')
      expect(result.requests.omitted.some((item) => item.reason === 'redirect')).toBe(false)
      expect(result.finalUrl).toBe(url)
    },
  )
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
  it('charges truncated resources and stops downloading at the page budget', async () => {
    let downloads = 0
    const resource = Buffer.alloc(RENDER_LIMITS.resourceBytes)
    const requester = createRequester({
      fetcher: {
        close() {},
        async fetch() {
          downloads++
          return {
            statusCode: 200,
            headers: {},
            body: resource,
            bytes: resource.length,
            truncated: true,
            responseTimeMs: 0,
          }
        },
      },
      settings: { requestsPerSecond: 10000, maxRetries: 0 },
      signal: base.signal,
      retryBaseMs: 0,
      log: createLogger('test', 'silent'),
    })
    const body = `<script>(async()=>{for(let n=0;n<20;n++)await fetch('/large'+n).catch(()=>{})})()</script>`
    const result = await render('head', {
      requester,
      document: {
        ...baseDocument(body),
      },
    })
    expect(downloads).toBeLessThanOrEqual(6)
    expect(result.requests.omittedCount).toBeGreaterThan(0)
  })
  it('does not cache a script truncated by another page remaining budget', async () => {
    const cache = createRenderResourceCache()
    let downloads = 0
    const requester = createRequester({
      fetcher: {
        close() {},
        async fetch(_url, options) {
          downloads++
          const body = Buffer.from("document.querySelector('main').textContent='complete script'")
          return {
            ...baseDocument(''),
            headers: { 'content-type': 'application/javascript' },
            body: body.subarray(0, options.maxBytes),
            truncated: (options.maxBytes ?? body.length) < body.length,
          }
        },
      },
      settings: { requestsPerSecond: 10000, maxRetries: 0 },
      signal: base.signal,
      retryBaseMs: 0,
      log: createLogger('test', 'silent'),
    })
    const small = '<main></main><script src="/budget.js"></script>'
    const large = small + '<!--' + ' '.repeat(RENDER_LIMITS.pageBytes - small.length - 10) + '-->'
    const first = await render('head', { requester, cache, document: baseDocument(large) })
    expect(first.requests.omitted.some((item) => item.reason === 'limit')).toBe(true)
    const second = await render('head', { requester, cache, document: baseDocument(small) })
    expect(second.html).toContain('<main>complete script</main>')
    expect(second.requests.cached).toBe(1)
    expect(downloads).toBe(1)
  }, 15000)
  it('takes a never-quiet page at the wait limit without reporting failure', async () => {
    const document = {
      body: Buffer.from(
        `<main>still useful</main><script>fetch('/hang').catch(()=>{});setInterval(()=>fetch('/poll').catch(()=>{}),50)</script>`,
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
  it('closes popup and worker targets before they can alter the page', async () => {
    const body = `<main>unchanged</main><script>
      window.open('/popup');
      const worker = new Worker('/worker.js');
      worker.onmessage = e => document.querySelector('main').textContent = e.data;
    </script>`
    const result = await render('head', {
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
    expect(result.html).toContain('<main>unchanged</main>')
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
  it('seeds Math.random at document start in the main frame and cross-site OOPIF', async () => {
    let oopifs = 0
    const observe = async (target: Target) => {
      const session = await target.createCDPSession().catch(() => undefined)
      if (!session) return
      try {
        const { targetInfo } = await session.send('Target.getTargetInfo')
        if (targetInfo.type === 'iframe') oopifs++
      } finally {
        await session.detach().catch(() => {})
      }
    }
    browser.on('targetcreated', observe)
    const body = `<main></main><script>
      const first = Math.random();
      document.querySelector('main').dataset.random = first;
      addEventListener('message', event => { document.querySelector('main').dataset.frame = event.data.random });
    </script><iframe src="http://frames.other.test/random"></iframe>`
    try {
      const first = await render('head', { document: baseDocument(body) })
      const second = await render('head', { document: baseDocument(body) })
      expect(first.html).toBe(second.html)
      const mainRandom = /data-random="([^"]+)"/.exec(first.html)?.[1]
      expect(mainRandom).toBeDefined()
      expect(first.html).toContain(`data-frame="${mainRandom}"`)
      expect(oopifs).toBeGreaterThanOrEqual(2)
      const different = await render('head', {
        url: 'http://site.test/different',
        document: baseDocument(body),
      })
      expect(/data-random="([^"]+)"/.exec(different.html)?.[1]).not.toBe(mainRandom)
    } finally {
      browser.off('targetcreated', observe)
    }
  })
  it('retains Date.now as a documented real-clock exception', async () => {
    const body = `<main></main><script>document.querySelector('main').textContent=Date.now()</script>`
    const start = Date.now()
    const first = await render('head', { document: baseDocument(body) })
    const second = await render('head', { document: baseDocument(body) })
    const timestamp = Number(/<main>([0-9]+)<\/main>/.exec(first.html)?.[1])
    expect(timestamp).toBeGreaterThanOrEqual(start)
    expect(timestamp).toBeLessThanOrEqual(Date.now())
    expect(first.html).not.toBe(second.html)
  })
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
  it.each(['fetch', 'websocket', 'webrtc'] as const)(
    'refuses a browser that reaches the live worker %s canary',
    async (protocol) => {
      const networked = await puppeteer.launch({
        executablePath,
        headless: true,
        args: [
          '--no-sandbox',
          '--remote-debugging-port=0',
          '--disable-features=LocalNetworkAccessChecks',
        ],
      })
      try {
        const result = await checkIsolation(networked, '127.0.0.1', [protocol])
        expect(result.state).toBe('has-network')
        expect(result.detail).toMatch(/canary was reached/)
      } finally {
        await networked.close()
      }
    },
    15000,
  )
  it('refuses a probe timeout with a clear isolation detail', async () => {
    const createContext = browser.createBrowserContext.bind(browser)
    const spy = vi.spyOn(browser, 'createBrowserContext').mockImplementationOnce(async () => {
      const context = await createContext()
      const page = await context.newPage()
      vi.spyOn(context, 'newPage').mockResolvedValue(page)
      vi.spyOn(page, 'evaluate').mockResolvedValue('timeout')
      return context
    })
    try {
      const result = await checkIsolation(browser)
      expect(result.state).toBe('has-network')
      expect(result.detail).toContain('timed out; isolation is not proven')
    } finally {
      spy.mockRestore()
    }
  })
  it('refuses a WebRTC timeout rather than treating it as isolation', async () => {
    const unprotected = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--remote-debugging-port=0',
        '--proxy-server=http://127.0.0.1:9',
        '--proxy-bypass-list=<-loopback>',
        '--host-resolver-rules=MAP * ~NOTFOUND',
      ],
    })
    try {
      const result = await checkIsolation(unprotected)
      expect(result.state).toBe('has-network')
      expect(result.detail).toMatch(/WebRTC.*(?:canary|timed out)/)
    } finally {
      await unprotected.close()
    }
  }, 15000)
  it('bounds the cumulative POST body bytes of one page', async () => {
    let sent = 0
    const requester = {
      ...base.requester,
      async fetchWithRetries() {
        sent++
        return baseDocument('ok')
      },
    }
    const body = `<script>(async()=>{for(let n=0;n<8;n++)await fetch('/binary',{method:'POST',body:'x'.repeat(1024*1024)}).catch(()=>{})})()</script>`
    const result = await render('head', { requester, document: baseDocument(body) })
    expect(sent).toBe(5)
    expect(result.requests.omitted.filter((item) => item.reason === 'limit')).toHaveLength(3)
  })
  it.each([8, 64])(
    'bounds worker heap and never sends a %i MiB POST body',
    async (mib) => {
      const service = createRenderService({
        browserUrl: `http://127.0.0.1:${new URL(browser.wsEndpoint()).port}`,
        concurrency: 2,
        writeStatus: async () => {},
      })
      let sent = 0
      const requester = {
        ...base.requester,
        async fetchWithRetries() {
          sent++
          return baseDocument('unexpected')
        },
      }
      let peak = process.memoryUsage().heapUsed
      const before = peak
      const sample = setInterval(() => {
        peak = Math.max(peak, process.memoryUsage().heapUsed)
      }, 5)
      const body = `<script>fetch('/binary',{method:'POST',body:'x'.repeat(${mib}*1024*1024)}).catch(()=>{})</script>`
      try {
        const [hostile, ordinary] = await Promise.all([
          service.render({
            ...base,
            requester,
            url: 'http://site.test/body',
            document: baseDocument(body),
          }),
          service.render({
            ...base,
            url: 'http://site.test/ordinary',
            document: baseDocument('<main>unaffected</main>'),
          }),
        ])
        expect(sent).toBe(0)
        expect(
          hostile.status === 'failed' ||
            hostile.requests.omitted.some((item) => item.reason === 'limit'),
        ).toBe(true)
        if (mib === 64) expect(hostile.status).toBe('failed')
        expect(ordinary.status).toBe('rendered')
        expect(ordinary.html).toContain('<main>unaffected</main>')
        // Pre-parse ws bound: a 64 MiB POST cannot allocate its 150+ MiB JSON/postData copies.
        expect(peak - before).toBeLessThan(240 * 1024 * 1024)
      } finally {
        clearInterval(sample)
        await service.close()
      }
    },
    30000,
  )
  it('refuses a browser with actual network access (when this machine has network)', async (context) => {
    const networked = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--remote-debugging-port=0',
        '--disable-features=LocalNetworkAccessChecks',
      ],
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
