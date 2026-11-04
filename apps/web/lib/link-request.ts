import {
  isLinkDirection,
  parseLinkFilter,
  type LinkDirection,
  type LinkFilter,
} from '@seotools/core/crawl/links'
import { findCrawl, type CrawlSource } from './crawl-history'
import { isCrawlId, isUrlHash } from './pages-query'
import { loadUrlLinks, type LinkSource, type UrlLinksPage } from './url-links'

/** What a client asks the server for. */
export interface LinksRequest {
  crawlId: string
  urlHash: string
  direction: LinkDirection
  filter: LinkFilter
  page: number
}

/**
 * A request from the browser, which is only ever a claim: the ids must have the shape of ids, the
 * direction be one of the two, and the filter is read leniently (`parseLinkFilter`). Whether the
 * crawl is one of the domain's is for `answerLinksRequest` to check. `null`: not a request at all.
 */
export function parseLinksRequest(input: unknown): LinksRequest | null {
  if (typeof input !== 'object' || input === null) return null
  const raw = input as Record<string, unknown>
  if (typeof raw.crawlId !== 'string' || !isCrawlId(raw.crawlId)) return null
  if (typeof raw.urlHash !== 'string' || !isUrlHash(raw.urlHash)) return null
  if (!isLinkDirection(raw.direction)) return null
  const page = typeof raw.page === 'number' && Number.isFinite(raw.page) ? raw.page : 1
  return {
    crawlId: raw.crawlId,
    urlHash: raw.urlHash,
    direction: raw.direction,
    filter: parseLinkFilter(raw.filter),
    page: Math.max(1, Math.trunc(page)),
  }
}

/**
 * `unavailable`: the crawl is not one the domain can browse (or the request makes no sense).
 * `pruned`: the crawl is the domain's, but its results were removed and only its totals remain.
 */
export type LinksResult =
  { kind: 'ok'; links: UrlLinksPage } | { kind: 'unavailable' } | { kind: 'pruned' }

/**
 * Answers a request for a page of links on behalf of one domain. The crawl is looked up with the
 * domain, so a crawl of another domain is the same as one that does not exist, and a crawl whose
 * results were pruned says so rather than answering with an empty list, which would read as "no
 * links". Only what the crawl stored is read: nothing is requested.
 */
export async function answerLinksRequest(
  crawls: CrawlSource & LinkSource,
  domainId: string,
  input: unknown,
): Promise<LinksResult> {
  const request = parseLinksRequest(input)
  if (!request) return { kind: 'unavailable' }
  const crawl = await findCrawl(crawls, domainId, request.crawlId)
  if (!crawl) return { kind: 'unavailable' }
  if (crawl.pruned) return { kind: 'pruned' }
  return {
    kind: 'ok',
    links: await loadUrlLinks(crawls, {
      crawlId: crawl.id,
      urlHash: request.urlHash,
      direction: request.direction,
      filter: request.filter,
      page: request.page,
    }),
  }
}
