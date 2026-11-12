import { CRAWL_FILE_RETRY_INTERVAL_MS } from './file-refresher'
import type { NewCrawlFile } from '@seotools/db'
import { siteHeaders } from './credentials'
import {
  DEFAULT_CRAWL_SETTINGS,
  crawlFileKindOf,
  crawlFileRequests,
  crawlFileSource,
  crawlUrlHash,
  crawlSkipReason,
  defaultCrawlerUserAgent,
  isInternalUrl,
  normalizeCrawlUrl,
  stripIgnoredParameters,
  type CrawlLinkKind,
  type LinkContext,
  type CrawlRobotsFiles,
  type CrawlSettings,
  type CrawlUrlSource,
  type Logger,
} from '@seotools/core'
import type { Crawl, CrawlLink, CrawlUrlResult, Database, NewCrawlUrl } from '@seotools/db'
import { JobInterruptedError } from '../types'
import { analyseCrawl, currentAuditConfig } from './analysis'
import type { ParsedSitemap } from './extract'
import {
  FetchError,
  decodeText,
  type FetchedResponse,
  type Fetcher,
  type FetcherConfig,
} from './fetcher'
import {
  CRAWL_FILE_REFRESH_INTERVAL_MS,
  captureCrawlFile,
  crawlFileFetchOptions,
  fetchCrawlFiles,
} from './files'
import { createRequester } from './requester'
import { PERMANENT_ERRORS, RETRY_BASE_MS, abortableSleep, isRedirect } from './requests'
import { MAX_ROBOTS_BYTES, analyseResponse, emptyResult, failureResult } from './response'

/** How many queued URLs are read from the database at a time. Must exceed the max concurrency. */
const QUEUE_BATCH = 200
/** How often the progress is saved and a cancellation looked for. */
const PROGRESS_INTERVAL_MS = 2000

/** Whether a link to another site works does not depend on its body: the least that can be read. */
const EXTERNAL_BODY_BYTES = 1

export interface CrawlEngineOptions {
  settingsSecret?: string
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

/** How a URL can be asked for that makes it a resource, whatever its server answers. */
const RESOURCE_REFERENCES: ReadonlySet<CrawlLinkKind> = new Set(['script', 'style', 'image'])

/** Days of compact history when the default setting keeps it always (it does not today). */
const HISTORY_DAYS_FALLBACK = 30

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
  settings.ignoredParameters = crawl.ignoredParameters ?? []
  const { host } = domain
  const identity = (url: string) => stripIgnoredParameters(url, settings.ignoredParameters, host)
  const followLinks = crawl.type === 'full'
  const log = parentLog.child({ crawlId, host, crawlType: crawl.type })
  const fetcher = options.createFetcher({
    siteHeaders: await siteHeaders(db, domain.id, domain.host, options.settingsSecret),
    userAgent: settings.userAgent ?? defaultCrawlerUserAgent(options.appVersion),
    timeoutMs: settings.timeoutMs,
    concurrency: settings.concurrency,
  })

  /** Stops every request and wait at once: shutdown, a cancellation or a fatal error. */
  const stop = new AbortController()
  const stopSignal = AbortSignal.any([signal, stop.signal])

  /** Every URL of the crawl by hash, with its number (`seq`). */
  const seen = new Map<string, number>()
  let lastSeq = 0
  let internalCount = 0
  let externalCount = 0
  for (const known of await db.crawls.knownUrls(crawlId)) {
    seen.set(known.urlHash, known.seq ?? 0)
    lastSeq = Math.max(lastSeq, known.seq ?? 0)
    if (known.scope === 'internal') internalCount++
    else externalCount++
  }
  const counts = await db.crawls.countUrls(crawlId)
  let pagesCount = counts.pagesCount
  let doneCount = counts.urlsDoneCount
  const robots: CrawlRobotsFiles = { ...(crawl.robots ?? {}) }
  // A resumed crawl that was already at the limit has lost track of what it left out.
  let truncated = !crawl.seedUrls && settings.maxUrls !== null && internalCount >= settings.maxUrls

