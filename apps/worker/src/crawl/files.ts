import {
  MAX_CRAWL_FILE_BODY_BYTES,
  MAX_CRAWL_FILE_READ_BYTES,
  crawlFileRequests,
  isInternalUrl,
  normalizeCrawlUrl,
  type CrawlFileData,
  type CrawlFileKind,
  type CrawlFileRequest,
  type CrawlSettings,
} from '@seotools/core'
import type { NewCrawlFile } from '@seotools/db'
import {
  extractHtml,
  parseFeed,
  parseOpenSearch,
  parseRobotsSitemaps,
  parseSitemap,
  type ParsedSitemap,
} from './extract'
import {
  FetchError,
  decodeSitemapBody,
  decodeText,
  type FetchedResponse,
  type Fetcher,
} from './fetcher'
import {
  PERMANENT_ERRORS,
  RETRYABLE_STATUS,
  RETRY_BASE_MS,
  abortableSleep,
  isRedirect,
  parseRetryAfter,
} from './requests'

/** How long the files of a domain are trusted before a refresh asks again. */
export const CRAWL_FILE_REFRESH_INTERVAL_MS = 24 * 60 * 60_000
/** Sitemaps a refresh requests, past those it walks an index to. A crawl requests them all. */
export const MAX_REFRESH_SITEMAPS = 100
/** How far a refresh follows a redirect from the home page, looking for announced files. */
const MAX_HOME_HOPS = 3
/** A refresh is meant to be light: a server asking for longer waits for the next one. */
const MAX_REFRESH_WAIT_MS = 30_000

const HTML_TYPE = /^(text\/html|application\/xhtml\+xml)\b/i
const HTML_START = /^\s*<(!doctype\s+html|html|head|body)\b/i

/** How a file has to be requested: bodies are always read, within what makes sense for its kind. */
export const crawlFileFetchOptions = (kind: CrawlFileKind) => ({
  readBody: 'force' as const,
  ...(kind === 'sitemap' ? {} : { maxBytes: MAX_CRAWL_FILE_READ_BYTES }),
})

/** Reads a sitemap from its response. `null` when it did not answer with one that can be read. */
export function readSitemap(response: FetchedResponse, url: string): ParsedSitemap | null {
  if (response.statusCode !== 200 || !response.body) return null
  try {
    return parseSitemap(decodeSitemapBody(response.body), url)
  } catch {
    return null
  }
}

/** Reads a file's text. `null` if the site answered with a web page, as many do for any path. */
export function readTextFile(response: FetchedResponse): string | null {
  const { statusCode, body, headers } = response
  if (statusCode !== 200 || !body) return null
  if (HTML_TYPE.test(headers['content-type'] ?? '')) return null
  const text = decodeText(body, headers['content-type'])
  return HTML_START.test(text) ? null : text
}

/**
 * Turns what a request for a file answered into its row. A `sitemap` that was already parsed can be
 * passed in: they can weigh 50 MB, and whoever is asking has probably had to read it anyway.
 */
export function captureCrawlFile(input: {
  request: CrawlFileRequest
  outcome: FetchedResponse | FetchError
  via: NewCrawlFile['via']
  fetchedAt: Date
  sitemap?: ParsedSitemap | null
}): NewCrawlFile {
  const { request, outcome, via, fetchedAt } = input
  const { url, kind } = request
  const base = { url, kind, via, fetchedAt }
  if (outcome instanceof FetchError) {
    return {
      ...base,
      statusCode: null,
      contentType: null,
      redirectTo: null,
      bytes: null,
      truncated: false,
      body: null,
      error: `${outcome.code}: ${outcome.message}`,
      data: null,
    }
  }

  const contentType = outcome.headers['content-type'] ?? null
  const redirectTo =
    isRedirect(outcome.statusCode) && outcome.headers.location
      ? normalizeCrawlUrl(outcome.headers.location, url)
      : null
  let body: string | null = null
  let truncated = outcome.truncated
  const data: CrawlFileData = {}

  if (kind === 'sitemap') {
    const sitemap = input.sitemap === undefined ? readSitemap(outcome, url) : input.sitemap
    if (sitemap) {
      const { format, entries, lastModified } = sitemap
      data.sitemap = { format, entries, lastModified }
    }
  } else {
    const text = readTextFile(outcome)
    if (text !== null) {
      if (kind === 'feed') {
        const feed = parseFeed(text)
        if (feed) data.feed = feed
      }
      if (kind === 'opensearch') {
        const opensearch = parseOpenSearch(text)
        if (opensearch) data.opensearch = opensearch
      }
      const bytes = Buffer.byteLength(text)
      if (bytes > MAX_CRAWL_FILE_BODY_BYTES) truncated = true
      // Cut by bytes, so a multi-byte character at the edge costs a replacement character at most.
      body =
        bytes > MAX_CRAWL_FILE_BODY_BYTES
          ? Buffer.from(text).subarray(0, MAX_CRAWL_FILE_BODY_BYTES).toString('utf8')
          : text
    }
  }

  return {
    ...base,
    statusCode: outcome.statusCode,
    contentType,
    redirectTo,
    bytes: outcome.bytes,
    truncated,
    body,
    error: null,
    data: Object.keys(data).length > 0 ? data : null,
  }
}

