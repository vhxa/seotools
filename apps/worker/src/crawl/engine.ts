import {
  crawlUrlHash,
  defaultCrawlerUserAgent,
  isInternalUrl,
  normalizeCrawlUrl,
  type CrawlLinkKind,
  type CrawlPageData,
  type CrawlRobotsFiles,
  type CrawlSettings,
  type CrawlUrlKind,
  type CrawlUrlSource,
  type Logger,
} from '@seotools/core'
import type { Crawl, CrawlLink, CrawlUrlResult, Database, NewCrawlUrl } from '@seotools/db'
import { JobInterruptedError } from '../types'
import {
  extractCssUrls,
  extractHtml,
  parseLinkHeader,
  parseRefresh,
  parseRobotsSitemaps,
  parseSitemap,
  type ExtractedLink,
} from './extract'
import {
  FetchError,
  decodeSitemapBody,
  decodeText,
  type FetchedResponse,
  type Fetcher,
  type FetcherConfig,
} from './fetcher'

/** How many queued URLs are read from the database at a time. Must exceed the max concurrency. */
const QUEUE_BATCH = 200
/** How often the progress is saved and a cancellation looked for. */
const PROGRESS_INTERVAL_MS = 2000
/** robots.txt files past this size are ignored by Google, so nothing past it matters to an audit. */
const MAX_ROBOTS_BYTES = 512 * 1024
/** Longest pause a `Retry-After` header can impose on the whole crawl. */
const MAX_RETRY_AFTER_MS = 5 * 60_000
const RETRY_BASE_MS = 1000
const RETRYABLE_STATUS = new Set([429, 503])
/** Errors that will fail the same way on a second try, seconds later. */
const PERMANENT_ERRORS = new Set([
  'BLOCKED_ADDRESS',
  'ENOTFOUND',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])

const HTML = /^(text\/html|application\/xhtml\+xml)\b/i
const CSS = /^text\/css\b/i
const XML = /^(text\/xml|application\/(xml|[\w.+-]*\+xml))\b/i

export interface CrawlEngineOptions {
  db: Database
  log: Logger
  createFetcher: (config: Omit<FetcherConfig, 'allowPrivateNetworks'>) => Fetcher
  /** Aborted when the worker is shutting down. */
  signal: AbortSignal
  appVersion?: string
  /** Scales the waits between retries down in tests. */
  retryBaseMs?: number
}

export interface CrawlSummary {
  crawlId: string
  status: Crawl['status']
  pages: number
  urls: number
  external: number
}

