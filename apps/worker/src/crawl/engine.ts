import { getWorkerBuildInfo } from '../build-info'
import { createHmac, createHash } from 'node:crypto'
import { repeatAnswers } from './paired'
import { createRenderResourceCache } from '../render/cache'
import { fingerprintSet } from '../render/fingerprints'
import { RENDER_LIMITS } from '../render/limits'
import type { RenderService } from '../render/service'
import { createSlots } from '../render/slots'
import {
  BrowserWaitExpiredError,
  createBrowserRecovery,
  notRenderedObservation,
  renderObservation,
  renderRobots,
} from './rendering'
import { CRAWL_FILE_RETRY_INTERVAL_MS } from './file-refresher'
import type { NewCrawlFile } from '@seotools/db'
import { siteHeaders } from './credentials'
import {
  DEFAULT_CRAWL_SETTINGS,
  CRAWL_URL_SOURCES,
  crawlFileKindOf,
  crawlFileRequests,
  crawlFileSource,
  crawlUrlHash,
  crawlSkipReason,
  defaultCrawlerUserAgent,
  isInternalUrl,
  normalizeCrawlUrl,
  renderOmittedEndpoint,
  stripIgnoredParameters,
  type CrawlLinkKind,
  type CrawlPageFacts,
  type FirstRequestFailure,
  type LinkContext,
  type CrawlRobotsFiles,
  type CrawlSettings,
  type CrawlUrlSource,
  type Logger,
} from '@seotools/core'
import type {
  Crawl,
  CrawlLink,
  CrawlUrlResult,
  CrawlUrlRender,
  Database,
  NewCrawlUrl,
  SecondAttemptCandidate,
} from '@seotools/db'
import { JobInterruptedError, PermanentJobError } from '../types'
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
import { ExcessiveRetryAfterError, createRequester, type RequestOptions } from './requester'
import {
  PERMANENT_ERRORS,
  RETRY_BASE_MS,
  abortableSleep,
  isRedirect,
  isTemporaryStatus,
} from './requests'
import { MAX_ROBOTS_BYTES, analyseResponse, emptyResult, failureResult } from './response'
import { isGuessSource } from './site-audit'
import { explainLatestPair, type ExplainSources } from './explain'

/** How many queued URLs are read from the database at a time. Must exceed the max concurrency. */
const QUEUE_BATCH = 200
/** How often the progress is saved and a cancellation looked for. */
const PROGRESS_INTERVAL_MS = 2000
/** Give a transient failure time to clear, with an all-or-nothing cap on extra traffic. */
const SECOND_PASS_WAIT_MS = 60_000
export const SECOND_PASS_LIMIT = 2000

/** Whether a link to another site works does not depend on its body: the least that can be read. */
const EXTERNAL_BODY_BYTES = 1

export interface CrawlEngineOptions {
  renderService?: Pick<RenderService, 'check' | 'render'> & { concurrency?: number }
  browserMaxWaitMs?: number
  browserPollMs?: number
  settingsSecret?: string
  db: Database
  log: Logger
  createFetcher: (config: Omit<FetcherConfig, 'allowPrivateNetworks'>) => Fetcher
  /** Aborted when the worker is shutting down. */
  signal: AbortSignal
  appVersion?: string
  /** Scales the waits between retries down in tests. */
  retryBaseMs?: number
  /** Scales the pause before the delayed retry in tests. */
  secondPassWaitMs?: number
  /** What explaining the pair reads from other packages (capture rule, site variation, reach). */
  explainSources?: ExplainSources
}

export interface CrawlSummary {
  crawlId: string
  status: Crawl['status']
  pages: number
  urls: number
  external: number
}

class SecondAttemptUnavailable extends Error {}

interface Discovered {
  urls: NewCrawlUrl[]
  links: CrawlLink[]
}

/** How a URL can be asked for that makes it a resource, whatever its server answers. */
const RESOURCE_REFERENCES: ReadonlySet<CrawlLinkKind> = new Set(['script', 'style', 'image'])
const BLOCKABLE_RENDER_REFERENCES: ReadonlySet<CrawlLinkKind> = new Set([
  'script',
  'style',
  'frame',
  'head-link',
  'image',
  'media',
])

