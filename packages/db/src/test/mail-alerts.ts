import { JOB_TYPES } from '@seotools/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../types'
import { createCompany } from '../workspace'

const HOUR = 60 * 60_000

/** The record of sent email, the alerts people asked for, and the job a full crawl's end queues. */
export function describeMailAndAlerts(getDb: () => Database) {
  describe('email deliveries and alerts', () => {
    let db: Database
    beforeEach(() => {
      db = getDb()
    })

    const site = async (host = 'acme.com') => {
      const created = await createCompany(db, { name: host, domain: host })
      if (!created.ok) throw new Error('setup failed')
      return created.domain
    }
    const person = (email: string) => db.users.create({ email, name: email, role: 'member' })
    const alertJobs = async () =>
      (await db.jobs.list({ limit: 100 })).filter((job) => job.type === JOB_TYPES.crawlAlerts)

    describe('deliveries', () => {
      it('records attempts, newest first, and filters them', async () => {
        await db.mail.record({ kind: 'invite', recipient: 'a@acme.com', status: 'sent' })
        await db.mail.record({
          kind: 'alert',
          recipient: 'b@acme.com',
          status: 'failed',
          error: 'connection refused',
        })
        await db.mail.record({ kind: 'reset', recipient: 'c@acme.com', status: 'unconfigured' })

        const all = await db.mail.recent({ limit: 10 })
        expect(all.map((d) => d.recipient)).toEqual(['c@acme.com', 'b@acme.com', 'a@acme.com'])
        expect(all[1]).toMatchObject({
          kind: 'alert',
          status: 'failed',
          error: 'connection refused',
        })
        expect(all[2]?.error).toBeNull()
        expect((await db.mail.recent({ limit: 10, outcome: 'sent' })).map((d) => d.kind)).toEqual([
          'invite',
        ])
        expect(
          (await db.mail.recent({ limit: 10, outcome: 'problems' })).map((d) => d.status),
        ).toEqual(['unconfigured', 'failed'])
        expect(await db.mail.recent({ limit: 1 })).toHaveLength(1)
      })

      it('bounds the error text and strips what a database refuses', async () => {
        await db.mail.record({
          kind: 'test',
          recipient: 'a@acme.com',
          status: 'failed',
          error: `bad\u0000 ${'x'.repeat(5000)}`,
        })
        const [row] = await db.mail.recent({ limit: 1 })
        expect(row?.error?.length).toBeLessThanOrEqual(500)
        expect(row?.error).not.toContain('\u0000')
      })

      it('prunes what is old and what is beyond the newest few', async () => {
        for (let i = 0; i < 6; i++) {
          await db.mail.record({ kind: 'alert', recipient: `r${i}@acme.com`, status: 'sent' })
        }
        expect(await db.mail.prune({ before: new Date(Date.now() - HOUR), keep: 100 })).toBe(0)
        expect(await db.mail.prune({ before: new Date(Date.now() - HOUR), keep: 4 })).toBe(2)
        expect((await db.mail.recent({ limit: 10 })).map((d) => d.recipient)).toEqual([
          'r5@acme.com',
          'r4@acme.com',
          'r3@acme.com',
          'r2@acme.com',
        ])
        expect(await db.mail.prune({ before: new Date(Date.now() + HOUR), keep: 100 })).toBe(4)
        expect(await db.mail.recent({ limit: 10 })).toEqual([])
      })
    })

    describe('subscriptions', () => {
      it('keep what a person asked for per domain, and nothing for what they did not', async () => {
        const a = await site('acme.com')
        const b = await site('other.com')
        const ana = await person('ana@acme.com')
        expect(await db.alerts.forUser(ana.id)).toEqual([])

        await db.alerts.save({
          userId: ana.id,
          locale: 'es',
          domains: [
            { domainId: a.id, kinds: ['change-summary', 'crawl-problem', 'crawl-problem'] },
            { domainId: b.id, kinds: ['important-findings'] },
          ],
        })
        const own = await db.alerts.forUser(ana.id)
        expect(own).toHaveLength(2)
        expect(own.find((s) => s.domainId === a.id)).toMatchObject({
          kinds: ['crawl-problem', 'change-summary'],
          locale: 'es',
        })
        expect((await db.alerts.forDomain(a.id)).map((s) => s.userId)).toEqual([ana.id])

        // Choosing nothing removes it; other domains and other people are left alone.
        const bea = await person('bea@acme.com')
        await db.alerts.save({
          userId: bea.id,
          locale: 'en',
          domains: [{ domainId: a.id, kinds: ['crawl-problem'] }],
        })
        await db.alerts.save({
          userId: ana.id,
          locale: 'en',
          domains: [{ domainId: a.id, kinds: [] }],
        })
        expect((await db.alerts.forDomain(a.id)).map((s) => s.userId)).toEqual([bea.id])
        // The language follows the person: their other subscription takes the new one.
        expect(await db.alerts.forUser(ana.id)).toMatchObject([
          { domainId: b.id, kinds: ['important-findings'], locale: 'en' },
        ])
        // Saving again with a kind only changes that.
        await db.alerts.save({
          userId: ana.id,
          locale: 'en',
          domains: [{ domainId: b.id, kinds: ['change-summary'] }],
        })
        expect((await db.alerts.forUser(ana.id))[0]?.kinds).toEqual(['change-summary'])
      })

      it('go with the person and with the domain', async () => {
        const a = await site('acme.com')
        const b = await site('other.com')
        const ana = await person('ana@acme.com')
        await db.alerts.save({
          userId: ana.id,
          locale: 'en',
          domains: [
            { domainId: a.id, kinds: ['crawl-problem'] },
            { domainId: b.id, kinds: ['crawl-problem'] },
          ],
        })
        await db.domains.delete(a.id)
        expect((await db.alerts.forUser(ana.id)).map((s) => s.domainId)).toEqual([b.id])
      })
    })

    describe('notices', () => {
      const crawlOf = async (domainId: string) => {
        const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
        if (!crawl) throw new Error('crawl did not start')
        return crawl
      }

      it('are taken once per person, crawl and kind, however often they are asked for', async () => {
        const a = await site()
        const crawl = await crawlOf(a.id)
        const ana = await person('ana@acme.com')
        const bea = await person('bea@acme.com')
        const ids = { crawlId: crawl.id, userId: ana.id }

        expect(
          await db.alerts.claim({ ...ids, kinds: ['change-summary', 'crawl-problem'] }),
        ).toEqual(['crawl-problem', 'change-summary'])
        expect(
          await db.alerts.claim({ ...ids, kinds: ['crawl-problem', 'important-findings'] }),
        ).toEqual(['important-findings'])
        expect(await db.alerts.claim({ ...ids, kinds: ['crawl-problem'] })).toEqual([])
        // Another person, and another crawl, are separate.
        expect(
          await db.alerts.claim({ crawlId: crawl.id, userId: bea.id, kinds: ['crawl-problem'] }),
        ).toEqual(['crawl-problem'])

        // Two attempts at once: exactly one gets it.
        const second = await db.crawls.start({ domainId: a.id, type: 'full', trigger: 'manual' })
        expect(second).toBeNull() // the first crawl is still active
        await db.crawls.finish(crawl.id, { status: 'completed' })
        const next = await crawlOf(a.id)
        const raced = await Promise.all([
          db.alerts.claim({ crawlId: next.id, userId: ana.id, kinds: ['change-summary'] }),
          db.alerts.claim({ crawlId: next.id, userId: ana.id, kinds: ['change-summary'] }),
          db.alerts.claim({ crawlId: next.id, userId: ana.id, kinds: ['change-summary'] }),
        ])
        expect(raced.flat()).toEqual(['change-summary'])
      })

      it('can be given back when sending failed, and only those', async () => {
        const a = await site()
        const crawl = await crawlOf(a.id)
        const ana = await person('ana@acme.com')
        const ids = { crawlId: crawl.id, userId: ana.id }
        await db.alerts.claim({ ...ids, kinds: ['crawl-problem', 'change-summary'] })
        await db.alerts.release({ ...ids, kinds: ['change-summary'] })
        expect(
          await db.alerts.claim({ ...ids, kinds: ['crawl-problem', 'change-summary'] }),
        ).toEqual(['change-summary'])
      })
    })

    describe('the end of a crawl', () => {
      it('queues one alerts job for a full crawl that ends, however it ends', async () => {
        const a = await site()
        for (const status of ['completed', 'incomplete', 'failed'] as const) {
          const crawl = await db.crawls.start({ domainId: a.id, type: 'full', trigger: 'manual' })
          expect(await db.crawls.finish(crawl!.id, { status, error: 'x' })).toBe(true)
          // Ending it again changes nothing and queues nothing more.
          expect(await db.crawls.finish(crawl!.id, { status })).toBe(false)
          const jobs = (await alertJobs()).filter(
            (job) => (job.payload as { crawlId: string }).crawlId === crawl!.id,
          )
          expect(jobs, status).toHaveLength(1)
          expect(jobs[0]).toMatchObject({ status: 'pending', maxAttempts: 3 })
        }
        expect(await alertJobs()).toHaveLength(3)
      })

      it('queues nothing for a priority crawl, a cancelled crawl or a crawl that never ended', async () => {
        const a = await site()
        const priority = await db.crawls.start({
          domainId: a.id,
          type: 'priority',
          trigger: 'manual',
        })
        await db.crawls.finish(priority!.id, { status: 'completed' })
        const cancelled = await db.crawls.start({ domainId: a.id, type: 'full', trigger: 'manual' })
        await db.crawls.cancel(cancelled!.id)
        await db.crawls.start({ domainId: a.id, type: 'full', trigger: 'manual' })
        expect(await alertJobs()).toEqual([])
      })

      it('queues one for a crawl failed because its job gave up', async () => {
        const a = await site()
        const crawl = await db.crawls.start({ domainId: a.id, type: 'full', trigger: 'manual' })
        const [job] = await db.jobs.claim({ workerId: 'w', limit: 1 })
        await db.jobs.fail({ id: job!.id, workerId: 'w', error: 'boom' })
        expect(await db.crawls.failOrphaned()).toBe(1)
        expect(await alertJobs()).toHaveLength(1)
        expect((await db.crawls.get(crawl!.id))?.status).toBe('failed')
      })
    })
  })
}
