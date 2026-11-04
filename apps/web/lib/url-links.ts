import {
  DEFAULT_LINK_FILTER,
  LINKS_PAGE_SIZE,
  filterKinds,
  foldLinkKindCounts,
  type LinkDirection,
  type LinkFilter,
  type LinkKindCounts,
} from '@seotools/core/crawl/links'
import type { CrawlLinkRow, CrawlRepository } from '@seotools/db'

/**
 * The links of one URL of a crawl, in one direction, a page at a time. The server reads them from
 * what the crawl stored (`CrawlRepository.listLinks`) and never requests anything, and the filter
 * is applied there: the browser only holds the page it shows. Pure on purpose, so the client
 * component that lists them can import `applyHref` and the types.
 */

/** What the links of a URL need of the database. */
export type LinkSource = Pick<CrawlRepository, 'listLinks' | 'countLinks' | 'linkKindCounts'>

export interface UrlLinksPage {
  direction: LinkDirection
  /** What the list is narrowed to, as the server understood it. */
  filter: LinkFilter
  /** The links the URL has of each type in this direction, whatever the filter: what is on offer. */
  counts: LinkKindCounts
  /** The links the filter keeps, across every page. */
  total: number
  page: number
  pageCount: number
  items: CrawlLinkRow[]
}

/**
 * A page of the links of `urlHash` in a crawl. The caller has already checked that the crawl is
 * one it may read (`findCrawl`, which asks with the domain): everything is read within it.
 */
export async function loadUrlLinks(
  source: LinkSource,
  input: {
    crawlId: string
    urlHash: string
    direction: LinkDirection
    filter?: LinkFilter
    page?: number
  },
): Promise<UrlLinksPage> {
  const { crawlId, urlHash, direction } = input
  const filter = input.filter ?? DEFAULT_LINK_FILTER
  const kinds = filterKinds(filter)
  const query = {
    crawlId,
    urlHash,
    direction,
    ...(kinds ? { kinds } : {}),
    ...(filter.search ? { search: filter.search } : {}),
  }
  const [kindRows, total] = await Promise.all([
    source.linkKindCounts(crawlId, urlHash, direction),
    source.countLinks(query),
  ])
  const pageCount = Math.max(1, Math.ceil(total / LINKS_PAGE_SIZE))
  const asked = Number.isFinite(input.page) ? Math.trunc(input.page as number) : 1
  const page = Math.min(Math.max(1, asked), pageCount)
  const items =
    total === 0
      ? []
      : await source.listLinks({
          ...query,
          limit: LINKS_PAGE_SIZE,
          offset: (page - 1) * LINKS_PAGE_SIZE,
        })
  return { direction, filter, counts: foldLinkKindCounts(kindRows), total, page, pageCount, items }
}

/**
 * Where a URL's detail opens, as something that can cross to the browser: `hrefFor` is a function
 * and cannot. It has the shape of an address with the hash left out.
 */
export interface HrefPattern {
  prefix: string
  suffix: string
}

/** A hash no URL has, to tell where `hrefFor` puts it. */
const MARKER = '0'.repeat(32)

export function hrefPattern(hrefFor: (urlHash: string) => string): HrefPattern {
  const href = hrefFor(MARKER)
  const at = href.indexOf(MARKER)
  return at === -1
    ? { prefix: href, suffix: '' }
    : { prefix: href.slice(0, at), suffix: href.slice(at + MARKER.length) }
}

export const applyHref = (pattern: HrefPattern, urlHash: string) =>
  `${pattern.prefix}${urlHash}${pattern.suffix}`
