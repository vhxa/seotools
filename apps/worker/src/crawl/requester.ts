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
  beforeAttempt?: () => void
  /**
   * `false`: not held to the requests per second (a rendered page's resources, which their own
   * parallelism bounds). A server that asked to slow down still holds it.
   */
  singleAttempt?: boolean
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
  retryBaseMs: number
  log: Logger
}) {
  const { fetcher, settings, signal: stopSignal, retryBaseMs, log } = options

  const interval = 1000 / settings.requestsPerSecond
  let nextSlot = 0
  let unsupportedUntil = 0
  let pausedUntil = 0
  async function waitForSlot(signal = stopSignal) {
    const now = Date.now()
    const at = Math.max(now, nextSlot, pausedUntil)
    nextSlot = at + interval
    await abortableSleep(at - now, signal)
    // A pause may have started while this request was waiting its turn.
    while (Date.now() < pausedUntil && !signal.aborted) {
      await abortableSleep(pausedUntil - Date.now(), signal)
    }
  }

  /** Only a server that asked to slow down holds an unpaced request. */
  async function waitForPause(signal: AbortSignal) {
    while (Date.now() < pausedUntil && !signal.aborted) {
      await abortableSleep(pausedUntil - Date.now(), signal)
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
      await (paced ? waitForSlot(signal) : waitForPause(signal))
      if (signal.aborted) throw new DOMException('Crawl stopped', 'AbortError')
      const backoff = retryBaseMs * 2 ** attempt
      try {
        fetchOptions.beforeAttempt?.()
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
        if (!RETRYABLE_STATUS.has(response.statusCode)) return response
        const delay = parseRetryAfter(response.headers['retry-after'], Infinity)
        if (delay !== null && delay > MAX_RETRY_AFTER_MS) unsupportedUntil = Date.now() + delay
        if (attempt >= maxRetries && delay === null) return response
        // The server asked to slow down: every request of the domain waits, not just this one.
        const wait = parseRetryAfter(response.headers['retry-after']) ?? backoff
        pausedUntil = Math.max(pausedUntil, Date.now() + wait)
        if (attempt >= maxRetries) return response
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
