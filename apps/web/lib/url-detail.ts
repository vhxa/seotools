import type { Crawl, CrawlUrl, CrawlUrlIssue } from '@seotools/db'
import type { CrawlLinkKind } from '@seotools/core'
import { getDb } from './db'

export interface UrlDetailData {
  crawl: Crawl
  url: CrawlUrl
  issues: CrawlUrlIssue[]
  /** Pages of the crawl that link here, and what this URL links to: capped, see `hasMore*`. */
  linksIn: { url: string; kind: CrawlLinkKind }[]
  linksOut: { url: string; kind: CrawlLinkKind }[]
  hasMoreIn: boolean
  hasMoreOut: boolean
  priority: boolean
}

/**
 * Everything the detail of a URL shows, as the crawl saw it, or `null` if the crawl does not have
 * that URL. A page linked from every other page (the home) has thousands of links, hence the cap.
 */
export async function loadUrlDetail(input: {
  domainId: string
  crawl: Crawl
  urlHash: string
  linkLimit: number
}): Promise<UrlDetailData | null> {
  const { domainId, crawl, urlHash, linkLimit } = input
  const db = await getDb()
  const url = await db.crawls.getUrl(crawl.id, urlHash)
  if (!url) return null
  const [issues, linksIn, linksOut, priorities] = await Promise.all([
    db.crawls.issuesOf(crawl.id, [urlHash]),
    db.crawls.linkSources(crawl.id, urlHash, { limit: linkLimit + 1 }),
    db.crawls.linkTargets(crawl.id, urlHash, { limit: linkLimit + 1 }),
    db.priorityUrls.list(domainId),
  ])
  return {
    crawl,
    url,
    issues,
    linksIn: linksIn.slice(0, linkLimit),
    linksOut: linksOut.slice(0, linkLimit),
    hasMoreIn: linksIn.length > linkLimit,
    hasMoreOut: linksOut.length > linkLimit,
    priority: priorities.some((p) => p.urlHash === urlHash),
  }
}
