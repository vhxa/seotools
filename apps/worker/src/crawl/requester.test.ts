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
