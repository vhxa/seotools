import type { Job, Logger, Mailer } from '@seotools/core'

export interface HandlerContext {
  log: Logger
  /** Aborted when the worker is shutting down. */
  signal: AbortSignal
  /** The mail provider configured by the admin, or null if none yet. */
  getMailer(): Promise<Mailer | null>
}

export type JobHandler = (job: Job, ctx: HandlerContext) => Promise<unknown>

/** Throw from a handler to fail the job right away, without retries. */
export class PermanentJobError extends Error {
  override name = 'PermanentJobError'
}

/**
 * Throw from a handler that stopped because the worker is shutting down and can pick up where it
 * left off: the job goes back to the queue without spending an attempt.
 */
export class JobInterruptedError extends Error {
  override name = 'JobInterruptedError'
  constructor() {
    super('Interrupted by a worker shutdown')
  }
}
