import type { CrawlSettings, Logger } from '@seotools/core'
import { FetchError, type FetchedResponse, type Fetcher } from './fetcher'
import {
  MAX_RETRY_AFTER_MS,
  PERMANENT_ERRORS,
  RETRYABLE_STATUS,
  abortableSleep,
  parseRetryAfter,
} from './requests'

export class ExcessiveRetryAfterError extends Error {}

/** What a request can ask for besides its URL: the fetcher's options, except who can stop it. */
export type RequestOptions = Omit<Parameters<Fetcher['fetch']>[1], 'signal'> & {
  signal?: AbortSignal
  /** Rechecked before every attempt, after pacing. */
  beforeAttempt?: () => void | Promise<void>
  /** Observe the first failure if it is about to be retried. */
  onFirstRetry?: (code: number | string, at: string) => void
  /** One observation permits exactly one wire attempt. */
  singleAttempt?: boolean
  stopOnExcessiveDelay?: boolean
  /** A delayed crawl retry must honor even an unusually long server deadline. */
  honorFullRetryAfter?: boolean
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

  async function dispatch<T>(
    send: () => Promise<T>,
    signal = stopSignal,
    paced = true,
    beforeAttempt?: RequestOptions['beforeAttempt'],
    stopOnExcessiveDelay = false,
    honorFullRetryAfter = false,
  ) {
    for (;;) {
      signal.throwIfAborted()
      if (stopOnExcessiveDelay && Date.now() < unsupportedUntil)
        throw new ExcessiveRetryAfterError()
      const deadline = () =>
        Math.max(paced ? nextSlot : 0, pausedUntil, honorFullRetryAfter ? retryAfterUntil : 0)
      const wait = deadline() - Date.now()
      if (wait > 0) {
        await abortableSleep(Math.min(wait, MAX_RETRY_AFTER_MS), signal)
        continue
      }
      await beforeAttempt?.()
      signal.throwIfAborted()
      if (stopOnExcessiveDelay && Date.now() < unsupportedUntil)
        throw new ExcessiveRetryAfterError()
      const now = Date.now()
      if (now < deadline()) continue
      if (paced) nextSlot = now + interval
      return send()
    }
  }

  async function fetchWithRetries(
    url: string,
    {
      paced = true,
      singleAttempt = false,
      beforeAttempt,
      stopOnExcessiveDelay,
      honorFullRetryAfter,
      onFirstRetry,
      ...fetchOptions
    }: RequestOptions,
  ): Promise<FetchedResponse | FetchError> {
    const signal = fetchOptions.signal
      ? AbortSignal.any([stopSignal, fetchOptions.signal])
      : stopSignal
    const maxRetries =
      !singleAttempt && ['GET', 'HEAD', 'OPTIONS'].includes(fetchOptions.method ?? 'GET')
        ? settings.maxRetries
        : 0
    async function send() {
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
      const at = new Date().toISOString()
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
      return { response, delay, at }
    }

    for (let attempt = 0; ; attempt++) {
      const backoff = retryBaseMs * 2 ** attempt
      try {
        const { response, delay, at } = await dispatch(
          send,
          signal,
          paced,
          beforeAttempt,
          stopOnExcessiveDelay,
          honorFullRetryAfter,
        )
        if (!RETRYABLE_STATUS.has(response.statusCode) || attempt >= maxRetries) return response
        if (attempt === 0) onFirstRetry?.(response.statusCode, at)
        // The server asked to slow down: every request of the domain waits, not just this one.
        const wait = delay === null ? backoff : Math.min(delay, MAX_RETRY_AFTER_MS)
        pausedUntil = Math.max(pausedUntil, Date.now() + wait)
        log.info({ url, status: response.statusCode, wait }, 'server asked to slow down')
      } catch (error) {
        if (!(error instanceof FetchError)) throw error
        if (PERMANENT_ERRORS.has(error.code) || attempt >= maxRetries) return error
        if (attempt === 0) onFirstRetry?.(error.code, new Date().toISOString())
        await abortableSleep(backoff, signal)
      }
    }
  }

  return { dispatch, fetchWithRetries, excessiveDelay: () => Date.now() < unsupportedUntil }
}

export type Requester = ReturnType<typeof createRequester>
