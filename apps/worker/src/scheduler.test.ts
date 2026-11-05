import { createLogger, type CrawlRecurrence } from '@seotools/core'
import { createCompany, DomainArchivedError } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runDueSchedules } from './scheduler'

const log = createLogger('test', 'silent')
const recurrence: CrawlRecurrence = {
  frequency: 'daily',
  hour: 4,
  minute: 0,
  dayOfWeek: 0,
  dayOfMonth: 1,
  timeZone: 'UTC',
}
const now = new Date('2026-06-15T10:00:00Z')
const past = new Date('2026-06-15T04:00:00Z')

let db: Database
let domainId: string

beforeEach(async () => {
  db = await createTestDatabase()
  const created = await createCompany(db, { name: 'Acme', domain: 'example.com' })
  if (!created.ok) throw new Error('setup failed')
  domainId = created.domain.id
})
afterEach(async () => {
  await db.close()
})

const schedule = (type: 'full' | 'priority', overrides = {}) =>
  db.crawlSchedules.save({
    ...recurrence,
    domainId,
    type,
    enabled: true,
    nextRunAt: past,
    ...overrides,
  })
const saved = async (type: 'full' | 'priority') =>
  (await db.crawlSchedules.list(domainId)).find((s) => s.type === type)

describe('runDueSchedules', () => {
  it('starts a due crawl and moves the schedule to its next run', async () => {
    await schedule('full')
    await runDueSchedules(db, log, now)

    expect(await db.crawls.list(domainId)).toMatchObject([
      { type: 'full', trigger: 'schedule', status: 'pending' },
    ])
    expect(await saved('full')).toMatchObject({
      lastOutcome: 'started',
      lastRunAt: now,
      nextRunAt: new Date('2026-06-16T04:00:00Z'),
    })
  })

  it('leaves alone what is disabled or not due', async () => {
    await schedule('full', { enabled: false })
    await schedule('priority', { nextRunAt: new Date('2026-06-16T04:00:00Z') })
    await runDueSchedules(db, log, now)
    expect(await db.crawls.list(domainId)).toEqual([])
  })

  it('skips a run while the domain has an active crawl, and tries again next time', async () => {
    await db.crawls.start({ domainId, type: 'priority', trigger: 'manual' })
    await schedule('full')
    await runDueSchedules(db, log, now)

    expect(await db.crawls.list(domainId)).toHaveLength(1)
    expect(await saved('full')).toMatchObject({
      lastOutcome: 'skipped-active',
      nextRunAt: new Date('2026-06-16T04:00:00Z'),
    })
  })

  it('skips a priority run with nothing marked', async () => {
    await schedule('priority')
    await runDueSchedules(db, log, now)
    expect(await db.crawls.list(domainId)).toEqual([])
    expect((await saved('priority'))?.lastOutcome).toBe('skipped-empty')

    await db.priorityUrls.add({ domainId, url: 'https://example.com/a' })
    await schedule('priority')
    await runDueSchedules(db, log, now)
    expect(await db.crawls.list(domainId)).toMatchObject([{ type: 'priority' }])
  })

  it('catches up with one run after being down, not every run it missed', async () => {
    await schedule('full', { nextRunAt: new Date('2026-06-01T04:00:00Z') })
    await runDueSchedules(db, log, now)
    await runDueSchedules(db, log, now)
    expect(await db.crawls.list(domainId)).toHaveLength(1)
    expect((await saved('full'))?.nextRunAt).toEqual(new Date('2026-06-16T04:00:00Z'))
  })

  it('fires once with several workers ticking at the same time', async () => {
    await schedule('full')
    await Promise.all([1, 2, 3].map(() => runDueSchedules(db, log, now)))
    expect(await db.crawls.list(domainId)).toHaveLength(1)
  })

  it('frees domains whose crawl job gave up', async () => {
    const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    await db.jobs.claim({ workerId: 'w', limit: 1 })
    await db.jobs.fail({ id: crawl!.jobId, workerId: 'w', error: 'out of attempts' })

    await runDueSchedules(db, log, now)

    expect(await db.crawls.active(domainId)).toBeNull()
    expect(await db.crawls.get(crawl!.id)).toMatchObject({
      status: 'failed',
      error: 'out of attempts',
    })
  })

  it('frees domains whose recheck job gave up, and leaves their crawls alone', async () => {
    const recheck = await db.verifications.start({
      domainId,
      baseCrawlId: 'a-crawl',
      urls: [{ url: 'https://example.com/a', urlHash: 'a'.repeat(32), source: 'link' }],
    })
    const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    await db.jobs.claim({ workerId: 'w', limit: 1 })
    await db.jobs.fail({ id: recheck!.jobId, workerId: 'w', error: 'out of attempts' })

    await runDueSchedules(db, log, now)

    expect(await db.verifications.active(domainId)).toBeNull()
    expect(await db.verifications.get(recheck!.id)).toMatchObject({
      status: 'failed',
      error: 'out of attempts',
    })
    // The crawl's job is still waiting, so its crawl is still active.
    expect((await db.crawls.active(domainId))?.id).toBe(crawl!.id)
  })

  it('does not start the crawls of an archived domain, and picks them up again once restored', async () => {
    await schedule('full')
    await db.domains.archive(domainId)
    await runDueSchedules(db, log, now)

    expect(await db.crawls.list(domainId)).toEqual([])
    // Not even looked at: it is as it was, and there is no record of a run that did not happen.
    expect(await saved('full')).toMatchObject({ lastOutcome: null, nextRunAt: past })

    await db.domains.unarchive(domainId)
    // Restoring moves it to the next run rather than starting what was missed.
    await runDueSchedules(db, log, now)
    expect(await db.crawls.list(domainId)).toEqual([])
    expect((await saved('full'))?.nextRunAt.getTime()).toBeGreaterThan(now.getTime())
  })

  it('does not fail when the domain is archived between choosing a schedule and firing it', async () => {
    await schedule('full')
    await db.domains.archive(domainId)
    const stale = {
      ...db,
      crawlSchedules: {
        ...db.crawlSchedules,
        due: async () => db.crawlSchedules.list(domainId),
      },
    }
    await expect(runDueSchedules(stale, log, now)).resolves.toBeUndefined()
    expect(await db.crawls.list(domainId)).toEqual([])
    await expect(
      db.crawls.start({ domainId, type: 'full', trigger: 'schedule' }),
    ).rejects.toBeInstanceOf(DomainArchivedError)
  })

  it('still frees the crawls of an archived domain whose job gave up', async () => {
    const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    await db.jobs.claim({ workerId: 'w', limit: 1 })
    await db.jobs.fail({ id: crawl!.jobId, workerId: 'w', error: 'out of attempts' })
    await db.domains.archive(domainId)
    await runDueSchedules(db, log, now)
    expect(await db.crawls.active(domainId)).toBeNull()
  })
})
