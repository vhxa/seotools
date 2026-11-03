import { urlVerifyPayload } from '@seotools/core'
import type { Database } from '@seotools/db'
import { runVerification } from '../crawl/verification'
import { createHttpFetcher } from '../crawl/fetcher'
import { JobDeferredError, JobInterruptedError, PermanentJobError, type JobHandler } from '../types'

/**
 * Requests the URLs of a recheck again and stores what each one answered and concluded: see
 * `runVerification`. It runs in the crawl lane, since it makes requests to a site like a crawl does.
 */
export function createUrlVerifyHandler(options: {
  db: Database
  allowPrivateNetworks: boolean
  appVersion?: string
}): JobHandler {
  return async (job, ctx) => {
    const parsed = urlVerifyPayload.safeParse(job.payload)
    if (!parsed.success) throw new PermanentJobError(`Invalid payload: ${parsed.error.message}`)
    const { verificationId } = parsed.data
    try {
      return await runVerification(verificationId, {
        db: options.db,
        log: ctx.log,
        signal: ctx.signal,
        appVersion: options.appVersion,
        createFetcher: (config) =>
          createHttpFetcher({ ...config, allowPrivateNetworks: options.allowPrivateNetworks }),
      })
    } catch (error) {
      // Waiting and shutting down are not failures. Out of attempts, nothing will try again, so the
      // recheck says so now instead of waiting for the sweep that finds jobs that gave up.
      const waiting = error instanceof JobDeferredError || error instanceof JobInterruptedError
      if (!waiting && job.attempts >= job.maxAttempts) {
        await options.db.verifications
          .finish(verificationId, {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
          .catch((e) => ctx.log.error({ err: e }, 'could not record that the recheck failed'))
      }
      throw error
    }
  }
}
