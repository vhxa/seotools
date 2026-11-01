import { retryDelayMs, type Job, type Logger } from '@seotools/core'
import type { Database } from '@seotools/db'
import {
  JobInterruptedError,
  PermanentJobError,
  type HandlerContext,
  type JobHandler,
} from './types'

export interface RunnerOptions {
  db: Database
  handlers: Record<string, JobHandler>
  workerId: string
  log: Logger
  getMailer: HandlerContext['getMailer']
  concurrency: number
  pollIntervalMs: number
  /** Jobs `running` longer than this are assumed orphaned and recovered. */
  lockTimeoutMs: number
  retryBaseMs?: number
  /** How often to look for orphaned jobs. */
  staleCheckIntervalMs?: number
  /** Only run these job types. */
  types?: readonly string[]
  /** Run anything but these job types. */
  excludeTypes?: readonly string[]
}

export function createRunner(options: RunnerOptions) {
  const { db, handlers, workerId, log, concurrency, pollIntervalMs, lockTimeoutMs } = options
  const staleCheckIntervalMs = options.staleCheckIntervalMs ?? 30_000
  const renewIntervalMs = lockTimeoutMs / 3
  const inFlight = new Map<string, Promise<void>>()
  const abort = new AbortController()
  let running = false
  let lastStaleCheck = 0
  let lastRenewal = Date.now()
  let wake: (() => void) | undefined

  const ctx: HandlerContext = { log, signal: abort.signal, getMailer: options.getMailer }

  async function recoverStale() {
    const recovered = await db.jobs.requeueStale({
      lockedBefore: new Date(Date.now() - lockTimeoutMs),
    })
    if (recovered > 0) log.warn({ recovered }, 'recovered jobs left running by a dead worker')
  }

  /** A job only counts as orphaned if nobody vouches for it, however long it takes. */
  async function renewLocks() {
    await Promise.all([...inFlight.keys()].map((id) => db.jobs.renewLock({ id, workerId })))
  }

  async function execute(job: Job) {
    const jobLog = log.child({ jobId: job.id, type: job.type, attempt: job.attempts })
    const handler = handlers[job.type]
    try {
      if (!handler) throw new PermanentJobError(`No handler registered for "${job.type}"`)
      jobLog.info('job started')
      const result = await handler(job, ctx)
      await db.jobs.complete({ id: job.id, workerId, result })
      jobLog.info('job completed')
    } catch (error) {
      if (error instanceof JobInterruptedError) {
        await db.jobs
          .release({ id: job.id, workerId })
          .catch((e) => jobLog.error({ err: e }, 'could not release job'))
        jobLog.info('job handed back to the queue')
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      const permanent = error instanceof PermanentJobError
      const retry = !permanent && job.attempts < job.maxAttempts
      const retryAt = retry
        ? new Date(Date.now() + retryDelayMs(job.attempts, options.retryBaseMs))
        : undefined
      await db.jobs
        .fail({ id: job.id, workerId, error: message, retryAt })
        .catch((e) => jobLog.error({ err: e }, 'could not record job failure'))
      jobLog[retry ? 'warn' : 'error'](
        { err: error, retryAt },
        retry ? 'job failed, will retry' : 'job failed permanently',
      )
    }
  }

  /** Claims as many jobs as there are free slots and starts them. Returns how many started. */
  async function tick(): Promise<number> {
    if (Date.now() - lastStaleCheck >= staleCheckIntervalMs) {
      lastStaleCheck = Date.now()
      await recoverStale()
    }
    if (Date.now() - lastRenewal >= renewIntervalMs) {
      lastRenewal = Date.now()
      await renewLocks()
    }
    const free = concurrency - inFlight.size
    if (free <= 0) return 0
    const jobs = await db.jobs.claim({
      workerId,
      limit: free,
      types: options.types,
      excludeTypes: options.excludeTypes,
    })
    for (const job of jobs) {
      const p: Promise<void> = execute(job).finally(() => {
        inFlight.delete(job.id)
        wake?.()
      })
      inFlight.set(job.id, p)
    }
    return jobs.length
  }

  const sleep = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(done, pollIntervalMs)
      function done() {
        clearTimeout(timer)
        wake = undefined
        resolve()
      }
      wake = done
    })

  async function loop() {
    while (running) {
      try {
        const started = await tick()
        // Nothing new, or all slots busy: wait for the next poll or for a job to finish.
        if (started === 0 || inFlight.size >= concurrency) await sleep()
      } catch (error) {
        log.error({ err: error }, 'job polling failed')
        await sleep()
      }
    }
  }

  let loopPromise: Promise<void> | undefined

  return {
    tick,
    /** Resolves when every job started so far has finished. */
    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight.values()])
    },
    start() {
      if (running) return
      running = true
      loopPromise = loop()
      log.info({ workerId, concurrency, pollIntervalMs }, 'worker started')
    },
    /** Stops claiming, aborts in-flight handlers' signal after `graceMs`, and waits for them. */
    async stop(graceMs = 25_000) {
      running = false
      wake?.()
      await loopPromise
      // Nothing renews the locks from here on, so keep doing it for as long as jobs are finishing.
      const renewal = setInterval(() => void renewLocks().catch(() => {}), renewIntervalMs)
      const timer = setTimeout(() => abort.abort(), graceMs)
      await this.idle()
      clearTimeout(timer)
      clearInterval(renewal)
      log.info('worker stopped')
    },
  }
}

export type Runner = ReturnType<typeof createRunner>
