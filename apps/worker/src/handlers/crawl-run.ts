import { crawlRunPayload } from '@seotools/core'
import type { Database } from '@seotools/db'
import { runCrawl } from '../crawl/engine'
import { createHttpFetcher } from '../crawl/fetcher'
import { PermanentJobError, type JobHandler } from '../types'

export function createCrawlRunHandler(options: {
  db: Database
  allowPrivateNetworks: boolean
  appVersion?: string
}): JobHandler {
  return async (job, ctx) => {
    const parsed = crawlRunPayload.safeParse(job.payload)
    if (!parsed.success) throw new PermanentJobError(`Invalid payload: ${parsed.error.message}`)
    return runCrawl(parsed.data.crawlId, {
      db: options.db,
      log: ctx.log,
      signal: ctx.signal,
      appVersion: options.appVersion,
      createFetcher: (config) =>
        createHttpFetcher({ ...config, allowPrivateNetworks: options.allowPrivateNetworks }),
    })
  }
}
