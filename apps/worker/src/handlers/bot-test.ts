import { botTestPayload } from '@seotools/core'
import { runBotTest, type BotTestOptions } from '../crawl/bot-access'
import { createHttpFetcher } from '../crawl/fetcher'
import { JobDeferredError, JobInterruptedError, PermanentJobError, type JobHandler } from '../types'

export function createBotTestHandler(
  options: Omit<BotTestOptions, 'log' | 'signal' | 'createFetcher'> & {
    allowPrivateNetworks: boolean
    createFetcher?: BotTestOptions['createFetcher']
  },
): JobHandler {
  return async (job, ctx) => {
    const parsed = botTestPayload.safeParse(job.payload)
    if (!parsed.success) throw new PermanentJobError('Invalid bot test payload')
    try {
      await runBotTest(parsed.data.runId, {
        ...options,
        log: ctx.log,
        signal: ctx.signal,
        createFetcher:
          options.createFetcher ??
          ((config) =>
            createHttpFetcher({ ...config, allowPrivateNetworks: options.allowPrivateNetworks })),
      })
    } catch (error) {
      if (
        !(error instanceof JobDeferredError) &&
        !(error instanceof JobInterruptedError) &&
        job.attempts >= job.maxAttempts
      )
        await options.db.botTests.finish(parsed.data.runId, 'failed')
      throw error
    }
  }
}
