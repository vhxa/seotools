import type { CrawlEngineOptions } from './engine'
import { FetchError, type FetchedResponse, type Fetcher } from './fetcher'
import { SITE } from './test-site'

/**
 * For tests: a Nuxt-like site that answers like a slow production server. Every page loads many
 * scripts and stylesheets (most shared, some its own), each answering after a fixed 200–800 ms
 * delay of its own; one request of every page never answers (long polling or analytics); a module
 * adds links after about 1 s, changes the title and the text after about 2 s and adds an element
 * after 8 s, which a 5 s capture window must never see.
 *
 * Every delay is a function of the path, so the same crawl gets the same answers each time.
 */
export interface NuxtSiteOptions {
  /** Pages besides the home page, the page only JavaScript links to and the stuck one. */
  pages: number
  shared?: number
  perPage?: number
  /** Adds `/stuck`, whose DOM never finishes parsing: a script written into its head never answers. */
  stuck?: boolean
}

export const NUXT_TIMINGS = { linksMs: 1000, textMs: 2000, lateMs: 8000 } as const

/** The same 200–800 ms for a path every time. */
export function delayOf(path: string) {
  let hash = 2166136261
  for (let i = 0; i < path.length; i++) hash = Math.imul(hash ^ path.charCodeAt(i), 16777619)
  return 200 + ((hash >>> 0) % 601)
}

const APP = `
const links = (document.body.dataset.jsLinks || '').split(',').filter(Boolean)
fetch('/api/poll?' + location.pathname).catch(() => {})
setTimeout(() => {
  const box = document.querySelector('#js')
  for (const href of links) {
    const a = document.createElement('a')
    a.href = href
    a.textContent = 'Added by script ' + href
    box.append(a)
  }
}, ${NUXT_TIMINGS.linksMs})
setTimeout(() => {
  document.title = document.title.replace('served', 'rendered')
  document.querySelector('main p').textContent += ' and the rest of the text, which only the script writes for every visitor of this page'
}, ${NUXT_TIMINGS.textMs})
setTimeout(() => {
  const a = document.createElement('a')
  a.href = '/late'
  a.textContent = 'Too late'
  document.querySelector('#late').append(a)
  document.querySelector('h1').textContent = 'Changed after the window'
}, ${NUXT_TIMINGS.lateMs})
`

export function nuxtSite(options: NuxtSiteOptions) {
  const shared = options.shared ?? 60
  const perPage = options.perPage ?? 15
  const paths = [...Array.from({ length: options.pages }, (_, i) => `/p/${i + 1}`), '/js-only']
  const assets = (path: string) => {
    const own = path.replaceAll('/', '_') || '_home'
    const list: string[] = []
    for (let i = 0; i < shared; i++) list.push(`/_nuxt/shared-${i}.${i % 3 === 0 ? 'css' : 'js'}`)
    for (let i = 0; i < perPage; i++)
      list.push(`/_nuxt/page${own}-${i}.${i % 3 === 0 ? 'css' : 'js'}`)
    return list
  }
  const document = (path: string, htmlLinks: string[], jsLinks: string[], head = '') => {
    const name = path === '/' ? 'home' : path.slice(1).replaceAll('/', ' ')
    const tags = assets(path)
      .map((asset) =>
        asset.endsWith('.css')
          ? `<link rel="stylesheet" href="${asset}">`
          : `<script type="module" src="${asset}"></script>`,
      )
      .join('')
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The served title of ${name} in this site</title>
<meta name="description" content="A description of ${name} that is long enough to say something about what it holds.">
<link rel="canonical" href="${SITE}${path}">${head}${tags}
<script type="module" src="/_nuxt/app.js"></script></head>
<body data-js-links="${jsLinks.join(',')}"><h1>The heading of ${name}</h1>
<main><p>Words about ${name} that the server writes in the HTML of the page for everyone.</p>
<nav>${htmlLinks.map((href) => `<a href="${href}">Go to ${href}</a>`).join('')}</nav>
<div id="js"></div><div id="late"></div></main></body></html>`
  }
  const pages = new Map<string, string>()
  const listed = paths.filter((path) => path !== '/js-only')
  pages.set('/', document('/', [...listed, ...(options.stuck ? ['/stuck'] : [])], ['/js-only']))
  for (const [index, path] of listed.entries()) {
    const next = listed[(index + 1) % listed.length]!
    pages.set(path, document(path, ['/', next], [listed[(index + 2) % listed.length]!]))
  }
  pages.set('/js-only', document('/js-only', ['/'], []))
  if (options.stuck)
    // Written by a script, so the crawl does not request it as a URL of its own: only the browser
    // asks for it, and it blocks the parser until it answers.
    pages.set(
      '/stuck',
      document(
        '/stuck',
        ['/'],
        [],
        `<script>document.write('<script src="/_nuxt/stuck.js"><\\/script>')</script>`,
      ),
    )

  const requests: string[] = []
  const createFetcher: CrawlEngineOptions['createFetcher'] = (config) => {
    const fetcher: Fetcher = {
      close() {},
      async fetch(url, { signal }) {
        signal.throwIfAborted()
        requests.push(url)
        const { origin, pathname, search } = new URL(url)
        // The site lives on one origin: the others redirect to it, like most sites.
        if (origin !== SITE) {
          return {
            statusCode: 301,
            headers: { location: `${SITE}${pathname}${search}` },
            body: null,
            truncated: false,
            bytes: 0,
            responseTimeMs: 1,
          }
        }
        const wait = (milliseconds: number) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, milliseconds)
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                reject(new DOMException('Aborted', 'AbortError'))
              },
              { once: true },
            )
          })
        const answer = (body: string, type: string): FetchedResponse => ({
          statusCode: 200,
          headers: { 'content-type': type },
          body: Buffer.from(body),
          truncated: false,
          bytes: Buffer.byteLength(body),
          responseTimeMs: 1,
        })
        if (pathname === '/api/poll' || pathname === '/_nuxt/stuck.js') {
          // Never answers: the fetcher gives up at its timeout, like the real one.
          await wait(config.timeoutMs)
          throw new FetchError('TIMEOUT', 'Timed out')
        }
        if (pathname === '/_nuxt/app.js') {
          await wait(delayOf(pathname))
          return answer(APP, 'text/javascript')
        }
        if (pathname.startsWith('/_nuxt/')) {
          await wait(delayOf(pathname))
          return pathname.endsWith('.css')
            ? answer(`.x${pathname.length}{color:red}`, 'text/css')
            : answer(`export const v = ${JSON.stringify(pathname)}`, 'text/javascript')
        }
        await wait(5)
        const body = search === '' ? pages.get(pathname) : undefined
        if (body !== undefined) return answer(body, 'text/html; charset=utf-8')
        if (pathname === '/robots.txt') return answer('User-agent: *\nAllow: /\n', 'text/plain')
        return {
          statusCode: 404,
          headers: { 'content-type': 'text/html' },
          body: Buffer.from('<title>Not found</title>'),
          truncated: false,
          bytes: 24,
          responseTimeMs: 1,
        }
      },
    }
    return fetcher
  }
  return { createFetcher, requests, paths: [...pages.keys()] }
}
