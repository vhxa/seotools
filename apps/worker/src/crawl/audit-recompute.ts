import { auditSnapshotOf, type Logger } from '@seotools/core'
import type { Crawl, Database } from '@seotools/db'
import { JobInterruptedError } from '../types'
import { analyseCrawl, recordedAuditConfig } from './analysis'

/** Times it looks again at a configuration that keeps changing under it, before leaving it to the job that change queued. */
const MAX_ROUNDS = 5

export interface AuditRecomputeResult {
  /** The crawl it analysed last, or `null` if the domain has no full crawl with results. */
  crawlId: string | null
  /** The version of the configuration the crawl is analysed with now. */
  version: number
  /** Analyses it made. `0` when the crawl was already up to date. */
  analysed: number
}

/** Analysed with a configuration at least as new as `version`: nothing to do for it. */
const isCurrent = (crawl: Crawl, version: number) =>
  crawl.pagesByWorstIssue !== null && (crawl.auditVersion ?? 0) >= version

/**
 * Analyses the latest full crawl of a domain again with the domain's current audit configuration,
 * from what the crawl stored: it makes no request to the site. It is what runs after a rule or an
 * exception changes, and what makes the pages of the crawl say what the settings say.
 *
 * Safe to run twice, concurrently or after a crash, and with rules that change while it runs:
 * - each analysis uses one version of the configuration from start to end;
 * - saving one is refused if the crawl already has a newer one (`saveAnalysis`), so a slow job never
 *   puts old results over new ones;
 * - when it finishes it looks at the configuration again, and if it moved on, analyses again.
 * By default only the latest full crawl is touched. A targeted vitals refresh of an older crawl
 * keeps its recorded configuration.
 */
export async function recomputeAudit(options: {
  db: Database
  domainId: string
  log: Logger
  signal?: AbortSignal
  /** Target a stored crawl after new measurements arrive; older crawls keep their configuration. */
  crawlId?: string
  /** Analyse even when the audit version is current, because the stored inputs changed. */
  force?: boolean
  /**
   * The last attempt the queue allows: if it fails, nothing will try again, and the failure is
   * recorded for the settings page to show. Earlier failures are retried, and recorded by nobody.
   */
  finalAttempt: boolean
}): Promise<AuditRecomputeResult> {
  const { db, domainId, log, signal } = options
  let analysed = 0
  let last: { crawlId: string | null; version: number } = { crawlId: null, version: 0 }
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal?.aborted) throw new JobInterruptedError()
    // Deleted since the change that queued this job: there is nothing left to analyse.
    if (!(await db.domains.get(domainId))) return { ...last, analysed }
    const config = await db.audit.config(domainId)
    let snapshot = auditSnapshotOf(
      config.version,
      config.rules,
      config.languages,
      config.thresholds,
    )
    const latest = await db.crawls.latestWithResults(domainId, 'full')
    const crawl = options.crawlId ? await db.crawls.get(options.crawlId) : latest
    if (crawl && crawl.domainId !== domainId) throw new Error('Crawl belongs to another domain')
    if (crawl && latest?.id !== crawl.id) snapshot = recordedAuditConfig(crawl)
    last = { crawlId: crawl?.id ?? null, version: snapshot.version }
    if (!crawl || (!(options.force && round === 0) && isCurrent(crawl, snapshot.version))) {
      if (!crawl || crawl.id === latest?.id)
        await db.audit.clearRecomputeFailure({ domainId, version: snapshot.version })
      return { ...last, analysed }
    }
    try {
      const result = await analyseCrawl(db, crawl.id, snapshot)
      analysed++
      log.info(
        { crawlId: crawl.id, version: snapshot.version, saved: result.saved },
        'analysed the latest crawl again with the audit configuration',
      )
    } catch (error) {
      if (
        options.finalAttempt &&
        crawl.id === latest?.id &&
        !(error instanceof JobInterruptedError)
      ) {
        await db.audit
          .failRecompute({
            domainId,
            version: snapshot.version,
            error: error instanceof Error ? error.message : String(error),
          })
          .catch((e) => log.error({ err: e }, 'could not record that the recalculation failed'))
      }
      throw error
    }
  }
  // It kept changing. Each change queued a job of its own, which will have the last word.
  log.warn({ domainId }, 'the audit configuration kept changing: leaving the rest to the next job')
  return { ...last, analysed }
}
