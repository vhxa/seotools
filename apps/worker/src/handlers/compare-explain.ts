import { compareExplainPayload } from '@seotools/core'
import { explainPair, type Database } from '@seotools/db'
import type { ExplainSources } from '../crawl/explain'
import { JobInterruptedError, PermanentJobError, type JobHandler } from '../types'

/**
 * Works out why URLs differ between two crawls of a pair (`explainPair`), queued by
 * `requestComparison` when someone opens a pair that has no current explanation, or at startup. It
 * requests nothing. Shutting down hands it back; it starts over on the next attempt.
 */
export function createCompareExplainHandler(deps: {
  db: Database
  sources?: ExplainSources
}): JobHandler {
  return async (job, ctx) => {
    const parsed = compareExplainPayload.safeParse(job.payload)
    if (!parsed.success) throw new PermanentJobError(`Invalid payload: ${parsed.error.message}`)
    const started = performance.now()
    try {
      const outcome = await explainPair({
        db: deps.db,
        ...parsed.data,
        runner: job.id,
        jobId: job.id,
        signal: ctx.signal,
        // Another attempt follows: the pair stays queued for this job; the last one fails it, and
        // it is asked for again only after its back-off.
        onFailure: job.attempts >= job.maxAttempts ? { state: 'failed' } : { state: 'queued' },
        ...deps.sources,
      })
      const ms = Math.round(performance.now() - started)
      ctx.log.info({ ...parsed.data, outcome, ms }, 'worked out why URLs differ')
      return { outcome, ms }
    } catch (error) {
      if (ctx.signal.aborted) throw new JobInterruptedError()
      throw error
    }
  }
}
