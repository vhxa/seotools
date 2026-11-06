import {
  crawlFileKindOf,
  normalizeCrawlUrl,
  parseLlms,
  type CrawlLinkKind,
  type CrawlPageData,
  type CrawlUrlKind,
  type CrawlUrlSource,
  type LinkContext,
  type Logger,
} from '@seotools/core'
import type { CrawlUrlResult } from '@seotools/db'
import {
  extractCssUrls,
  extractHtml,
  parseLinkHeader,
  parseRefresh,
  parseRobotsSitemaps,
  parseSitemap,
  type ExtractedLink,
  type ParsedSitemap,
} from './extract'
import { decodeSitemapBody, decodeText, type FetchError, type FetchedResponse } from './fetcher'
import { readTextFile } from './files'
import { missingSecurityHeaders, withResponseFacts } from './page-facts'
import { isRedirect } from './requests'

/** robots.txt files past this size are ignored by Google, so nothing past it matters to an audit. */
export const MAX_ROBOTS_BYTES = 512 * 1024

const HTML = /^(text\/html|application\/xhtml\+xml)\b/i
const CSS = /^text\/css\b/i
const XML = /^(text\/xml|application\/(xml|[\w.+-]*\+xml))\b/i

/** A URL that was not requested, or that never answered. */
export const emptyResult: CrawlUrlResult = {
  kind: 'unknown',
  statusCode: null,
  contentType: null,
  redirectTo: null,
  title: null,
  metaRobots: null,
  xRobotsTag: null,
  canonical: null,
  responseTimeMs: null,
  bytes: null,
  error: null,
  data: null,
}

/** What is kept of a request that failed before it got an answer. */
export function failureResult(error: FetchError): CrawlUrlResult {
  return {
    ...emptyResult,
    responseTimeMs: error.responseTimeMs,
    error: `${error.code}: ${error.message}`,
  }
}

export interface AnalysedResponse {
  result: CrawlUrlResult
  /** The sitemap, when what answered was read as one. */
  sitemap: ParsedSitemap | null
}

/**
 * Turns what a URL answered into what is kept of it: its kind, the data checks look at, and every
 * URL and link found in it (reported to `discover`, which decides what to do with them). It is the
 * one place a response is read, for a crawl and for a recheck alike, so that both collect the same.
 */
