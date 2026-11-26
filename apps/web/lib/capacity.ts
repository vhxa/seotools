import type { CrawlCapacitySample } from '@seotools/core/capacity'
import type { CrawlRendering, Database } from '@seotools/db'

export async function lastCapacitySample(
  db: Database,
  domainId: string,
  mode: CrawlRendering['mode'],
): Promise<CrawlCapacitySample | null> {
  const crawl = await db.crawls.latestWithResults(domainId, 'full', mode)
  if (!crawl) return null
  const metrics =
    crawl.capacityMetrics ??
    (crawl.pruned ? null : (await db.crawls.measureCapacity(crawl.id, mode === 'rendered')).metrics)
  return {
    metrics,
    elapsedMs:
      crawl.finishedAt && crawl.startedAt
        ? crawl.finishedAt.getTime() - crawl.startedAt.getTime()
        : 0,
    pace: crawl.discoverySettings,
    renderSlots: crawl.rendering?.slots?.length === 1 ? crawl.rendering.slots[0]! : null,
  }
}
