import type { CrawlRepository } from '@seotools/db'
import { MAX_SEARCH_LENGTH } from './pages-query'

/** How many URLs the search of the header offers. It is a way to jump to one URL, not a listing. */
export const URL_SEARCH_LIMIT = 8

/** What the search needs of the database. */
export type UrlSearchSource = Pick<CrawlRepository, 'latestWithResults' | 'listUrls'>

export interface UrlSearchHit {
  /** What identifies the URL in the address of its detail. */
  hash: string
  url: string
  title: string | null
  statusCode: number | null
}

/**
 * The URLs of the domain's latest full crawl whose address or title contain the text, whatever
 * their kind: a redirect or a resource is as findable as a page. Only what the crawl stored is read.
 * The text comes from the browser, so it is cut and trimmed; an empty one finds nothing. A domain
 * without a crawl with results finds nothing either.
 */
export async function searchUrls(
  crawls: UrlSearchSource,
  domainId: string,
  input: unknown,
): Promise<UrlSearchHit[]> {
  if (typeof input !== 'string') return []
  const search = input.trim().slice(0, MAX_SEARCH_LENGTH)
  if (search === '') return []
  const crawl = await crawls.latestWithResults(domainId, 'full')
  if (!crawl) return []
  const urls = await crawls.listUrls({
    crawlId: crawl.id,
    view: 'all',
    search,
    limit: URL_SEARCH_LIMIT,
    offset: 0,
    sort: 'url',
  })
  return urls.map(({ urlHash, url, title, statusCode }) => ({
    hash: urlHash,
    url,
    title,
    statusCode,
  }))
}