export function analyseResponse(input: {
  item: { url: string; source: CrawlUrlSource }
  response: FetchedResponse
  /** The domain's optional crawl files: a feed or OpenSearch link in a home page is one. */
  optionalFiles: readonly string[]
  log: Logger
  discover: (
    url: string,
    kind: CrawlLinkKind,
    source?: CrawlUrlSource,
    context?: LinkContext,
  ) => void
}): AnalysedResponse {
  const { item, response, log } = input
  const { statusCode, headers, body } = response
  const contentType = headers['content-type'] ?? null
  const fromHere = (
    url: string,
    kind: CrawlLinkKind,
    source: CrawlUrlSource = 'link',
    context?: LinkContext,
  ) => input.discover(url, kind, source, context)
  const addAll = (links: ExtractedLink[]) => {
    for (const { url, kind, context } of links) fromHere(url, kind, 'link', context)
  }

  let kind: CrawlUrlKind = 'resource'
  let redirectTo: string | null = null
  let canonical: string | null = null
  let title: string | null = null
  let metaRobots: string | null = null
  const data: CrawlPageData = {}
  const fileKind = crawlFileKindOf(item.source)
  let sitemap: ParsedSitemap | null = null

  const linkHeader = headers.link ? parseLinkHeader(headers.link, item.url) : null
  if (linkHeader) {
    addAll(linkHeader.links)
    canonical = linkHeader.canonical
    if (linkHeader.hreflang.length > 0) data.hreflang = linkHeader.hreflang
  }
  const refreshHeader = headers.refresh
    ? normalizeCrawlUrl(parseRefresh(headers.refresh) ?? '', item.url)
    : null
  if (refreshHeader) fromHere(refreshHeader, 'http-header')

  if (isRedirect(statusCode)) {
    kind = 'redirect'
    redirectTo = headers.location ? normalizeCrawlUrl(headers.location, item.url) : null
    if (redirectTo) {
      // A moved crawl file is still one, so it gets read as such where it landed.
      fromHere(redirectTo, 'redirect', fileKind ? item.source : 'redirect')
    }
  } else if (item.source === 'robots') {
    const text =
      statusCode === 200 && body
        ? decodeText(body.subarray(0, MAX_ROBOTS_BYTES), contentType ?? undefined)
        : null
    if (text !== null) {
      for (const sitemap of parseRobotsSitemaps(text, item.url)) {
        fromHere(sitemap, 'sitemap', 'sitemap-file')
      }
    }
  } else if (fileKind && fileKind !== 'sitemap') {
    // Never a page, even when a site answers every path with one: that page is not this file.
    if (fileKind === 'llms') {
      const text = readTextFile(response)
      for (const section of text === null ? [] : parseLlms(text).sections) {
        for (const link of section.links) {
          const url = normalizeCrawlUrl(link.url, item.url)
          if (url) fromHere(url, 'llms')
        }
      }
    }
  } else if (item.source === 'sitemap-file' || (body && contentType && XML.test(contentType))) {
    if (statusCode === 200 && body) {
      try {
        const text = decodeSitemapBody(body)
        sitemap = parseSitemap(text, item.url)
        if (sitemap.format !== null) {
          // `references` also says that the links below tell a listing from a mention.
          data.sitemapSize = {
            entries: sitemap.entries,
            bytes: Buffer.byteLength(text),
            references: sitemap.references.length,
          }
        }
        // Listed: the only links of the `sitemap` type that put a URL in a sitemap. The rest is still
        // requested (it is part of the site), under the type that says what the sitemap did with it.
        for (const url of sitemap.urls) fromHere(url, 'sitemap', 'sitemap')
        for (const { url, kind } of sitemap.references) fromHere(url, kind, 'sitemap')
        for (const url of sitemap.sitemaps) fromHere(url, 'sitemap', 'sitemap-file')
      } catch (error) {
        log.warn({ url: item.url, err: error }, 'could not read sitemap')
      }
    }
  } else if (contentType && HTML.test(contentType)) {
    kind = 'page'
    if (body) {
      const page = extractHtml(decodeText(body, contentType), item.url)
      // Before the links, which include them: the first source a URL is found under is the one.
      if (item.source === 'seed' || item.source === 'redirect') {
        const wanted = input.optionalFiles
        if (wanted.includes('feed')) {
          for (const url of page.feeds) fromHere(url, 'head-link', 'feed')
        }
        if (wanted.includes('opensearch')) {
          for (const url of page.openSearch) fromHere(url, 'head-link', 'opensearch')
        }
      }
      addAll(page.links)
      title = page.title
      metaRobots = page.metaRobots
      canonical = page.canonical ?? canonical
      if (page.description) data.description = page.description
      if (page.h1.length > 0) data.h1 = page.h1
      if (page.hreflang.length > 0) data.hreflang = [...(data.hreflang ?? []), ...page.hreflang]
      if (Object.keys(page.botRobots).length > 0) data.botRobots = page.botRobots
      data.facts = withResponseFacts(page.facts, {
        canonical: linkHeader?.canonical
          ? { url: linkHeader.canonical, raw: linkHeader.canonical, inHead: true, source: 'header' }
          : null,
        refresh: refreshHeader,
        missing: missingSecurityHeaders(headers, item.url.startsWith('https:')),
      })
    }
  } else if (contentType && CSS.test(contentType) && body) {
    addAll(extractCssUrls(decodeText(body, contentType), item.url))
  }
  if (response.truncated) data.truncated = true

  return {
    sitemap,
    result: {
      kind,
      statusCode,
      contentType,
      redirectTo,
      title,
      metaRobots,
      xRobotsTag: headers['x-robots-tag'] ?? null,
      canonical,
      responseTimeMs: response.responseTimeMs,
      bytes: response.bytes,
      error: null,
      data: Object.keys(data).length > 0 ? data : null,
    },
  }
}