interface Discovered {
  urls: NewCrawlUrl[]
  links: CrawlLink[]
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

/** `Retry-After` is either seconds or an HTTP date. */
function parseRetryAfter(value: string | undefined): number | null {
  if (!value) return null
  const seconds = Number(value)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : new Date(value).getTime() - Date.now()
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : null
}

const isRedirect = (status: number) => status >= 300 && status < 400 && status !== 304

/** Runs a crawl to its end, resuming from its stored queue if an earlier attempt was cut short. */
export async function runCrawl(
  crawlId: string,
  options: CrawlEngineOptions,
): Promise<CrawlSummary | null> {
  const { db, log: parentLog, signal } = options
  const retryBaseMs = options.retryBaseMs ?? RETRY_BASE_MS

  const crawl = await db.crawls.markRunning(crawlId)
  // Cancelled before it got to run. Its job has nothing left to do.
  if (!crawl) return null
  const domain = await db.domains.get(crawl.domainId)
  if (!domain) return null

  const settings: CrawlSettings = await db.crawls.settings(crawl.domainId)
  const { host } = domain
  const followLinks = crawl.type === 'full'
  const log = parentLog.child({ crawlId, host, crawlType: crawl.type })
  const fetcher = options.createFetcher({
    userAgent: settings.userAgent ?? defaultCrawlerUserAgent(options.appVersion),
    timeoutMs: settings.timeoutMs,
    concurrency: settings.concurrency,
  })

  /** Stops every request and wait at once: shutdown, a cancellation or a fatal error. */
  const stop = new AbortController()
  const stopSignal = AbortSignal.any([signal, stop.signal])

  const seen = new Set<string>()
  let internalCount = 0
  let externalCount = 0
  for (const known of await db.crawls.knownUrls(crawlId)) {
    seen.add(known.urlHash)
    if (known.scope === 'internal') internalCount++
    else externalCount++
  }
  const counts = await db.crawls.countUrls(crawlId)
  let pagesCount = counts.pagesCount
  let doneCount = counts.urlsDoneCount
  const robots: CrawlRobotsFiles = { ...(crawl.robots ?? {}) }
  // A resumed crawl that was already at the limit has lost track of what it left out.
  let truncated = settings.maxUrls !== null && internalCount >= settings.maxUrls

  /** Adds a URL to the crawl unless it is known, or the limit says otherwise. `false` if dropped. */
  function admit(url: string, source: CrawlUrlSource, depth: number, out: NewCrawlUrl[]): boolean {
    const urlHash = crawlUrlHash(url)
    if (seen.has(urlHash)) return true
    const scope = isInternalUrl(url, host) ? 'internal' : 'external'
    const current = scope === 'internal' ? internalCount : externalCount
    if (settings.maxUrls !== null && current >= settings.maxUrls) {
      truncated = true
      return false
    }
    seen.add(urlHash)
    if (scope === 'internal') internalCount++
    else externalCount++
    out.push({ url, urlHash, scope, source, depth })
    return true
  }

  function discover(
    into: Discovered,
    sourceHash: string,
    url: string,
    kind: CrawlLinkKind,
    source: CrawlUrlSource,
    depth: number,
  ) {
    if (!followLinks) return
    if (admit(url, source, depth, into.urls)) {
      into.links.push({ sourceHash, targetHash: crawlUrlHash(url), kind })
    }
  }

  async function seed() {
    const urls: NewCrawlUrl[] = []
    for (const { url } of await db.priorityUrls.list(crawl!.domainId)) {
      admit(url, 'priority', 0, urls)
    }
    if (followLinks) {
      const hosts = [host, `www.${host}`]
      for (const name of hosts) {
        for (const scheme of ['https', 'http']) {
          admit(`${scheme}://${name}/`, 'seed', 0, urls)
          admit(`${scheme}://${name}/robots.txt`, 'robots', 0, urls)
        }
        admit(`https://${name}/sitemap.xml`, 'sitemap-file', 0, urls)
        admit(`https://${name}/sitemap_index.xml`, 'sitemap-file', 0, urls)
      }
    }
    await db.crawls.addUrls(crawlId, urls)
  }

  /** Paces requests: `requestsPerSecond` across all of them, and any pause a server asked for. */
  const interval = 1000 / settings.requestsPerSecond
  let nextSlot = 0
  let pausedUntil = 0
  async function waitForSlot() {
    const now = Date.now()
    const at = Math.max(now, nextSlot, pausedUntil)
    nextSlot = at + interval
    await abortableSleep(at - now, stopSignal)
    // A pause may have started while this request was waiting its turn.
    while (Date.now() < pausedUntil && !stopSignal.aborted) {
      await abortableSleep(pausedUntil - Date.now(), stopSignal)
    }
  }

  async function fetchWithRetries(item: NewCrawlUrl): Promise<FetchedResponse | FetchError> {
    const readBody =
      item.source === 'robots' || item.source === 'sitemap-file'
        ? ('force' as const)
        : ('auto' as const)
    for (let attempt = 0; ; attempt++) {
      await waitForSlot()
      if (stopSignal.aborted) throw new DOMException('Crawl stopped', 'AbortError')
      const backoff = retryBaseMs * 2 ** attempt
      try {
        const response = await fetcher.fetch(item.url, { signal: stopSignal, readBody })
        if (!RETRYABLE_STATUS.has(response.statusCode) || attempt >= settings.maxRetries) {
          return response
        }
        // The server asked to slow down: every request of the domain waits, not just this one.
        const wait = parseRetryAfter(response.headers['retry-after']) ?? backoff
        pausedUntil = Math.max(pausedUntil, Date.now() + wait)
        log.info({ url: item.url, status: response.statusCode, wait }, 'server asked to slow down')
      } catch (error) {
        if (!(error instanceof FetchError)) throw error
        if (PERMANENT_ERRORS.has(error.code) || attempt >= settings.maxRetries) return error
        await abortableSleep(backoff, stopSignal)
      }
    }
  }

  function analyse(
    item: NewCrawlUrl,
    response: FetchedResponse,
  ): { result: CrawlUrlResult; found: Discovered } {
    const { statusCode, headers, body } = response
    const found: Discovered = { urls: [], links: [] }
    const contentType = headers['content-type'] ?? null
    const depth = item.depth + 1
    const fromHere = (url: string, kind: CrawlLinkKind, source: CrawlUrlSource = 'link') =>
      discover(found, item.urlHash, url, kind, source, depth)
    const addAll = (links: ExtractedLink[]) => {
      for (const { url, kind } of links) fromHere(url, kind)
    }

    let kind: CrawlUrlKind = 'resource'
    let redirectTo: string | null = null
    let canonical: string | null = null
    let title: string | null = null
    let metaRobots: string | null = null
    const data: CrawlPageData = {}

    const linkHeader = headers.link ? parseLinkHeader(headers.link, item.url) : null
    if (linkHeader) {
      addAll(linkHeader.links)
      canonical = linkHeader.canonical
      if (linkHeader.hreflang.length > 0) data.hreflang = linkHeader.hreflang
    }
    if (headers.refresh) {
      const target = normalizeCrawlUrl(parseRefresh(headers.refresh) ?? '', item.url)
      if (target) fromHere(target, 'http-header')
    }

    if (isRedirect(statusCode)) {
      kind = 'redirect'
      redirectTo = headers.location ? normalizeCrawlUrl(headers.location, item.url) : null
      if (redirectTo) {
        // A moved robots.txt or sitemap is still one, so it gets parsed where it landed.
        const special = item.source === 'robots' || item.source === 'sitemap-file'
        fromHere(redirectTo, 'redirect', special ? item.source : 'redirect')
      }
    } else if (item.source === 'robots') {
      const text =
        statusCode === 200 && body
          ? decodeText(body.subarray(0, MAX_ROBOTS_BYTES), contentType ?? undefined)
          : null
      if (text !== null) {
        for (const sitemap of parseRobotsSitemaps(text, item.url)) {
          fromHere(sitemap, 'sitemap', 'sitemap-file')
        }
      }
    } else if (item.source === 'sitemap-file' || (body && contentType && XML.test(contentType))) {
      if (statusCode === 200 && body) {
        try {
          const sitemap = parseSitemap(decodeSitemapBody(body), item.url)
          for (const url of sitemap.urls) fromHere(url, 'sitemap', 'sitemap')
          for (const url of sitemap.sitemaps) fromHere(url, 'sitemap', 'sitemap-file')
        } catch (error) {
          log.warn({ url: item.url, err: error }, 'could not read sitemap')
        }
      }
    } else if (contentType && HTML.test(contentType)) {
      kind = 'page'
      if (body) {
        const page = extractHtml(decodeText(body, contentType), item.url)
        addAll(page.links)
        title = page.title
        metaRobots = page.metaRobots
        canonical = page.canonical ?? canonical
        if (page.description) data.description = page.description
        if (page.h1.length > 0) data.h1 = page.h1
        if (page.hreflang.length > 0) data.hreflang = [...(data.hreflang ?? []), ...page.hreflang]
        if (Object.keys(page.botRobots).length > 0) data.botRobots = page.botRobots
      }
    } else if (contentType && CSS.test(contentType) && body) {
      addAll(extractCssUrls(decodeText(body, contentType), item.url))
    }
    if (response.truncated) data.truncated = true

    return {
      found,
      result: {
        kind,
        statusCode,
        contentType,
        redirectTo,
        title,
        metaRobots,
        xRobotsTag: headers['x-robots-tag'] ?? null,
        canonical,
        responseTimeMs: response.responseTimeMs,
        bytes: response.bytes,
        error: null,
        data: Object.keys(data).length > 0 ? data : null,
      },
    }
  }

  function failureResult(error: FetchError): CrawlUrlResult {
    return {
      kind: 'unknown',
      statusCode: null,
      contentType: null,
      redirectTo: null,
      title: null,
      metaRobots: null,
      xRobotsTag: null,
      canonical: null,
      responseTimeMs: error.responseTimeMs,
      bytes: null,
      error: `${error.code}: ${error.message}`,
      data: null,
    }
  }

  async function processUrl(item: NewCrawlUrl) {
    const outcome = await fetchWithRetries(item)
    let result: CrawlUrlResult
    let found: Discovered = { urls: [], links: [] }
    if (outcome instanceof FetchError) {
      result = failureResult(outcome)
    } else {
      ;({ result, found } = analyse(item, outcome))
    }
    if (item.source === 'robots') {
      const { origin } = new URL(item.url)
      const answered = outcome instanceof FetchError ? null : outcome
      const text =
        answered?.body && answered.statusCode === 200
          ? decodeText(
              answered.body.subarray(0, MAX_ROBOTS_BYTES),
              answered.headers['content-type'],
            )
          : null
      robots[origin] = { status: answered?.statusCode ?? null, body: text }
      await db.crawls.saveRobots(crawlId, robots)
    }
    await db.crawls.recordResult({ crawlId, urlHash: item.urlHash, result, ...found })
    doneCount++
    if (result.kind === 'page') pagesCount++
  }

  async function saveProgress() {
    await db.crawls.updateCounts(crawlId, {
      pagesCount,
      urlsCount: internalCount,
      urlsDoneCount: doneCount,
      externalCount,
    })
  }

  const inFlight = new Map<string, Promise<void>>()
  let fatal: unknown
  const start = (item: NewCrawlUrl) => {
    const task: Promise<void> = processUrl(item)
      .catch((error) => {
        // Being stopped leaves the URL queued, for whoever resumes the crawl.
        if (stopSignal.aborted) return
        fatal ??= error
        stop.abort()
      })
      .finally(() => inFlight.delete(item.urlHash))
    inFlight.set(item.urlHash, task)
  }

  /** Waits for a request to end, but never so long that a cancellation goes unnoticed. */
  const waitForProgress = () =>
    Promise.race([...inFlight.values(), abortableSleep(PROGRESS_INTERVAL_MS, stopSignal)])

  let cancelled = false
  let lastProgress = Date.now()
  async function heartbeat() {
    if (Date.now() - lastProgress < PROGRESS_INTERVAL_MS) return
    lastProgress = Date.now()
    await saveProgress()
    const current = await db.crawls.get(crawlId)
    if (current?.status !== 'running') {
      cancelled = true
      stop.abort()
    }
  }

  try {
    await seed()

    const queue: NewCrawlUrl[] = []
    while (!stopSignal.aborted) {
      await heartbeat()
      if (queue.length === 0) {
        const batch = await db.crawls.nextQueued(crawlId, QUEUE_BATCH)
        queue.push(...batch.filter((item) => !inFlight.has(item.urlHash)))
      }
      const item = queue[0]
      if (!item) {
        if (inFlight.size === 0) break
        await waitForProgress()
        continue
      }
      if (inFlight.size >= settings.concurrency) {
        await waitForProgress()
        continue
      }
      queue.shift()
      start(item)
    }
    await Promise.allSettled(inFlight.values())
  } finally {
    fetcher.close()
  }

  if (fatal) throw fatal
  if (signal.aborted) {
    await saveProgress()
    throw new JobInterruptedError()
  }

  // A cancellation can also arrive after the last URL: `finish` then reports nothing changed.
  const status = truncated ? 'incomplete' : 'completed'
  const finished = !cancelled && (await db.crawls.finish(crawlId, { status }))
  try {
    await db.crawls.prune({
      domainId: crawl.domainId,
      type: crawl.type,
      keep: settings.retainCrawls,
    })
  } catch (error) {
    log.warn({ err: error }, 'could not prune old crawl results')
  }
  const final = await db.crawls.get(crawlId)
  log.info(
    { status: final?.status, pages: final?.pagesCount, urls: final?.urlsCount },
    'crawl ended',
  )
  return {
    crawlId,
    status: finished ? status : (final?.status ?? 'cancelled'),
    pages: final?.pagesCount ?? pagesCount,
    urls: final?.urlsCount ?? internalCount,
    external: final?.externalCount ?? externalCount,
  }
}
