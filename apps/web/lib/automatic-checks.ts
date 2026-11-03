import { crawlFileKindOf } from '@seotools/core/crawl/files'
import type { CrawlRepository, CrawlUrl } from '@seotools/db'

/** A stored source alone does not prove a guess: a link may have been found later. */
export const isAutomaticFileCheck = (
  source: CrawlUrl['source'],
  linksIn: number,
  siteAnswered: boolean,
) => crawlFileKindOf(source) !== null && linksIn === 0 && siteAnswered

/** Read only the displayed candidates' incoming links, within the selected crawl. */
export async function automaticFileChecks(
  crawls: Pick<CrawlRepository, 'listUrls' | 'linkSources'>,
  crawlId: string,
  urls: CrawlUrl[],
): Promise<Set<string>> {
  const candidates = urls.filter((url) => crawlFileKindOf(url.source) !== null)
  if (candidates.length === 0) return new Set()
  // A successful HTML page is the audit's evidence that the site answered. Ascending status
  // keeps an all-error site from being mistaken for an absent optional file.
  const [page] = await crawls.listUrls({
    crawlId,
    view: 'pages',
    sort: 'status',
    direction: 'asc',
    limit: 1,
    offset: 0,
  })
  const answered =
    page?.statusCode !== null &&
    page?.statusCode !== undefined &&
    page.statusCode >= 200 &&
    page.statusCode < 300
  if (!answered) return new Set()
  const checks = await Promise.all(
    candidates.map(async (url) => {
      const links = await crawls.linkSources(crawlId, url.urlHash, { limit: 1 })
      return isAutomaticFileCheck(url.source, links.length, answered) ? url.urlHash : null
    }),
  )
  return new Set(checks.filter((hash): hash is string => hash !== null))
}
