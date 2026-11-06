import type { CrawlEngineOptions } from './engine'
import type { FetchedResponse, Fetcher, FetcherConfig } from './fetcher'

/** For tests: a website in a map, and the helpers to write one. */

export type Answer = Partial<FetchedResponse> | Error | (() => Partial<FetchedResponse> | Error)

export const html = (
  body: string,
  headers: Record<string, string> = {},
): Partial<FetchedResponse> => ({
  statusCode: 200,
  headers: { 'content-type': 'text/html', ...headers },
  body: Buffer.from(body),
})
export const moved = (location: string, statusCode = 301): Partial<FetchedResponse> => ({
  statusCode,
  headers: { location },
  body: null,
})
export const notFound: Partial<FetchedResponse> = {
  statusCode: 404,
  headers: { 'content-type': 'text/html' },
  body: Buffer.from('<title>Not found</title>'),
}

/** A website in a map. URLs that are not in it answer 404, like a real site would. */
export function fakeSite(site: Record<string, Answer>, latencyMs = 1) {
  const requests: string[] = []
  const configs: Omit<FetcherConfig, 'allowPrivateNetworks'>[] = []
  let active = 0
  let peak = 0
  let closed = 0
  const createFetcher: CrawlEngineOptions['createFetcher'] = (config) => {
    configs.push(config)
    const fetcher: Fetcher = {
      close: () => {
        closed++
      },
      async fetch(url, { signal }) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        requests.push(url)
        peak = Math.max(peak, ++active)
        await new Promise((r) => setTimeout(r, latencyMs))
        active--
        const answer = site[url] ?? notFound
        const resolved = typeof answer === 'function' ? answer() : answer
        if (resolved instanceof Error) throw resolved
        return {
          statusCode: 200,
          headers: {},
          body: null,
          truncated: false,
          bytes: resolved.body?.length ?? null,
          responseTimeMs: 1,
          ...resolved,
        }
      },
    }
    return fetcher
  }
  return {
    createFetcher,
    requests,
    configs,
    peak: () => peak,
    closed: () => closed,
  }
}