  /** Adds a URL to the crawl unless it is known, or the limit says otherwise. `false` if dropped. */
  function admit(
    url: string,
    source: CrawlUrlSource,
    depth: number,
    out: NewCrawlUrl[],
    from?: { seq: number; kind: CrawlLinkKind },
  ): boolean {
    url = identity(url)
    const urlHash = crawlUrlHash(url)
    if (seen.has(urlHash)) return true
    const scope = isInternalUrl(url, host) ? 'internal' : 'external'
    const current = scope === 'internal' ? internalCount : externalCount
    if (!crawl!.seedUrls && settings.maxUrls !== null && current >= settings.maxUrls) {
      truncated = true
      return false
    }
    const seq = ++lastSeq
    seen.set(urlHash, seq)
    if (scope === 'internal') internalCount++
    else externalCount++
    out.push({
      url,
      urlHash,
      scope,
      source,
      depth,
      ...(scope === 'internal' && depth > 0
        ? { notRequested: crawlSkipReason(url, depth, settings) }
        : {}),
      seq,
      ...(from ? { foundFrom: from.seq, foundKind: from.kind } : {}),
    })
    return true
  }

  function discover(
    into: Discovered,
    from: NewCrawlUrl,
    url: string,
    kind: CrawlLinkKind,
    source: CrawlUrlSource,
    depth: number,
    context?: LinkContext,
  ) {
    if (!followLinks) return
    url = identity(url)
    if (admit(url, source, depth, into.urls, { seq: from.seq, kind })) {
      const targetHash = crawlUrlHash(url)
      const targetSeq = seen.get(targetHash)
      into.links.push({
        sourceHash: from.urlHash,
        targetHash,
        kind,
        // Unnumbered (queued before 0019): the database looks the ends up instead.
        ...(from.seq ? { sourceSeq: from.seq } : {}),
        ...(targetSeq ? { targetSeq } : {}),
        ...(context ? { context } : {}),
      })
    }
  }

  async function seed() {
    const urls: NewCrawlUrl[] = []
    // Before the priority URLs: a file marked as priority still has to be read as what it is.
    if (followLinks) {
      for (const name of [host, `www.${host}`]) {
        for (const scheme of ['https', 'http']) admit(`${scheme}://${name}/`, 'seed', 0, urls)
      }
      for (const { url, kind } of crawlFileRequests(host, settings)) {
        admit(url, crawlFileSource(kind), 0, urls)
      }
    }
    for (const { url } of crawl!.seedUrls?.map((url) => ({ url })) ??
      (await db.priorityUrls.list(crawl!.domainId))) {
      admit(url, 'priority', 0, urls)
    }
    await db.crawls.addUrls(crawlId, urls)
  }

  const { waitForSlot, fetchWithRetries: request } = createRequester({
    fetcher,
    settings,
    signal: stopSignal,
    retryBaseMs,
    log,
  })

  function fetchWithRetries(item: NewCrawlUrl) {
    const fileKind = crawlFileKindOf(item.source)
    return request(item.url, fileKind ? crawlFileFetchOptions(fileKind) : { readBody: 'auto' })
  }

  function analyse(
    item: NewCrawlUrl,
    response: FetchedResponse,
  ): { result: CrawlUrlResult; found: Discovered; sitemap?: ParsedSitemap | null } {
    const found: Discovered = { urls: [], links: [] }
    const depth = item.depth + 1
    const { result, sitemap } = analyseResponse({
      item,
      response,
      optionalFiles: settings.optionalFiles,
      extractors: settings.extractors,
      log,
      discover: (url, kind, source = 'link', context) =>
        discover(found, item, url, kind, source, depth, context),
    })
    return { result, found, sitemap }
  }