/** Days of compact history when the default setting keeps it always (it does not today). */
const HISTORY_DAYS_FALLBACK = 30

/** Runs a crawl to its end, resuming from its stored queue if an earlier attempt was cut short. */
export async function runCrawl(
  crawlId: string,
  options: CrawlEngineOptions,
): Promise<CrawlSummary | null> {
  const { db, log: parentLog, signal } = options
  const retryBaseMs = options.retryBaseMs ?? RETRY_BASE_MS

  const crawl = await db.crawls.markRunning(crawlId, getWorkerBuildInfo())
  // Cancelled before it got to run. Its job has nothing left to do.
  if (!crawl) return null
  const domain = await db.domains.get(crawl.domainId)
  if (!domain) return null

  const snapshot = crawl.discoverySettings
  const settings: CrawlSettings = {
    ...(await db.crawls.settings(crawl.domainId)),
    ...snapshot,
    ignoredParameters: crawl.ignoredParameters ?? [],
  }
  const { host } = domain
  const identity = (url: string) => stripIgnoredParameters(url, settings.ignoredParameters, host)
  const followLinks = crawl.type === 'full'
  const log = parentLog.child({ crawlId, host, crawlType: crawl.type })
  const rendered = crawl.rendering?.mode === 'rendered'
  // Rendered pages fetch their resources in parallel, a few per page and a bounded number for the
  // whole crawl, besides the crawl's own requests: the connections must not be what holds them up.
  const resourceSlots = createSlots(
    RENDER_LIMITS.pageResources * Math.max(1, options.renderService?.concurrency ?? 1),
  )
  const headers =
    snapshot?.requestCredentialsSet === false
      ? undefined
      : await siteHeaders(db, domain.id, domain.host, options.settingsSecret)
  if (snapshot?.requestCredentialsSet && !headers) {
    throw new PermanentJobError('request-credentials-unavailable')
  }
  const userAgent = settings.userAgent ?? defaultCrawlerUserAgent(options.appVersion)
  // A restart can change credentials or the build's default User-Agent. A keyed fingerprint
  // permits a repeat only under the same settings without retaining credentials.
  const context = (headers ? createHmac('sha256', options.settingsSecret!) : createHash('sha256'))
    .update(
      JSON.stringify([
        // Change this version if the paired extractor or identity contract changes.
        3,
        userAgent,
        Object.entries(headers?.headers ?? {}).sort(),
        settings.ignoredParameters,
      ]),
    )
    .digest('hex')
  const fetcher = options.createFetcher({
    siteHeaders: headers,
    userAgent,
    timeoutMs: settings.timeoutMs,
    concurrency:
      settings.concurrency +
      (rendered ? RENDER_LIMITS.pageResources * (options.renderService?.concurrency ?? 1) : 0),
  })

  /** Stops every request and wait at once: shutdown, a cancellation or a fatal error. */
  const stop = new AbortController()
  const stopSignal = AbortSignal.any([signal, stop.signal])
  /** Ends the resource fetches pages share through the cache, when the crawl stops or ends. */
  const resourcesDone = new AbortController()
  const resourceSignal = AbortSignal.any([stopSignal, resourcesDone.signal])

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
  let truncated =
    crawl.admissionDropped ??
    (!crawl.seedUrls &&
      settings.maxUrls !== null &&
      Math.max(internalCount, externalCount) >= settings.maxUrls)
  let admissionWrite: Promise<void> | undefined
  function persistAdmissionDrop() {
    if (truncated && !crawl?.admissionDropped)
      return (admissionWrite ??= db.crawls.markAdmissionDropped(crawlId))
  }

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
    await persistAdmissionDrop()
    await db.crawls.addUrls(crawlId, urls)
  }

  const requester = createRequester({
    fetcher,
    settings,
    signal: stopSignal,
    retryAfterUntil: crawl.retryAfterUntil?.getTime(),
    persistRetryAfter: (until) => db.crawls.extendRetryAfter(crawlId, new Date(until)),
    retryBaseMs,
    log,
  })

  const { dispatch, fetchWithRetries: request } = requester

  function fetchWithRetries(item: NewCrawlUrl, requestOptions: RequestOptions) {
    const fileKind = crawlFileKindOf(item.source)
    return request(item.url, {
      ...(fileKind ? crawlFileFetchOptions(fileKind) : { readBody: 'auto' }),
      ...requestOptions,
    })
  }

  function analyse(
    item: NewCrawlUrl,
    response: FetchedResponse,
    renderedHtml?: string,
    servedLinks?: ReadonlySet<string>,
    observeLink?: (url: string, kind: CrawlLinkKind) => void,
    keepLink?: (url: string, kind: CrawlLinkKind) => boolean,
    renderedDocumentUrl?: string,
  ): { result: CrawlUrlResult; found: Discovered; sitemap?: ParsedSitemap | null } {
    const found: Discovered = { urls: [], links: [] }
    const depth = item.depth + 1
    const { result, sitemap } = analyseResponse({
      item,
      response,
      renderedHtml,
      renderedDocumentUrl,
      keepLink,
      optionalFiles: settings.optionalFiles,
      extractors: settings.extractors,
      log,
      discover: (url, kind, source = 'link', context) => {
        observeLink?.(identity(url), kind)
        if (servedLinks?.has(`${crawlUrlHash(identity(url))} ${kind}`)) return
        const before = found.links.length
        discover(found, item, url, kind, source, depth, context)
        if (servedLinks) for (const link of found.links.slice(before)) link.rendered = 1
      },
    })
    return { result, found, sitemap }
  }

  const cache = createRenderResourceCache()
  const recovery = createBrowserRecovery({
    crawl,
    db,
    service: options.renderService,
    signal: stopSignal,
    heartbeat,
    maxWaitMs: options.browserMaxWaitMs,
    pollMs: options.browserPollMs,
  })
  const retryRenders: {
    item: NewCrawlUrl
    response: FetchedResponse
    result: CrawlUrlResult
    links: Set<string>
  }[] = []
  let retryBytes = 0
  let retryPages = 0

  async function renderUrl(
    item: NewCrawlUrl,
    response: FetchedResponse,
    served: Set<string>,
  ): Promise<{ render: CrawlUrlRender; found: Discovered }> {
    const outcome = await recovery.run(() =>
      options.renderService!.render({
        url: item.url,
        host,
        ignoredParameters: crawl!.ignoredParameters,
        document: response,
        userAgent: settings.userAgent ?? defaultCrawlerUserAgent(options.appVersion),
        requester,
        cache,
        allowedByRobots: renderRobots({ robots }),
        waitMs: crawl!.rendering!.waitMs,
        extraOmittedHosts: crawl!.rendering!.omittedHosts,
        resourceSlots,
        resourceSignal,
        signal: stopSignal,
      }),
    )
    // Two page crashes can also mean a disconnected browser. Confirm readiness before a failed
    // observation can commit; if the browser had to recover, retry the current document instead.
    if (outcome.failure?.code === 'crashed' && (await recovery.start()))
      return renderUrl(item, response, served)
    let facts: CrawlPageFacts | null = null
    let page: CrawlUrlRender['data']['page']
    const anchors = new Set<string>()
    const allAnchors = new Set<string>()
    const nofollow = new Set<string>()
    const embeds = new Set<string>()
    let embedsComplete = true
    const observeLink = (url: string, kind: CrawlLinkKind) => {
      if (kind === 'anchor' || kind === 'anchor-nofollow') {
        const anchor = kind + ':' + url
        allAnchors.add(anchor)
        if (isInternalUrl(url, host) && url !== identity(item.url)) {
          anchors.add(anchor)
          if (kind === 'anchor-nofollow') nofollow.add(url)
        }
      }
      if (['image', 'script', 'style', 'media', 'frame'].includes(kind)) {
        if (url.length > 2048 || (!embeds.has(url) && embeds.size >= 1000)) embedsComplete = false
        else embeds.add(url)
      }
    }
    let found: Discovered = { urls: [], links: [] }
    if (outcome.status === 'rendered' && !outcome.redirected) {
      const keepLink = (url: string, kind: CrawlLinkKind) => {
        if (!BLOCKABLE_RENDER_REFERENCES.has(kind) || isInternalUrl(url, host)) return true
        if (served.has(`${crawlUrlHash(identity(url))} ${kind}`)) return true
        // Keep facts about these elements with redacted samples, and omit their crawl links.
        return !renderOmittedEndpoint(new URL(url), crawl!.rendering!.omittedHosts)
      }
      const analysed = analyse(
        item,
        {
          ...response,
          body: Buffer.from(outcome.html),
          truncated: response.truncated || outcome.truncated,
        },
        outcome.html,
        served,
        observeLink,
        keepLink,
        outcome.documentUrl,
      )
      // analyseResponse supplies the same bounded facts as for the served document. Discard links
      // already present in HTML, including their first-occurrence context.
      facts = analysed.result.data?.facts ?? null
      const result = analysed.result
      page = {
        canonical: result.canonical,
        title: result.title,
        description: result.data?.description ?? null,
        h1: result.data?.h1?.[0] ?? null,
        metaRobots: result.metaRobots,
        botRobots: result.data?.botRobots ?? {},
        hreflang: result.data?.hreflang ?? [],
      }
      found = analysed.found
    }
    const render = renderObservation(item.urlHash, outcome, facts)
    if (page) {
      render.data.page = page
      render.data.documentLinks = {
        internal: anchors.size,
        nofollow: nofollow.size,
        anchorsHash: fingerprintSet(allAnchors),
        embeds: [...embeds].sort(),
        embedsComplete,
      }
    }
    return { render, found }
  }

  const observedFiles = new Map<string, NewCrawlFile>()
  let filesCapped = false
  let filesRefreshIncomplete = false
  async function processUrl(item: NewCrawlUrl, earlier?: SecondAttemptCandidate) {
    if (rendered) await recovery.ready()
    let firstFailure: FirstRequestFailure | undefined = earlier?.firstRequestFailure
    if (earlier && !firstFailure && earlier.fetchedAt) {
      const code = earlier.statusCode ?? earlier.error?.split(':', 1)[0]
      if (code !== undefined) firstFailure = { code, at: earlier.fetchedAt.toISOString() }
    }
    let claimed = false
    const outcome = await fetchWithRetries(
      item,
      earlier
        ? {
            singleAttempt: true,
            stopOnExcessiveDelay: true,
            beforeAttempt: async () => {
              if (claimed) return
              claimed = await db.crawls.claimSecondAttempt(crawlId, item.urlHash)
              if (!claimed) throw new SecondAttemptUnavailable()
            },
          }
        : {
            onFirstRetry: (code, at) => {
              firstFailure = { code, at }
            },
          },
    )
    const failed = outcome instanceof FetchError || isTemporaryStatus(outcome.statusCode)
    let result: CrawlUrlResult
    let found: Discovered = { urls: [], links: [] }
    let sitemap: ParsedSitemap | null | undefined
    const served = new Set<string>()
    if (outcome instanceof FetchError) {
      result = failureResult(outcome)
    } else {
      const servedAt = new Date().toISOString()
      const anchors = new Set<string>()
      const observe = (url: string, kind: CrawlLinkKind) => {
        // WP1: the served identities a render compares against, before graph admission.
        if (rendered) served.add(`${crawlUrlHash(url)} ${kind}`)
        // WP3: the internal anchors of this answer, for paired observations.
        if (
          followLinks &&
          (kind === 'anchor' || kind === 'anchor-nofollow') &&
          isInternalUrl(url, host)
        ) {
          anchors.add(crawlUrlHash(url))
        }
      }
      ;({ result, found, sitemap } = analyse(
        item,
        outcome,
        undefined,
        undefined,
        followLinks || rendered ? observe : undefined,
      ))
      if (followLinks && result.data?.facts && !outcome.truncated) {
        // A resumed render can retain edges from an earlier fetch. Authenticate the
        // stored graph against this response before using it as membership evidence.
        result.data.facts.servedAnchors = {
          count: anchors.size,
          digest: createHash('sha256')
            .update([...anchors].sort().join(''))
            .digest('hex'),
        }
        result.data.facts.requestContext = context
        result.data.facts.servedAt = servedAt
      }
      // Asked for as a script, stylesheet, image or media file, it is one, whatever it answered:
      // a missing `.js` that answers with an HTML error page is a broken resource, not a page.
      if (result.kind === 'page' && item.foundKind && RESOURCE_REFERENCES.has(item.foundKind)) {
        result = { ...result, kind: 'resource' }
      }
    }
    const fileKind = crawlFileKindOf(item.source)
    if (fileKind) {
      observedFiles.set(
        item.url,
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
    }
    const sitemapHreflang = followLinks
      ? sitemap?.hreflang.map(({ page, lang, url }) => ({
          pageHash: crawlUrlHash(identity(page)),
          lang,
          url,
        }))
      : undefined
    if (firstFailure) {
      result.data = {
        ...result.data,
        firstRequestFailure: {
          ...firstFailure,
          ...(!failed && { recoveredOn: earlier ? 'second-pass' : 'retry' }),
        },
      }
    }
    let render: CrawlUrlRender | undefined
    if (
      rendered &&
      result.kind === 'page' &&
      result.statusCode === 200 &&
      !fileKind &&
      !(outcome instanceof FetchError)
    ) {
      const observation = await renderUrl(item, outcome, served)
      render = observation.render
      found.urls.push(...observation.found.urls)
      found.links.push(...observation.found.links)
      if (
        render.status === 'failed' &&
        retryPages < 200 &&
        retryBytes + (outcome.body?.length ?? 0) <= 64 * 1024 * 1024
      ) {
        retryRenders.push({ item, response: outcome, result, links: served })
        retryPages++
        retryBytes += outcome.body?.length ?? 0
      }
    }
    if (rendered) await recovery.ready()
    stopSignal.throwIfAborted()
    await persistAdmissionDrop()
    await db.crawls.recordResult({
      crawlId,
      urlHash: item.urlHash,
      result,
      render,
      robots: item.source === 'robots' ? robots : undefined,
      sitemapHreflang,
      ...found,
      ...(earlier && { secondAttempt: failed ? 'failed' : 'answered' }),
    })
    if (!earlier) doneCount++
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
        try {
          const response = await dispatch(() =>
            fetcher.fetch(item.url, {
              signal: stopSignal,
              maxBytes: EXTERNAL_BODY_BYTES,
            }),
          )
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
  const start = <Item extends NewCrawlUrl>(item: Item, handle: (item: Item) => Promise<void>) => {
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
  async function drain<Item extends NewCrawlUrl>(
    next: (limit: number) => Promise<Item[]>,
    handle: (item: Item) => Promise<void>,
    concurrency = settings.concurrency,
    shouldContinue = () => true,
  ) {
    const queue: Item[] = []
    // A URL that finishes while a batch is being read can still be in it: never start one twice.
    const started = new Set<string>()
    while (!stopSignal.aborted && shouldContinue()) {
      await heartbeat()
      if (rendered) await recovery.ready()
      if (queue.length === 0) {
        const batch = await next(QUEUE_BATCH)
        queue.push(
          ...batch.filter((item) => !inFlight.has(item.urlHash) && !started.has(item.urlHash)),
        )
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
        inFlight.size >= concurrency ||
        (settings.maxDepth !== null && item.depth > Math.min(...inFlightDepth.values()))
      ) {
        await waitForProgress()
        continue
      }
      queue.shift()
      started.add(item.urlHash)
      start(item, handle)
    }
    await Promise.allSettled(inFlight.values())
  }

  async function retryFailedRenders() {
    while (retryRenders.length > 0 && !stopSignal.aborted) {
      const retry = retryRenders.shift()!
      const observation = await renderUrl(retry.item, retry.response, retry.links)
      if (observation.render.status === 'rendered') {
        await recovery.ready()
        stopSignal.throwIfAborted()
        await persistAdmissionDrop()
        await db.crawls.recordResult({
          crawlId,
          urlHash: retry.item.urlHash,
          result: retry.result,
          render: observation.render,
          ...observation.found,
        })
      }
      await drain((limit) => db.crawls.nextQueued(crawlId, limit), processUrl)
    }
  }

  /**
   * A rendered crawl never ends with a page it should have rendered and has no render for: its
   * findings would be read as observed. Such pages are crawled again once; any still without a render
   * then get a failed one, so they are unknown (`render-failed`), never silently HTML-only.
   */
  async function ensureRendered() {
    if (stopSignal.aborted) return
    const requeued = await db.crawls.requeueUnrendered(crawlId)
    if (requeued > 0) {
      log.warn({ pages: requeued }, 'pages recorded without a render are crawled again')
      doneCount -= requeued
      pagesCount -= requeued
      await drain((limit) => db.crawls.nextQueued(crawlId, limit), processUrl)
      await retryFailedRenders()
    }
    for (;;) {
      if (stopSignal.aborted) return
      const missing = await db.crawls.unrenderedPages(crawlId, QUEUE_BATCH)
      if (missing.length === 0) return
      log.warn({ pages: missing.length }, 'pages without a render are recorded as not rendered')
      await db.crawls.saveRenders(
        crawlId,
        missing.map(({ urlHash, url }) => notRenderedObservation(urlHash, url)),
      )
    }
  }

  const drainMain = () => drain((limit) => db.crawls.nextQueued(crawlId, limit), processUrl)

  async function planSecondPass() {
    const hashes: string[] = []
    const guessSources = pagesCount > 0 ? CRAWL_URL_SOURCES.filter(isGuessSource) : []
    let after = ''
    for (;;) {
      await heartbeat()
      stopSignal.throwIfAborted()
      const batch = await db.crawls.transientFailureCandidates({
        crawlId,
        ref: crawl!.ref,
        guessSources,
        after,
        limit: QUEUE_BATCH,
      })
      for (const item of batch) {
        const code = item.error?.split(':', 1)[0]
        if (code && PERMANENT_ERRORS.has(code)) continue
        hashes.push(item.urlHash)
        if (hashes.length > SECOND_PASS_LIMIT)
          return {
            pass: { state: 'skipped', reason: 'limit', limit: SECOND_PASS_LIMIT } as const,
            hashes: [],
          }
      }
      if (batch.length < QUEUE_BATCH) break
      after = batch[batch.length - 1]!.urlHash
    }
    const pass = hashes.length
      ? ({
          state: 'pending',
          notBefore: Date.now() + (options.secondPassWaitMs ?? SECOND_PASS_WAIT_MS),
        } as const)
      : ({ state: 'done', answered: 0, failed: 0, unconfirmed: 0 } as const)
    return { pass, hashes }
  }

  async function runSecondPass() {
    let pass = crawl!.secondPass
    if (!pass) {
      const plan = await planSecondPass()
      if (!(await db.crawls.planSecondPass(crawlId, plan.pass, plan.hashes))) return
      pass = plan.pass
    }
    if (pass.state !== 'pending') return
    const canRetry = () => !requester.excessiveDelay()
    while (!stopSignal.aborted && canRetry() && Date.now() < pass.notBefore) {
      await abortableSleep(Math.min(pass.notBefore - Date.now(), PROGRESS_INTERVAL_MS), stopSignal)
      await heartbeat()
    }
    await drain(
      (limit) => db.crawls.nextSecondAttempt(crawlId, limit),
      async (item) => {
        try {
          await processUrl(item, item)
        } catch (error) {
          if (
            !(error instanceof SecondAttemptUnavailable) &&
            !(error instanceof ExcessiveRetryAfterError)
          )
            throw error
        }
      },
      1,
      canRetry,
    )
    if (!stopSignal.aborted)
      await db.crawls.finishSecondPass(crawlId, canRetry() ? undefined : 'retry-after')
  }

  let observations: Awaited<ReturnType<typeof repeatAnswers>>
  try {
    if (rendered) await recovery.start()
    await seed()
    if (!crawl.secondPass) {
      await drainMain()
      await retryFailedRenders()
      if (rendered) await ensureRendered()
    }
    if (!stopSignal.aborted) await runSecondPass()
    await drainMain()
    await retryFailedRenders()
    if (rendered) await ensureRendered()
    // Last, with the site done: while it runs, the crawl is still active and can be cancelled.
    if (followLinks) {
      await drain((limit) => db.crawls.pendingExternalLinks(crawlId, limit), checkExternalLink)
    }
    // Done URLs survive a shutdown; the in-memory file batch does not. Re-acquire a complete
    // observation on resumed attempts before publishing or pruning any current file rows.
    if (followLinks && counts.urlsDoneCount > 0 && !signal.aborted && !cancelled && !fatal) {
      const alreadyRetried = new Set(await db.crawls.secondAttemptedUrls(crawlId))
      for (const url of observedFiles.keys()) {
        if (!alreadyRetried.has(url)) observedFiles.delete(url)
      }
      try {
        const fresh = await fetchCrawlFiles({
          requester,
          host,
          settings,
          fetcher,
          signal: stopSignal,
          now: () => new Date(),
          retryBaseMs,
          skipRequest: (url) => alreadyRetried.has(identity(url)),
        })
        if (!requester.excessiveDelay()) {
          for (const file of fresh.files) observedFiles.set(file.url, { ...file, via: 'crawl' })
          filesCapped = fresh.capped
          filesRefreshIncomplete = fresh.skipped
        }
      } catch (error) {
        if (!(error instanceof ExcessiveRetryAfterError)) throw error
        // An incomplete refresh cannot replace or prune the previous file records.
      }
    }
    if (followLinks && !truncated && !fatal && !stopSignal.aborted) {
      observations = await repeatAnswers({
        db,
        crawl,
        host,
        context,
        identity,
        requester,
        onCancelled: () => {
          cancelled = true
          stop.abort()
        },
        signal: stopSignal,
      })
    }
  } catch (error) {
    if (error instanceof BrowserWaitExpiredError) fatal = error
    else if (!stopSignal.aborted) throw error
  } finally {
    resourcesDone.abort()
    fetcher.close()
  }

  if (fatal) {
    // The domain was deleted while it ran: its crawl is gone with it, and so is any reason to fail.
    if (!(await db.crawls.get(crawlId))) {
      log.info('the crawl was removed while it ran')
      return null
    }
    if (fatal instanceof BrowserWaitExpiredError) {
      await saveProgress()
      await db.crawls.finish(crawlId, { status: 'failed', error: 'browser-unavailable' })
      return {
        crawlId,
        status: 'failed',
        pages: pagesCount,
        urls: internalCount,
        external: externalCount,
      }
    }
    throw fatal
  }
  if (signal.aborted) {
    await saveProgress()
    throw new JobInterruptedError()
  }

  // A cancellation can also arrive after the last URL: `finish` then reports nothing changed.
  const status = truncated ? 'incomplete' : 'completed'
  const finished = !cancelled && (await db.crawls.finish(crawlId, { status, observations }))
  if (finished && !followLinks) {
    await db.crawlFiles
      .save(crawl.domainId, [...observedFiles.values()])
      .catch((error) => log.warn({ err: error }, 'could not update crawl files'))
  }
  if (finished && followLinks && observedFiles.size > 0) {
    try {
      // The files were just requested: asking again in a moment would only add traffic.
      const checkedAt = new Date()
      const files = [...observedFiles.values()]
      const reachable = files.some((file) => file.statusCode !== null)
      await db.crawlFiles.finishCheck({
        domainId: crawl.domainId,
        outcome: reachable ? 'ok' : 'unreachable',
        files,
        checkedAt,
        nextCheckAt: new Date(
          checkedAt.getTime() +
            (reachable && !filesRefreshIncomplete
              ? CRAWL_FILE_REFRESH_INTERVAL_MS
              : CRAWL_FILE_RETRY_INTERVAL_MS),
        ),
      })

      // A crawl that stopped at its limit may not have got to every file, so it removes none.
      if (status === 'completed' && reachable && !filesRefreshIncomplete) {
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
    // Why URLs differ from the crawl it is compared with, before its alerts read the comparison.
    try {
      await explainLatestPair({
        db,
        crawlId,
        runner: `crawl:${crawlId}`,
        log,
        signal,
        ...(options.explainSources ? { sources: options.explainSources } : {}),
      })
    } catch (error) {
      // A job is queued to work it out again (`explainLatestPair`); alerts wait for it.
      log.warn({ err: error }, 'could not work out why URLs differ from the previous crawl')
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