export interface FetchedCrawlFiles {
  files: NewCrawlFile[]
  /** There were more sitemaps than a refresh requests, so `files` does not hold them all. */
  capped: boolean
}

/**
 * Requests a domain's files and nothing else, one at a time at the pace of its settings: what a
 * crawl would find out about them, in a fraction of the requests.
 */
export async function fetchCrawlFiles(input: {
  host: string
  settings: CrawlSettings
  fetcher: Fetcher
  signal: AbortSignal
  now: () => Date
  /** Scales the waits between retries down in tests. */
  retryBaseMs?: number
}): Promise<FetchedCrawlFiles> {
  const { host, settings, fetcher, signal, now } = input
  const retryBaseMs = input.retryBaseMs ?? RETRY_BASE_MS
  const interval = 1000 / settings.requestsPerSecond

  async function request(
    url: string,
    options: { readBody?: 'auto' | 'force'; maxBytes?: number },
  ): Promise<FetchedResponse | FetchError> {
    for (let attempt = 0; ; attempt++) {
      await abortableSleep(interval, signal)
      if (signal.aborted) throw new DOMException('Refresh stopped', 'AbortError')
      const backoff = retryBaseMs * 2 ** attempt
      try {
        const response = await fetcher.fetch(url, { signal, ...options })
        if (!RETRYABLE_STATUS.has(response.statusCode) || attempt >= settings.maxRetries) {
          return response
        }
        const asked = parseRetryAfter(response.headers['retry-after']) ?? backoff
        await abortableSleep(Math.min(asked, MAX_REFRESH_WAIT_MS), signal)
      } catch (error) {
        if (!(error instanceof FetchError)) throw error
        if (PERMANENT_ERRORS.has(error.code) || attempt >= settings.maxRetries) return error
        await abortableSleep(backoff, signal)
      }
    }
  }

  const queue: CrawlFileRequest[] = []
  const seen = new Set<string>()
  const enqueue = (url: string, kind: CrawlFileKind) => {
    // A crawl file can point anywhere: only what a page links to gets checked, and only by a crawl.
    if (seen.has(url) || !isInternalUrl(url, host)) return
    seen.add(url)
    queue.push({ url, kind })
  }
  for (const { url, kind } of crawlFileRequests(host, settings)) enqueue(url, kind)

  // Sites announce feeds and search descriptions from their pages, at whatever URL they like.
  const wanted = settings.optionalFiles
  if (wanted.includes('feed') || wanted.includes('opensearch')) {
    for (const start of [`https://${host}/`, `https://www.${host}/`]) {
      let url: string | null = start
      for (let hop = 0; url && hop < MAX_HOME_HOPS; hop++) {
        const answer: FetchedResponse | FetchError = await request(url, {})
        if (answer instanceof FetchError) break
        if (isRedirect(answer.statusCode)) {
          const target: string | null = answer.headers.location
            ? normalizeCrawlUrl(answer.headers.location, url)
            : null
          url = target && isInternalUrl(target, host) ? target : null
          continue
        }
        if (answer.body && HTML_TYPE.test(answer.headers['content-type'] ?? '')) {
          const page = extractHtml(decodeText(answer.body, answer.headers['content-type']), url)
          if (wanted.includes('feed')) for (const feed of page.feeds) enqueue(feed, 'feed')
          if (wanted.includes('opensearch')) {
            for (const description of page.openSearch) enqueue(description, 'opensearch')
          }
        }
        break
      }
    }
  }

  const files: NewCrawlFile[] = []
  let sitemaps = 0
  let capped = false
  for (let next = queue.shift(); next; next = queue.shift()) {
    if (next.kind === 'sitemap' && sitemaps >= MAX_REFRESH_SITEMAPS) {
      capped = true
      continue
    }
    if (next.kind === 'sitemap') sitemaps++

    const outcome = await request(next.url, crawlFileFetchOptions(next.kind))
    const sitemap =
      next.kind === 'sitemap' && !(outcome instanceof FetchError)
        ? readSitemap(outcome, next.url)
        : null
    const file = captureCrawlFile({
      request: next,
      outcome,
      via: 'refresh',
      fetchedAt: now(),
      sitemap,
    })
    files.push(file)

    if (file.redirectTo) enqueue(file.redirectTo, next.kind)
    if (next.kind === 'robots' && file.body !== null) {
      for (const url of parseRobotsSitemaps(file.body, next.url)) enqueue(url, 'sitemap')
    }
    for (const url of sitemap?.sitemaps ?? []) enqueue(url, 'sitemap')
  }
  return { files, capped }
}
