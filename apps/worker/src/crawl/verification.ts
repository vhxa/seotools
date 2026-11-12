import { siteHeaders } from './credentials'
import {
  MAX_VERIFICATION_URLS,
  URL_SCOPED_ISSUES,
  crawlFileKindOf,
  defaultCrawlerUserAgent,
  isInternalUrl,
  recheckPreviewOf,
  type Logger,
  type VerificationOutcome,
  type VerificationStatus,
} from '@seotools/core'
import type { Database, NewVerificationUrl } from '@seotools/db'
import { JobDeferredError, JobInterruptedError } from '../types'
import { currentAuditConfig } from './analysis'
import type { CrawlEngineOptions } from './engine'
import { decodeText, FetchError } from './fetcher'
import { crawlFileFetchOptions } from './files'
import { createAnchorCounter, evaluateRecheck, recheckContext, type RecheckedUrl } from './recheck'
import { createRequester } from './requester'
import { RETRY_BASE_MS, abortableSleep } from './requests'
import { MAX_ROBOTS_BYTES, analyseResponse, emptyResult, failureResult } from './response'

/** How often a cancellation, or a crawl that started meanwhile, is looked for. */
const CHECK_INTERVAL_MS = 2000
/** How long a recheck steps aside for a crawl of its domain before looking again. */
export const CRAWL_WAIT_MS = 30_000
/** Rechecks kept per domain once they have ended. */
export const KEPT_VERIFICATIONS = 50

export interface VerificationOptions {
  settingsSecret?: string
  db: Database
  log: Logger
  /** Every request of a recheck goes through the fetcher this makes: see `createHttpFetcher`. */
  createFetcher: CrawlEngineOptions['createFetcher']
  /** Aborted when the worker is shutting down. */
  signal: AbortSignal
  appVersion?: string
  /** Scales the waits between retries down in tests. */
  retryBaseMs?: number
  /** Scales how long it steps aside for a crawl in tests. */
  crawlWaitMs?: number
}

export interface VerificationSummary {
  verificationId: string
  status: VerificationStatus
  urls: number
  done: number
}

/** Why a stored URL is not requested at all, if it must not be. */
function refusal(item: NewVerificationUrl, host: string): string | null {
  // The rows come from `verifications.start`, which does not look at them: the worker does.
  let internal: boolean
  try {
    internal = isInternalUrl(item.url, host)
  } catch {
    internal = false
  }
  if (!internal) return 'NOT_INTERNAL: the URL does not belong to the domain'
  if (crawlFileKindOf(item.source) !== null) {
    return 'NOT_VERIFIABLE: crawl files are requested again by the crawl files refresh'
  }
  return null
}

const NOTHING_CHECKED = (): VerificationOutcome['audit'] => ({
  participation: 'audited',
  participationRule: null,
  intent: 'none',
  intentRule: null,
  conditions: {},
  indexability: 'unknown',
  blockers: [],
})

/**
 * Requests the URLs of a recheck again and concludes, for each one, what can be told from its fresh
 * answer: see `evaluateRecheck`. It is a small piece of work, bounded by `MAX_VERIFICATION_URLS`,
 * and it never touches a crawl: nothing the last full crawl stored changes.
 *
 * - Requests go through `createRequester` with the domain's own settings (user agent, timeout,
 *   simultaneous requests, rate, retries) and the fetcher that refuses non-public addresses. Only
 *   URLs of the domain are requested, plus the `robots.txt` of the origins they are on, so that
 *   `robots-blocked` is judged against the file as it is now and not as the crawl saw it.
 * - It is resumable: each URL is stored when done and `queued` says what is left, so a retry after
 *   a crash or a shutdown carries on. Writing a result twice is harmless.
 * - It steps aside for a crawl of the same domain (`JobDeferredError`) instead of adding to its
 *   load, and a cancellation stops it at the next check.
 */
