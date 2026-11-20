import type { CrawlSettings, Logger } from '@seotools/core'
import { FetchError, type FetchedResponse, type Fetcher } from './fetcher'
import {
  MAX_RETRY_AFTER_MS,
  PERMANENT_ERRORS,
  RETRYABLE_STATUS,
  abortableSleep,
  parseRetryAfter,
} from './requests'

/** What a request can ask for besides its URL: the fetcher's options, except who can stop it. */
export type RequestOptions = Omit<Parameters<Fetcher['fetch']>[1], 'signal'> & {
  signal?: AbortSignal
  /** Rechecked before every attempt, after pacing. */
  beforeAttempt?: () => void | Promise<void>
  /** Each paired observation permits exactly one wire attempt. */
  singleAttempt?: boolean
  /**
   * `false`: not held to the requests per second (a rendered page's resources, which their own
   * parallelism bounds). A server that asked to slow down still holds it.
   */
  paced?: boolean
}

/**
 * Paces the requests of one piece of work to a domain's settings, whoever makes them: a crawl, or a
 * recheck of some URLs. Requests share `requestsPerSecond` between them, a server that asks to
 * slow down (`Retry-After`) holds all of them, and a failure is tried again `maxRetries` times
 * unless it would fail the same way. Every request goes through the fetcher it is given, which is
 * where the rules about what may be requested live.
 */
export function createRequester(options: {
  fetcher: Fetcher
  settings: Pick<CrawlSettings, 'requestsPerSecond' | 'maxRetries'>
  /** Ends every wait and request at once. */
  signal: AbortSignal
  retryAfterUntil?: number
  persistRetryAfter?: (until: number) => Promise<void>
  retryBaseMs: number
  log: Logger
}) {
  const { fetcher, settings, signal: stopSignal, retryBaseMs, log } = options

  const interval = 1000 / settings.requestsPerSecond
  let nextSlot = 0
  let retryAfterUntil = options.retryAfterUntil ?? 0
  let unsupportedUntil = retryAfterUntil > Date.now() + MAX_RETRY_AFTER_MS ? retryAfterUntil : 0
  let pausedUntil = Math.min(retryAfterUntil, Date.now() + MAX_RETRY_AFTER_MS)

  async function waitForSlot(
    signal = stopSignal,
    paced = true,
    beforeAttempt?: RequestOptions['beforeAttempt'],
  ) {
    for (;;) {
      signal.throwIfAborted()
      const wait = Math.max(paced ? nextSlot : 0, pausedUntil) - Date.now()
      if (wait > 0) {
        await abortableSleep(wait, signal)
        continue
      }
      if (beforeAttempt) {
        await beforeAttempt()
        signal.throwIfAborted()
        if (Date.now() < Math.max(paced ? nextSlot : 0, pausedUntil)) continue
      }
      if (paced) nextSlot = Date.now() + interval
      return
    }
  }

  async function fetchWithRetries(
    url: string,
    { paced = true, singleAttempt = false, ...fetchOptions }: RequestOptions,
  ): Promise<FetchedResponse | FetchError> {
    const signal = fetchOptions.signal
      ? AbortSignal.any([stopSignal, fetchOptions.signal])
      : stopSignal
    const maxRetries =
      !singleAttempt && ['GET', 'HEAD', 'OPTIONS'].includes(fetchOptions.method ?? 'GET')
        ? settings.maxRetries
        : 0
    for (let attempt = 0; ; attempt++) {
      await waitForSlot(signal, paced, fetchOptions.beforeAttempt)
      if (signal.aborted) throw new DOMException('Crawl stopped', 'AbortError')
      const backoff = retryBaseMs * 2 ** attempt
      try {
        let reported = 0
        const response = await fetcher.fetch(url, {
          ...fetchOptions,
          signal,
          onBodyBytes: (size) => {
            reported += size
            fetchOptions.onBodyBytes?.(size)
          },
        })
        // Alternate fetchers may report only a completed body. Never miss those bytes.
        if (reported === 0) fetchOptions.onBodyBytes?.(response.body?.length ?? 0)
        const delay = parseRetryAfter(response.headers['retry-after'], Infinity)
        if (delay !== null && delay > MAX_RETRY_AFTER_MS)
          unsupportedUntil = Math.max(unsupportedUntil, Date.now() + delay)
        if (delay !== null) {
          const now = Date.now()
          pausedUntil = Math.max(pausedUntil, now + Math.min(delay, MAX_RETRY_AFTER_MS))
          // Stay inside the common ISO date range even for an excessive numeric header.
          const until = Math.min(Date.UTC(9999, 11, 31), now + delay)
          if (until > retryAfterUntil) {
            retryAfterUntil = until
            await options.persistRetryAfter?.(until)
          }
        }
        if (!RETRYABLE_STATUS.has(response.statusCode) || attempt >= maxRetries) return response
        // The server asked to slow down: every request of the domain waits, not just this one.
        const wait = delay === null ? backoff : Math.min(delay, MAX_RETRY_AFTER_MS)
        pausedUntil = Math.max(pausedUntil, Date.now() + wait)
        log.info({ url, status: response.statusCode, wait }, 'server asked to slow down')
      } catch (error) {
        if (!(error instanceof FetchError)) throw error
        if (PERMANENT_ERRORS.has(error.code) || attempt >= maxRetries) return error
        await abortableSleep(backoff, signal)
      }
    }
  }

  return { waitForSlot, fetchWithRetries, excessiveDelay: () => Date.now() < unsupportedUntil }
}

export type Requester = ReturnType<typeof createRequester>
