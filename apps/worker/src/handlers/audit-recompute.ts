import { auditRecomputePayload } from '@seotools/core'
import type { Database } from '@seotools/db'
import { recomputeAudit } from '../crawl/audit-recompute'
import { PermanentJobError, type JobHandler } from '../types'

/** Analyses a domain's latest full crawl again with its audit configuration: see `recomputeAudit`. */
export function createAuditRecomputeHandler(options: { db: Database }): JobHandler {
  return async (job, ctx) => {
    const parsed = auditRecomputePayload.safeParse(job.payload)
    if (!parsed.success) throw new PermanentJobError(`Invalid payload: ${parsed.error.message}`)
    return recomputeAudit({
      db: options.db,
      domainId: parsed.data.domainId,
      log: ctx.log,
      signal: ctx.signal,
      finalAttempt: job.attempts >= job.maxAttempts,
    })
  }
}
