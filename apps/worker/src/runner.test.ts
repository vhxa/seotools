import { createLogger, retryDelayMs, type Job } from '@seotools/core'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRunner } from './runner'
import { JobInterruptedError, PermanentJobError, type JobHandler } from './types'
import { exampleEcho } from './handlers/example-echo'
import { mailSend } from './handlers/mail-send'

const log = createLogger('test', 'silent')

let db: Database
beforeEach(async () => {
  db = await createTestDatabase()
})
afterEach(async () => {
  await db.close()
})

function runnerWith(handlers: Record<string, JobHandler>, overrides = {}) {
  return createRunner({
    db,
    handlers,
    workerId: 'test-worker',
    log,
    getMailer: async () => null,
    concurrency: 2,
    pollIntervalMs: 20,
    lockTimeoutMs: 60_000,
    retryBaseMs: 0,
    ...overrides,
  })
}

describe('runner', () => {
  it('runs a job and stores its result', async () => {
    const runner = runnerWith({ ok: async (job: Job) => ({ got: job.payload }) })
    const job = await db.jobs.enqueue({ type: 'ok', payload: { n: 1 } })

    expect(await runner.tick()).toBe(1)
    await runner.idle()

    expect(await db.jobs.get(job.id)).toMatchObject({
      status: 'completed',
      result: { got: { n: 1 } },
      attempts: 1,
    })
  })

  it('retries failures and gives up after maxAttempts', async () => {
    let calls = 0
    const runner = runnerWith({
      flaky: async () => {
        calls++
        throw new Error(`boom ${calls}`)
      },
    })
    const job = await db.jobs.enqueue({ type: 'flaky', maxAttempts: 3 })

    for (let i = 0; i < 5; i++) {
      await runner.tick()
      await runner.idle()
      await new Promise((r) => setTimeout(r, 5)) // retryBaseMs=0 → due immediately
    }

    expect(calls).toBe(3)
    expect(await db.jobs.get(job.id)).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastError: 'boom 3',
    })
  })

  it('does not retry permanent errors or unknown job types', async () => {
    const runner = runnerWith({
      bad: async () => {
        throw new PermanentJobError('nope')
      },
    })
    const bad = await db.jobs.enqueue({ type: 'bad' })
    const unknown = await db.jobs.enqueue({ type: 'does.not.exist' })

    await runner.tick()
    await runner.idle()

    expect(await db.jobs.get(bad.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'nope',
    })
    expect((await db.jobs.get(unknown.id))?.lastError).toMatch(/No handler registered/)
    expect((await db.jobs.get(unknown.id))?.status).toBe('failed')
  })

  it('never runs more jobs at once than its concurrency', async () => {
    let active = 0
    let peak = 0
    const runner = runnerWith(
      {
        slow: async () => {
          peak = Math.max(peak, ++active)
          await new Promise((r) => setTimeout(r, 30))
          active--
        },
      },
      { concurrency: 2 },
    )
    for (let i = 0; i < 5; i++) await db.jobs.enqueue({ type: 'slow' })

    runner.start()
    await vi.waitFor(async () => expect((await db.jobs.countByStatus()).completed).toBe(5), {
      timeout: 5000,
    })
    await runner.stop()

    expect(peak).toBe(2)
  })

  it('recovers jobs orphaned by a dead worker', async () => {
    const runner = runnerWith({ ok: async () => 'done' }, { lockTimeoutMs: 1000 })
    const job = await db.jobs.enqueue({ type: 'ok', runAt: new Date(Date.now() - 60_000) })
    await db.jobs.claim({ workerId: 'dead-worker', limit: 1, now: new Date(Date.now() - 30_000) })

    await runner.tick() // first tick runs the stale check, then claims the recovered job
    await runner.idle()

    expect(await db.jobs.get(job.id)).toMatchObject({ status: 'completed', attempts: 2 })
  })

  it('keeps renewing the lock of a job that takes longer than the lock timeout', async () => {
    const lockTimeoutMs = 90
    const runner = runnerWith(
      {
        slow: async () => {
          await new Promise((r) => setTimeout(r, lockTimeoutMs * 4))
          return 'done'
        },
      },
      { lockTimeoutMs, staleCheckIntervalMs: 10, pollIntervalMs: 5 },
    )
    const job = await db.jobs.enqueue({ type: 'slow' })

    runner.start()
    await vi.waitFor(async () => expect((await db.jobs.get(job.id))?.status).toBe('completed'), {
      timeout: 5000,
    })
    await runner.stop()

    // A stolen job would have gone through a second attempt.
    expect((await db.jobs.get(job.id))?.attempts).toBe(1)
  })

  it('only claims the job types of its lane', async () => {
    const crawl = await db.jobs.enqueue({ type: 'crawl' })
    const mail = await db.jobs.enqueue({ type: 'mail' })
    const ok = { crawl: async () => 'c', mail: async () => 'm' }

    const crawlLane = runnerWith(ok, { types: ['crawl'] })
    await crawlLane.tick()
    await crawlLane.idle()
    expect((await db.jobs.get(crawl.id))?.status).toBe('completed')
    expect((await db.jobs.get(mail.id))?.status).toBe('pending')

    const crawl2 = await db.jobs.enqueue({ type: 'crawl' })
    const otherLane = runnerWith(ok, { excludeTypes: ['crawl'] })
    await otherLane.tick()
    await otherLane.idle()
    expect((await db.jobs.get(mail.id))?.status).toBe('completed')
    expect((await db.jobs.get(crawl2.id))?.status).toBe('pending')
  })

  it('hands back an interrupted job without spending an attempt', async () => {
    const runner = runnerWith({
      long: async () => {
        throw new JobInterruptedError()
      },
    })
    const job = await db.jobs.enqueue({ type: 'long', maxAttempts: 1 })

    await runner.tick()
    await runner.idle()

    expect(await db.jobs.get(job.id)).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastError: null,
    })
  })

  it('stop() waits for in-flight jobs', async () => {
    let finished = false
    const runner = runnerWith({
      slow: async () => {
        await new Promise((r) => setTimeout(r, 50))
        finished = true
      },
    })
    await db.jobs.enqueue({ type: 'slow' })
    runner.start()
    await vi.waitFor(async () => expect((await db.jobs.countByStatus()).running).toBe(1))

    await runner.stop()

    expect(finished).toBe(true)
  })
})