  const observedFiles: NewCrawlFile[] = []
  let filesCapped = false
  async function processUrl(item: NewCrawlUrl) {
    const outcome = await fetchWithRetries(item)
    let result: CrawlUrlResult
    let found: Discovered = { urls: [], links: [] }
    let sitemap: ParsedSitemap | null | undefined
    if (outcome instanceof FetchError) {
      result = failureResult(outcome)
    } else {
      ;({ result, found, sitemap } = analyse(item, outcome))
      // Asked for as a script, stylesheet, image or media file, it is one, whatever it answered:
      // a missing `.js` that answers with an HTML error page is a broken resource, not a page.
      if (result.kind === 'page' && item.foundKind && RESOURCE_REFERENCES.has(item.foundKind)) {
        result = { ...result, kind: 'resource' }
      }
    }
    const fileKind = crawlFileKindOf(item.source)
    if (fileKind) {
      observedFiles.push(
        captureCrawlFile({
          request: { url: item.url, kind: fileKind },
          outcome,
          via: 'crawl',
          fetchedAt: new Date(),
          ...(sitemap === undefined ? {} : { sitemap }),
        }),
      )
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
    if (sitemap && followLinks && sitemap.hreflang.length > 0) {
      // Before the result: a crawl resumed in between requests the sitemap again, not the reverse.
      await db.crawls.addSitemapHreflang(
        crawlId,
        sitemap.hreflang.map(({ page, lang, url }) => ({
          pageHash: crawlUrlHash(identity(page)),
          lang,
          url,
        })),
      )
    }
    await db.crawls.recordResult({ crawlId, urlHash: item.urlHash, result, ...found })
    doneCount++
    // What counts as a page: HTML that answered 2xx (a page that fails is an error).
    const ok = result.statusCode !== null && result.statusCode >= 200 && result.statusCode < 300
    if (result.kind === 'page' && ok) pagesCount++
  }

  /**
   * Finds out whether a link to another site still works. Only ever on the default ports, like the
   * URLs of the site: a link should not be able to point the crawler at any service of a host. The
   * body does not matter, and a server asking to slow down has no say over the audited site.
   */
  async function checkExternalLink(item: NewCrawlUrl) {
    const port = new URL(item.url).port
    let result: CrawlUrlResult = emptyResult
    if (port === '' || port === '80' || port === '443') {
      for (let attempt = 0; ; attempt++) {
        await waitForSlot()
        if (stopSignal.aborted) throw new DOMException('Crawl stopped', 'AbortError')
        try {
          const response = await fetcher.fetch(item.url, {
            signal: stopSignal,
            maxBytes: EXTERNAL_BODY_BYTES,
          })
          result = {
            ...emptyResult,
            statusCode: response.statusCode,
            contentType: response.headers['content-type'] ?? null,
            redirectTo: isRedirect(response.statusCode)
              ? normalizeCrawlUrl(response.headers.location ?? '', item.url)
              : null,
            responseTimeMs: response.responseTimeMs,
          }
          break
        } catch (error) {
          if (!(error instanceof FetchError)) throw error
          if (PERMANENT_ERRORS.has(error.code) || attempt >= settings.maxRetries) {
            result = failureResult(error)
            break
          }
          await abortableSleep(retryBaseMs * 2 ** attempt, stopSignal)
        }
      }
    }
    await db.crawls.recordResult({ crawlId, urlHash: item.urlHash, result })
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
  const inFlightDepth = new Map<string, number>()
  let fatal: unknown
  const start = (item: NewCrawlUrl, handle: (item: NewCrawlUrl) => Promise<void>) => {
    inFlightDepth.set(item.urlHash, item.depth)
    const task: Promise<void> = handle(item)
      .catch((error) => {
        // Being stopped leaves the URL queued, for whoever resumes the crawl.
        if (stopSignal.aborted) return
        fatal ??= error
        stop.abort()
      })
      .finally(() => {
        inFlight.delete(item.urlHash)
        inFlightDepth.delete(item.urlHash)
      })
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

  /** Goes through what `next` returns, until it returns nothing and nothing is in flight. */
  async function drain(
    next: (limit: number) => Promise<NewCrawlUrl[]>,
    handle: (item: NewCrawlUrl) => Promise<void>,
  ) {
    const queue: NewCrawlUrl[] = []
    while (!stopSignal.aborted) {
      await heartbeat()
      if (queue.length === 0) {
        const batch = await next(QUEUE_BATCH)
        queue.push(...batch.filter((item) => !inFlight.has(item.urlHash)))
      }
      const item = queue[0]
      if (!item) {
        if (inFlight.size === 0) break
        await waitForProgress()
        continue
      }
      // Finish a breadth level before starting the next: depth is the shortest discovered path,
      // even when a slow sibling links directly to something a fast branch also reaches.
      if (
        inFlight.size >= settings.concurrency ||
        (settings.maxDepth !== null && item.depth > Math.min(...inFlightDepth.values()))
      ) {
        await waitForProgress()
        continue
      }
      queue.shift()
      start(item, handle)
    }
    await Promise.allSettled(inFlight.values())
  }

  try {
    await seed()
    await drain((limit) => db.crawls.nextQueued(crawlId, limit), processUrl)
    // Last, with the site done: while it runs, the crawl is still active and can be cancelled.
    if (followLinks) {
      await drain((limit) => db.crawls.pendingExternalLinks(crawlId, limit), checkExternalLink)
    }
    // Done URLs survive a shutdown; the in-memory file batch does not. Re-acquire a complete
    // observation on resumed attempts before publishing or pruning any current file rows.
    if (counts.urlsDoneCount > 0 && !signal.aborted && !cancelled && !fatal) {
      const fresh = await fetchCrawlFiles({
        host,
        settings,
        fetcher,
        signal: stopSignal,
        now: () => new Date(),
        retryBaseMs,
      })
      observedFiles.splice(0, observedFiles.length, ...fresh.files)
      filesCapped = fresh.capped
    }
  } finally {
    fetcher.close()
  }

  if (fatal) {
    // The domain was deleted while it ran: its crawl is gone with it, and so is any reason to fail.
    if (!(await db.crawls.get(crawlId))) {
      log.info('the crawl was removed while it ran')
      return null
    }
    throw fatal
  }
  if (signal.aborted) {
    await saveProgress()
    throw new JobInterruptedError()
  }

  // A cancellation can also arrive after the last URL: `finish` then reports nothing changed.
  const status = truncated ? 'incomplete' : 'completed'
  const finished = !cancelled && (await db.crawls.finish(crawlId, { status }))
  if (finished && !followLinks) {
    await db.crawlFiles
      .save(crawl.domainId, observedFiles)
      .catch((error) => log.warn({ err: error }, 'could not update crawl files'))
  }
  if (finished && followLinks && observedFiles.length > 0) {
    try {
      // The files were just requested: asking again in a moment would only add traffic.
      const checkedAt = new Date()
      const reachable = observedFiles.some((file) => file.statusCode !== null)
      await db.crawlFiles.finishCheck({
        domainId: crawl.domainId,
        outcome: reachable ? 'ok' : 'unreachable',
        files: observedFiles,
        checkedAt,
        nextCheckAt: new Date(
          checkedAt.getTime() +
            (reachable ? CRAWL_FILE_REFRESH_INTERVAL_MS : CRAWL_FILE_RETRY_INTERVAL_MS),
        ),
      })

      // A crawl that stopped at its limit may not have got to every file, so it removes none.
      if (status === 'completed' && reachable) {
        await db.crawlFiles.prune({
          domainId: crawl.domainId,
          before: crawl.createdAt,
          ...(filesCapped ? { keepKinds: ['sitemap'] as const } : {}),
        })
      }
    } catch (error) {
      log.warn({ err: error }, 'could not update the crawl files')
    }
  }
  // Only a full crawl says what the pages of the site are like: a priority one sees a few of them.
  if (finished && crawl.type === 'full') {
    try {
      await analyseCrawl(db, crawlId, await currentAuditConfig(db, crawl.domainId))
    } catch (error) {
      log.warn({ err: error }, 'could not check the pages for issues')
    }
  }
  try {
    await db.crawls.prune({
      domainId: crawl.domainId,
      type: crawl.type,
      keep: settings.retainCrawls,
    })
    // History past the domain's days goes too, whether or not anything was pruned now.
    await db.crawls.expireHistory({
      now: new Date(),
      defaultDays: DEFAULT_CRAWL_SETTINGS.historyDays ?? HISTORY_DAYS_FALLBACK,
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
