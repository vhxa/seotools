import type { CrawlSettings, Logger } from '@seotools/core'
import { FetchError, type FetchedResponse, type Fetcher } from './fetcher'
import { PERMANENT_ERRORS, RETRYABLE_STATUS, abortableSleep, parseRetryAfter } from './requests'

/** What a request can ask for besides its URL: the fetcher's options, except who can stop it. */
export type RequestOptions = Omit<Parameters<Fetcher['fetch']>[1], 'signal'>

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

  async function fetchWithRetries(
    url: string,
    fetchOptions: RequestOptions,
  ): Promise<FetchedResponse | FetchError> {
    for (let attempt = 0; ; attempt++) {
      await waitForSlot()
      if (stopSignal.aborted) throw new DOMException('Crawl stopped', 'AbortError')
      const backoff = retryBaseMs * 2 ** attempt
      try {
        const response = await fetcher.fetch(url, { signal: stopSignal, ...fetchOptions })
        if (!RETRYABLE_STATUS.has(response.statusCode) || attempt >= settings.maxRetries) {
          return response
        }
        // The server asked to slow down: every request of the domain waits, not just this one.
        const wait = parseRetryAfter(response.headers['retry-after']) ?? backoff
        pausedUntil = Math.max(pausedUntil, Date.now() + wait)
        log.info({ url, status: response.statusCode, wait }, 'server asked to slow down')
      } catch (error) {
        if (!(error instanceof FetchError)) throw error
        if (PERMANENT_ERRORS.has(error.code) || attempt >= settings.maxRetries) return error
        await abortableSleep(backoff, stopSignal)
      }
    }
  }

  return { waitForSlot, fetchWithRetries }
}

export type Requester = ReturnType<typeof createRequester>
