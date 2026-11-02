import { ISSUE_CATALOG_VERSION, type Logger } from '@seotools/core'
import type { Database } from '@seotools/db'
import { analyseCrawl } from './analysis'

/** Crawls analysed again at a time. Each one is loaded whole into memory. */
const BATCH = 5

/**
 * Analyses again the crawls that were analysed with another version of the issue catalog, which is
 * what happens after the catalog changes: the types and importance of the issues are the new ones,
 * but the totals each crawl stored are not. It uses what the crawl stored, so it cannot find what
 * pages parsed before a check existed never recorded. Crawls whose results were pruned keep their
 * old totals. Returns how many were analysed.
 */
export async function reanalyseOutdatedCrawls(options: {
  db: Database
  log: Logger
  /** Checked between crawls, so that shutting down does not wait for all of them. */
  stopped?: () => boolean
}): Promise<number> {
  const { db, log } = options
  const failed = new Set<string>()
  let done = 0
  while (!options.stopped?.()) {
    const outdated = (await db.crawls.outdatedAnalyses(ISSUE_CATALOG_VERSION, failed.size + BATCH))
      .filter((crawl) => !failed.has(crawl.id))
      .slice(0, BATCH)
    if (outdated.length === 0) break
    for (const crawl of outdated) {
      if (options.stopped?.()) return done
      try {
        await analyseCrawl(db, crawl.id)
        done++
        log.info({ crawlId: crawl.id }, 'analysed a crawl again with the current issue catalog')
      } catch (err) {
        failed.add(crawl.id)
        log.error({ err, crawlId: crawl.id }, 'could not analyse a crawl again')
      }
    }
  }
  return done
}