export async function runVerification(
  verificationId: string,
  options: VerificationOptions,
): Promise<VerificationSummary | null> {
  const { db, log: parentLog, signal } = options
  const retryBaseMs = options.retryBaseMs ?? RETRY_BASE_MS
  const crawlWaitMs = options.crawlWaitMs ?? CRAWL_WAIT_MS

  const found = await db.verifications.get(verificationId)
  // Cancelled or ended before it got to run. Its job has nothing left to do.
  if (!found || (found.status !== 'pending' && found.status !== 'running')) return null
  const domain = await db.domains.get(found.domainId)
  if (!domain) return null
  const { host } = domain
  const log = parentLog.child({ verificationId, host })

  // A crawl goes first: the domain has one set of rate limits, and a crawl is long and scheduled.
  if (await db.crawls.active(domain.id)) {
    throw new JobDeferredError(crawlWaitMs, 'A crawl of the domain is running')
  }
  const verification = await db.verifications.markRunning(verificationId)
  if (!verification) return null

  const queue = await db.verifications.queued(verificationId, MAX_VERIFICATION_URLS)
  const summary = async (status: VerificationStatus): Promise<VerificationSummary> => {
    const current = await db.verifications.get(verificationId)
    return {
      verificationId,
      status,
      urls: current?.urlsCount ?? verification.urlsCount,
      done: current?.urlsDoneCount ?? 0,
    }
  }

  const settings = await db.crawls.settings(domain.id)
  const baseCrawl = await db.crawls.get(verification.baseCrawlId)
  const config = await currentAuditConfig(db, domain.id)
  const fetcher = options.createFetcher({
    siteHeaders: await siteHeaders(db, domain.id, domain.host, options.settingsSecret),
    userAgent: settings.userAgent ?? defaultCrawlerUserAgent(options.appVersion),
    timeoutMs: settings.timeoutMs,
    concurrency: settings.concurrency,
  })

  /** Stops every request and wait at once: shutdown, a cancellation, a crawl or a fatal error. */
  const stop = new AbortController()
  const stopSignal = AbortSignal.any([signal, stop.signal])
  const requester = createRequester({ fetcher, settings, signal: stopSignal, retryBaseMs, log })

  let fatal: unknown
  let cancelled = false
  let deferred = false

  try {
    const requestable = queue.filter((item) => refusal(item, host) === null)

    // What the last full crawl says of a URL the crawler only tried on its own. Read only for those.
    const tried = requestable.filter((item) => item.source === 'seed')
    const linksIn = new Map<string, number>()
    let answered = true
    if (tried.length > 0) {
      for (const item of tried) {
        const sources = await db.crawls.linkSources(verification.baseCrawlId, item.urlHash, {
          limit: 50,
        })
        linksIn.set(item.urlHash, sources.filter((link) => link.kind !== 'redirect').length)
      }
      const pages = await db.crawls.listUrls({
        crawlId: verification.baseCrawlId,
        view: 'pages',
        limit: 100,
        offset: 0,
      })
      answered = pages.some(
        (page) => page.statusCode !== null && page.statusCode >= 200 && page.statusCode < 300,
      )
    }

    // robots.txt as it is now, once per origin: the crawl's copy would be stale site context.
    const robotsTexts = new Map<string, { status: number | null; text: string | null }>()
    for (const origin of new Set(requestable.map((item) => new URL(item.url).origin))) {
      if (stopSignal.aborted) break
      try {
        const response = await requester.fetchWithRetries(
          `${origin}/robots.txt`,
          crawlFileFetchOptions('robots'),
        )
        robotsTexts.set(origin, {
          status: response instanceof FetchError ? null : response.statusCode,
          text:
            !(response instanceof FetchError) && response.statusCode === 200 && response.body
              ? decodeText(
                  response.body.subarray(0, MAX_ROBOTS_BYTES),
                  response.headers['content-type'],
                )
              : null,
        })
      } catch (error) {
        // Stopped while waiting for its turn: shutting down, cancelled or a crawl started. Which
        // of them is decided below; nothing was concluded from a robots.txt that was not read.
        if (stopSignal.aborted) break
        throw error
      }
    }
    const context = recheckContext({
      host,
      ignoredParameters: baseCrawl?.ignoredParameters ?? [],
      now: new Date(),
      config,
      robotsTexts,
      answered,
    })

    const markCancelled = () => {
      cancelled = true
      stop.abort()
    }

    const processUrl = async (item: NewVerificationUrl) => {
      const refused = refusal(item, host)
      if (refused !== null) {
        // Nothing was requested, so nothing was checked: say so rather than conclude from nothing.
        const outcome: VerificationOutcome = {
          audit: NOTHING_CHECKED(),
          findings: [],
          unchecked: [...URL_SCOPED_ISSUES],
        }
        const saved = await db.verifications.recordResult({
          verificationId,
          urlHash: item.urlHash,
          answer: { ...emptyResult, error: refused },
          auditVersion: config.version,
          outcome,
        })
        if (!saved) markCancelled()
        return
      }

      const response = await requester.fetchWithRetries(item.url, { readBody: 'auto' })
      const anchors = createAnchorCounter(host, item.url)
      const answer =
        response instanceof FetchError
          ? failureResult(response)
          : analyseResponse({
              item,
              response,
              optionalFiles: [],
              extractors: settings.extractors,
              log,
              discover: (url, kind) => anchors.add(url, kind),
            }).result
      const recheck: RecheckedUrl = {
        url: item.url,
        source: item.source,
        answer,
        linksIn: linksIn.get(item.urlHash) ?? 0,
        anchors: { internal: anchors.internal, nofollow: anchors.nofollow },
      }
      const { data, ...stored } = answer
      const outcome = evaluateRecheck(recheck, context)
      // Only a page (HTML, 2xx) has a share preview; anything else says nothing about it, and only
      // what the preview reads is kept, never the page data.
      const isPage =
        answer.kind === 'page' &&
        answer.statusCode !== null &&
        answer.statusCode >= 200 &&
        answer.statusCode < 300
      const preview = isPage ? recheckPreviewOf(answer.title, data) : null
      const saved = await db.verifications.recordResult({
        verificationId,
        urlHash: item.urlHash,
        answer: stored,
        auditVersion: config.version,
        outcome: preview ? { ...outcome, preview } : outcome,
      })
      // Cancelled while this was in flight: the result is dropped and the rest is not requested.
      if (!saved) markCancelled()
    }

    const inFlight = new Set<Promise<void>>()
    let lastCheck = 0
    const checkOnTheRun = async () => {
      if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return
      lastCheck = Date.now()
      const current = await db.verifications.get(verificationId)
      if (current?.status !== 'running') markCancelled()
      else if (await db.crawls.active(domain.id)) {
        deferred = true
        stop.abort()
      }
    }

    // Every URL still to do, including those that must not be requested: those are recorded too.
    let next = 0
    while (!stopSignal.aborted && next < queue.length) {
      const item = queue[next]!
      if (inFlight.size >= settings.concurrency) {
        await Promise.race([...inFlight, abortableSleep(CHECK_INTERVAL_MS, stopSignal)])
        await checkOnTheRun()
        continue
      }
      await checkOnTheRun()
      if (stopSignal.aborted) break
      next++
      const task: Promise<void> = processUrl(item)
        .catch((error) => {
          // Being stopped leaves the URL queued, for whoever resumes the recheck.
          if (stopSignal.aborted) return
          fatal ??= error
          stop.abort()
        })
        .finally(() => inFlight.delete(task))
      inFlight.add(task)
    }
    await Promise.allSettled(inFlight)
  } finally {
    fetcher.close()
  }

  if (fatal) throw fatal
  if (signal.aborted) throw new JobInterruptedError()
  if (cancelled) return summary('cancelled')
  if (deferred) throw new JobDeferredError(crawlWaitMs, 'A crawl of the domain started')

  const remaining = await db.verifications.queued(verificationId, 1)
  if (remaining.length > 0) throw new Error('The recheck ended with URLs still to request')
  const finished = await db.verifications.finish(verificationId, { status: 'completed' })
  if (finished) {
    try {
      await db.verifications.prune({ domainId: domain.id, keep: KEPT_VERIFICATIONS })
    } catch (error) {
      log.warn({ err: error }, 'could not prune old rechecks')
    }
  }
  log.info({ urls: queue.length }, 'recheck ended')
  // A cancellation can also arrive after the last URL: `finish` then reports nothing changed.
  return summary(finished ? 'completed' : 'cancelled')
}
