import { detectPageIssues } from '@seotools/core'
import type { CrawlUrlIssue, Database } from '@seotools/db'

const BATCH = 1000

export interface CrawlAnalysis {
  pages: number
  /** Pages with at least one issue. */
  withIssues: number
}

/**
 * Checks every page of a crawl against `PAGE_ISSUES` and stores what it finds, replacing any
 * earlier analysis. Safe to repeat, e.g. after the list of issues changes.
 */
export async function analyseCrawl(db: Database, crawlId: string): Promise<CrawlAnalysis> {
  const issues: CrawlUrlIssue[] = []
  let pages = 0
  for (let offset = 0; ; offset += BATCH) {
    const batch = await db.crawls.listUrls({ crawlId, view: 'pages', limit: BATCH, offset })
    for (const page of batch) {
      pages++
      for (const issue of detectPageIssues(page)) issues.push({ urlHash: page.urlHash, issue })
    }
    if (batch.length < BATCH) break
  }
  await db.crawls.saveIssues({ crawlId, issues })
  return { pages, withIssues: new Set(issues.map((issue) => issue.urlHash)).size }
}
