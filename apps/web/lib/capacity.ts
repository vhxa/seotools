import type { CrawlCapacitySample } from '@seotools/core/capacity'
import type { CrawlRendering, Database } from '@seotools/db'

export async function lastCapacitySample(
  db: Database,
  domainId: string,
  mode: CrawlRendering['mode'],
): Promise<CrawlCapacitySample | null> {
  const crawl = await db.crawls.latestWithResults(domainId, 'full', mode)
  if (!crawl || !crawl.finishedAt || !crawl.startedAt) return null
  const metrics =
    crawl.capacityMetrics ??
    (await db.crawls.measureCapacity(crawl.id, mode === 'rendered')).metrics
  return {
    metrics,
    elapsedMs: crawl.finishedAt.getTime() - crawl.startedAt.getTime(),
    pace: crawl.discoverySettings,
    renderSlots: crawl.rendering?.slots?.length === 1 ? crawl.rendering.slots[0]! : null,
  }
}