describe('retryDelayMs', () => {
  it('backs off exponentially up to a cap', () => {
    expect([1, 2, 3, 4].map((n) => retryDelayMs(n))).toEqual([5000, 10_000, 20_000, 40_000])
    expect(retryDelayMs(30)).toBe(15 * 60_000)
  })
})

describe('handlers', () => {
  const ctx = (overrides = {}) => ({
    log,
    signal: new AbortController().signal,
    getMailer: async () => null,
    ...overrides,
  })
  const jobOf = (type: string, payload: unknown) =>
    ({ id: '1', type, payload, attempts: 1, maxAttempts: 3 }) as Job

  it('example.echo echoes the message', async () => {
    const result = await exampleEcho(jobOf('example.echo', { message: 'hi', delayMs: 0 }), ctx())
    expect(result).toMatchObject({ echoed: 'hi' })
  })

  it('example.echo rejects invalid payloads permanently', async () => {
    await expect(exampleEcho(jobOf('example.echo', { delayMs: -5 }), ctx())).rejects.toBeInstanceOf(
      PermanentJobError,
    )
  })

  it('example.echo aborts on shutdown', async () => {
    const controller = new AbortController()
    const promise = exampleEcho(
      jobOf('example.echo', { message: 'x', delayMs: 60_000 }),
      ctx({ signal: controller.signal }),
    )
    controller.abort()
    await expect(promise).rejects.toThrow(/shutting down/)
  })

  it('mail.send sends through the configured mailer', async () => {
    const send = vi.fn(async () => ({ id: 'msg-1' }))
    const result = await mailSend(
      jobOf('mail.send', { to: 'a@b.co', subject: 'Hi', text: 'hello' }),
      ctx({ getMailer: async () => ({ send, verify: async () => {} }) }),
    )
    expect(send).toHaveBeenCalledWith({ to: 'a@b.co', subject: 'Hi', text: 'hello' })
    expect(result).toEqual({ messageId: 'msg-1' })
  })

  it('mail.send fails (retryably) when no provider is configured', async () => {
    const promise = mailSend(
      jobOf('mail.send', { to: 'a@b.co', subject: 'Hi', text: 'hello' }),
      ctx(),
    )
    await expect(promise).rejects.toThrow(/No email provider/)
    await expect(promise).rejects.not.toBeInstanceOf(PermanentJobError)
  })
})
