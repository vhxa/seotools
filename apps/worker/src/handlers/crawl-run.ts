import type { RenderService } from '../render/service'
import { crawlRunPayload } from '@seotools/core'
import type { Database } from '@seotools/db'
import { runCrawl } from '../crawl/engine'
import { createHttpFetcher } from '../crawl/fetcher'
import { PermanentJobError, type JobHandler } from '../types'

export function createCrawlRunHandler(options: {
  renderService?: Pick<RenderService, 'check' | 'render'>
  db: Database
  allowPrivateNetworks: boolean
  appVersion?: string
  settingsSecret?: string
}): JobHandler {
  return async (job, ctx) => {
    const parsed = crawlRunPayload.safeParse(job.payload)
    if (!parsed.success) throw new PermanentJobError(`Invalid payload: ${parsed.error.message}`)
    return runCrawl(parsed.data.crawlId, {
      db: options.db,
      renderService: options.renderService,
      log: ctx.log,
      signal: ctx.signal,
      appVersion: options.appVersion,
      settingsSecret: options.settingsSecret,
      createFetcher: (config) =>
        createHttpFetcher({ ...config, allowPrivateNetworks: options.allowPrivateNetworks }),
    })
  }
}
