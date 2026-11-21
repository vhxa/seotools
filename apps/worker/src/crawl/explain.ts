import type { Logger } from '@seotools/core'
import {
  comparisonBaseOf,
  explainPair,
  type Database,
  type ExplainOptions,
  type ExplainOutcome,
} from '@seotools/db'

/**
 * Overrides of what the explanation of a pair reads from other packages. `explainPair`'s defaults are
 * the real ones: WP1's capture rule (`captureProvesAbsence`), the stored paired observations and their
 * witness (`storedSiteVariation`) and the crawls' discovery snapshots (reach). Tests pass doubles.
 */
export type ExplainSources = Pick<ExplainOptions, 'captureTrust' | 'variation' | 'reach'>

/**
 * Works out why URLs differ between a full crawl that just ended and the crawl it is compared with
 * (the same pair its alerts and the comparison page show by default). Requests nothing. Returns
 * `null` when there is no pair (a first crawl, or no earlier one that completed with its results).
 */
export async function explainLatestPair(input: {
  db: Database
  crawlId: string
  runner: string
  log: Logger
  signal?: AbortSignal
  sources?: ExplainSources
}): Promise<{ outcome: ExplainOutcome; ms: number } | null> {
  const { db, crawlId, log } = input
  const target = await db.crawls.get(crawlId)
  if (!target || target.type !== 'full' || target.pruned) return null
  const base = await comparisonBaseOf(db, target)
  if (!base) return null
  const started = performance.now()
  const outcome = await explainPair({
    db,
    baseId: base.id,
    targetId: target.id,
    runner: input.runner,
    ...(input.signal ? { signal: input.signal } : {}),
    ...input.sources,
  })
  const ms = Math.round(performance.now() - started)
  log.info({ baseId: base.id, targetId: target.id, outcome, ms }, 'worked out why URLs differ')
  return { outcome, ms }
}

/**
 * At startup: asks for the latest pair of every domain that is not archived to be explained when
 * its explanation is missing, made with older rules or stuck (`requestComparison` decides, and
 * queues at most one job per pair). This is how pairs crawled before this version get their reasons.
 */
export async function requestLatestExplanations(options: {
  db: Database
  log: Logger
  stopped?: () => boolean
}): Promise<number> {
  const { db, log } = options
  let queued = 0
  for (const company of await db.companies.list()) {
    for (const domain of company.domains) {
      if (options.stopped?.()) return queued
      if (domain.archivedAt) continue
      try {
        const target = await db.crawls.latestWithResults(domain.id, 'full')
        if (!target || target.pruned) continue
        const base = await comparisonBaseOf(db, target)
        if (!base) continue
        const before = await db.crawls.comparisonHeader({
          domainId: domain.id,
          baseId: base.id,
          targetId: target.id,
        })
        const after = await db.crawls.requestComparison({
          domainId: domain.id,
          baseId: base.id,
          targetId: target.id,
        })
        if (after?.jobId && after.jobId !== before?.jobId) queued++
      } catch (err) {
        log.error({ err, domainId: domain.id }, 'could not ask for a comparison to be explained')
      }
    }
  }
  if (queued > 0) log.info({ queued }, 'asked for comparisons to be explained')
  return queued
}
