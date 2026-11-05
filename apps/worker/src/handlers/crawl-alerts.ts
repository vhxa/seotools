import { crawlAlertsPayload } from '@seotools/core'
import type { Database } from '@seotools/db'
import { runCrawlAlerts } from '../alerts/run'
import { PermanentJobError, type JobHandler } from '../types'

/** Tells the people who asked about a full crawl that ended: see `runCrawlAlerts`. */
export function createCrawlAlertsHandler(deps: {
  db: Database
  publicUrl: string | undefined
}): JobHandler {
  return async (job, ctx) => {
    const parsed = crawlAlertsPayload.safeParse(job.payload)
    if (!parsed.success) throw new PermanentJobError(`Invalid payload: ${parsed.error.message}`)
    return runCrawlAlerts({
      db: deps.db,
      log: ctx.log,
      signal: ctx.signal,
      crawlId: parsed.data.crawlId,
      publicUrl: deps.publicUrl,
      getMailer: ctx.getMailer,
    })
  }
}
