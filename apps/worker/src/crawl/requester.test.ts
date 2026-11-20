import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '@seotools/core'
import { FetchError, type FetchedResponse } from './fetcher'
import { createRequester } from './requester'

const answer: FetchedResponse = {
  statusCode: 503,
  headers: {},
  body: Buffer.from('retry'),
  bytes: 5,
  truncated: false,
  responseTimeMs: 0,
}
describe('request retries by method', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'POST'])(
    'only retries safe %s requests after HTTP and network failures',
    async (method) => {
      for (const failure of [answer, new FetchError('ECONNRESET', 'reset')]) {
        const fetch = vi.fn(async () => {
          if (failure instanceof FetchError) throw failure
          return failure
        })
        const requester = createRequester({
          fetcher: { fetch, close() {} },
          settings: { requestsPerSecond: 10000, maxRetries: 2 },
          signal: new AbortController().signal,
          retryBaseMs: 0,
          log: createLogger('test', 'silent'),
        })
        await requester.fetchWithRetries('http://site.test/api', { method })
        expect(fetch).toHaveBeenCalledTimes(method === 'POST' ? 1 : 3)
      }
    },
  )
})

it('charges bodies from retries and bytes received before a network error', async () => {
  const sizes: number[] = []
  let attempt = 0
  const requester = createRequester({
    fetcher: {
      close() {},
      async fetch(_url, options) {
        attempt++
        options.onBodyBytes?.(7)
        if (attempt === 1) throw new FetchError('ECONNRESET', 'partial answer')
        return answer
      },
    },
    settings: { requestsPerSecond: 10000, maxRetries: 2 },
    signal: new AbortController().signal,
    retryBaseMs: 0,
    log: createLogger('test', 'silent'),
  })
  await requester.fetchWithRetries('http://site.test/api', {
    onBodyBytes: (size) => sizes.push(size),
  })
  expect(sizes).toEqual([7, 7, 7])
})

it('holds documents to the requests per second, never unpaced resources, which still obey a pause', async () => {
  let slow = true
  const fetch = vi.fn(async (): Promise<FetchedResponse> => {
    if (slow) {
      slow = false
      return { ...answer, headers: { 'retry-after': '1' } }
    }
    return { ...answer, statusCode: 200 }
  })
  const requester = createRequester({
    fetcher: { fetch, close() {} },
    settings: { requestsPerSecond: 20, maxRetries: 0 },
    signal: new AbortController().signal,
    retryBaseMs: 0,
    log: createLogger('test', 'silent'),
  })
  const time = async (paced: boolean) => {
    const started = Date.now()
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        requester.fetchWithRetries(`http://site.test/${i}`, { paced }),
      ),
    )
    return Date.now() - started
  }
  // The first answer is a 503 with Retry-After: with no retries left it is returned as it is.
  slow = false
  expect(await time(true)).toBeGreaterThanOrEqual(180)
  expect(await time(false)).toBeLessThan(100)
  // A server that asks to slow down holds unpaced requests too.
  slow = true
  const requesterWithRetry = createRequester({
    fetcher: { fetch, close() {} },
    settings: { requestsPerSecond: 1000, maxRetries: 1 },
    signal: new AbortController().signal,
    retryBaseMs: 0,
    log: createLogger('test', 'silent'),
  })
  const started = Date.now()
  await requesterWithRetry.fetchWithRetries('http://site.test/a', { paced: false })
  expect(Date.now() - started).toBeGreaterThanOrEqual(900)
})

it('paces ordinary dispatch after a repeat has a slow cancellation check', async () => {
  const times: number[] = []
  const requester = createRequester({
    fetcher: {
      close() {},
      async fetch() {
        times.push(Date.now())
        return answer
      },
    },
    settings: { requestsPerSecond: 20, maxRetries: 0 },
    signal: new AbortController().signal,
    retryBaseMs: 0,
    log: createLogger('test', 'silent'),
  })
  await Promise.all([
    requester.fetchWithRetries('https://site.test/repeat', {
      beforeAttempt: () => new Promise((resolve) => setTimeout(resolve, 55)),
    }),
    requester.fetchWithRetries('https://site.test/ordinary', {}),
  ])
  expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(49)
})
