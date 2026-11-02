import {
  ISSUE_CATALOG_VERSION,
  PAGE_ISSUES,
  worstIssueType,
  type PagesByWorstIssue,
  type PagesWithType,
} from '@seotools/core'
import type { CrawlUrlIssue, Database } from '@seotools/db'
import { detectIssues } from './issue-checks'
import { loadSite } from './site-audit'

export interface CrawlAnalysis {
  pages: number
  pagesByWorstIssue: PagesByWorstIssue
  pagesWithType: PagesWithType
}

/**
 * Checks every URL of a crawl against `PAGE_ISSUES` and stores what it finds, replacing any earlier
 * analysis. Safe to repeat, e.g. after the list of issues changes. Pages parsed before a check
 * existed have nothing for it to look at, so only a new crawl makes the result complete.
 */
export async function analyseCrawl(db: Database, crawlId: string): Promise<CrawlAnalysis> {
  const crawl = await db.crawls.get(crawlId)
  if (!crawl) throw new Error(`Crawl ${crawlId} not found`)

  const site = await loadSite(db, crawl)
  const issues: CrawlUrlIssue[] = []
  const pagesByWorstIssue: PagesByWorstIssue = { issue: 0, warning: 0, opportunity: 0 }
  const pagesWithType: PagesWithType = { issue: 0, warning: 0, opportunity: 0 }
  let pages = 0
  for (const url of site.urls) {
    const found = detectIssues(url, site)
    for (const { issue, details } of found) {
      issues.push({ urlHash: url.url.urlHash, issue, ...(details ? { details } : {}) })
    }
    if (!url.internal || url.url.kind !== 'page') continue
    pages++
    const worst = worstIssueType(found.map((finding) => finding.issue))
    if (worst) pagesByWorstIssue[worst]++
    for (const type of new Set(found.map((finding) => PAGE_ISSUES[finding.issue].type))) {
      pagesWithType[type]++
    }
  }
  await db.crawls.saveIssues({
    crawlId,
    issues,
    pages: pagesByWorstIssue,
    withType: pagesWithType,
    catalog: ISSUE_CATALOG_VERSION,
  })
  return { pages, pagesByWorstIssue, pagesWithType }
}
