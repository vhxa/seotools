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
