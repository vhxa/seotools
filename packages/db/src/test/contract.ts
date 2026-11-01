import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFirstAdmin, needsSetup } from '../admin'
import type { Database } from '../types'
import { addDomain, createCompany } from '../workspace'

const minutes = (n: number) => n * 60_000

/**
 * Behaviour every dialect must provide. `reset` must leave all tables empty.
 * SQLite runs it always; Postgres/MySQL run it when TEST_POSTGRES_URL / TEST_MYSQL_URL are set.
 */
export function describeDatabaseContract(
  name: string,
  setup: () => Promise<{ db: Database; reset: () => Promise<void> }>,
  options: { skip?: boolean } = {},
) {
  describe.skipIf(options.skip)(`database contract: ${name}`, () => {
    let db: Database
    let reset: () => Promise<void>

    beforeAll(async () => {
      ;({ db, reset } = await setup())
    })
    afterAll(async () => {
      await db?.close()
    })
    beforeEach(async () => {
      await reset()
    })

    it('answers ping', async () => {
      await expect(db.ping()).resolves.toBeUndefined()
    })

    describe('jobs', () => {
      it('round-trips payloads', async () => {
        const job = await db.jobs.enqueue({ type: 't', payload: { a: 1, nested: { b: [1, 2] } } })
        expect(job).toMatchObject({ type: 't', status: 'pending', attempts: 0, maxAttempts: 3 })
        expect((await db.jobs.get(job.id))?.payload).toEqual({ a: 1, nested: { b: [1, 2] } })
        expect(await db.jobs.get('missing')).toBeNull()
      })

      it('claims only due jobs, oldest first, up to the limit', async () => {
        const now = new Date()
        const first = await db.jobs.enqueue({ type: 't', runAt: new Date(now.getTime() - 2000) })
        const second = await db.jobs.enqueue({ type: 't', runAt: new Date(now.getTime() - 1000) })
        await db.jobs.enqueue({ type: 't', runAt: new Date(now.getTime() + minutes(10)) })

        const claimed = await db.jobs.claim({ workerId: 'w1', limit: 1, now })
        expect(claimed.map((j) => j.id)).toEqual([first.id])
        expect(claimed[0]).toMatchObject({ status: 'running', attempts: 1, lockedBy: 'w1' })

        const rest = await db.jobs.claim({ workerId: 'w1', limit: 10, now })
        expect(rest.map((j) => j.id)).toEqual([second.id])
        expect(await db.jobs.claim({ workerId: 'w1', limit: 10, now })).toEqual([])
      })

      it('never hands the same job to two concurrent workers', async () => {
        for (let i = 0; i < 12; i++) await db.jobs.enqueue({ type: 't', payload: { i } })
        const batches = await Promise.all(
          ['a', 'b', 'c'].map((workerId) => db.jobs.claim({ workerId, limit: 6 })),
        )
        const ids = batches.flat().map((j) => j.id)
        expect(ids).toHaveLength(12)
        expect(new Set(ids).size).toBe(12)
      })

      it('completes with a result, only for the lock owner', async () => {
        const job = await db.jobs.enqueue({ type: 't' })
        await db.jobs.claim({ workerId: 'w1', limit: 1 })

        await db.jobs.complete({ id: job.id, workerId: 'intruder', result: { no: true } })
        expect((await db.jobs.get(job.id))?.status).toBe('running')

        await db.jobs.complete({ id: job.id, workerId: 'w1', result: { ok: true } })
        expect(await db.jobs.get(job.id)).toMatchObject({
          status: 'completed',
          result: { ok: true },
          lockedBy: null,
        })
      })

      it('retries with fail(retryAt) and gives up with fail()', async () => {
        const job = await db.jobs.enqueue({ type: 't' })
        await db.jobs.claim({ workerId: 'w1', limit: 1 })
        const retryAt = new Date(Date.now() + minutes(1))
        await db.jobs.fail({ id: job.id, workerId: 'w1', error: 'boom', retryAt })

        const retried = await db.jobs.get(job.id)
        expect(retried).toMatchObject({ status: 'pending', lastError: 'boom', attempts: 1 })
        expect(Math.abs(retried!.runAt.getTime() - retryAt.getTime())).toBeLessThan(1000)
        expect(await db.jobs.claim({ workerId: 'w1', limit: 1 })).toEqual([])

        await db.jobs.claim({ workerId: 'w1', limit: 1, now: new Date(retryAt.getTime() + 1) })
        await db.jobs.fail({ id: job.id, workerId: 'w1', error: 'final' })
        expect(await db.jobs.get(job.id)).toMatchObject({ status: 'failed', lastError: 'final' })
      })

      it('recovers jobs abandoned by a dead worker', async () => {
        const longAgo = new Date(Date.now() - minutes(30))
        const due = new Date(longAgo.getTime() - 1000)
        const recoverable = await db.jobs.enqueue({ type: 't', maxAttempts: 3, runAt: due })
        const exhausted = await db.jobs.enqueue({ type: 't', maxAttempts: 1, runAt: due })
        const fresh = await db.jobs.enqueue({ type: 't', maxAttempts: 3 })
        await db.jobs.claim({ workerId: 'dead', limit: 2, now: longAgo })
        await db.jobs.claim({ workerId: 'alive', limit: 1 })

        const count = await db.jobs.requeueStale({
          lockedBefore: new Date(Date.now() - minutes(5)),
        })
        expect(count).toBe(2)
        expect((await db.jobs.get(recoverable.id))?.status).toBe('pending')
        expect((await db.jobs.get(exhausted.id))?.status).toBe('failed')
        expect((await db.jobs.get(fresh.id))?.status).toBe('running')
      })

      it('lists newest first and counts by status', async () => {
        const a = await db.jobs.enqueue({ type: 't' })
        await new Promise((r) => setTimeout(r, 5))
        const b = await db.jobs.enqueue({ type: 't' })
        await db.jobs.claim({ workerId: 'w', limit: 1 })

        expect((await db.jobs.list()).map((j) => j.id)).toEqual([b.id, a.id])
        expect(await db.jobs.list({ status: 'running' })).toHaveLength(1)
        expect(await db.jobs.countByStatus()).toEqual({
          pending: 1,
          running: 1,
          completed: 0,
          failed: 0,
        })
      })
    })

    describe('heartbeats', () => {
      it('upserts and reports the most recent worker', async () => {
        expect(await db.heartbeats.latest()).toBeNull()
        const startedAt = new Date(Date.now() - minutes(1))
        await db.heartbeats.beat({ workerId: 'w1', startedAt, now: new Date(Date.now() - 5000) })
        await db.heartbeats.beat({ workerId: 'w1', startedAt })
        await db.heartbeats.beat({ workerId: 'w2', startedAt, now: new Date(Date.now() - 60_000) })

        const latest = await db.heartbeats.latest()
        expect(latest?.workerId).toBe('w1')
        expect(Date.now() - latest!.lastSeenAt.getTime()).toBeLessThan(2000)
      })
    })

    describe('settings', () => {
      it('upserts, reads and deletes', async () => {
        expect(await db.settings.get('k')).toBeNull()
        await db.settings.set('k', 'v1', false)
        await db.settings.set('k', 'v2', true)
        expect(await db.settings.get('k')).toEqual({ value: 'v2', encrypted: true })
        await db.settings.delete('k')
        expect(await db.settings.get('k')).toBeNull()
      })
    })

    describe('companies and domains', () => {
      it('creates a company with its first domain, normalized', async () => {
        const result = await createCompany(db, {
          name: '  Acme   Corp ',
          domain: 'https://www.Acme.COM/blog',
        })
        expect(result).toMatchObject({
          ok: true,
          company: { name: 'Acme Corp' },
          domain: { host: 'acme.com' },
        })
        if (!result.ok) return

        expect(result.domain.companyId).toBe(result.company.id)
        expect(await db.companies.get(result.company.id)).toMatchObject({ name: 'Acme Corp' })
        expect(await db.companies.get('missing')).toBeNull()
        expect(await db.domains.findByHost('acme.com')).toMatchObject({
          id: result.domain.id,
          company: { id: result.company.id, name: 'Acme Corp' },
        })
        expect(await db.domains.findByHost('www.acme.com')).toBeNull()
      })

      it('rejects invalid input without writing anything', async () => {
        expect(await createCompany(db, { name: '   ', domain: 'acme.com' })).toEqual({
          ok: false,
          reason: 'invalid-name',
        })
        expect(await createCompany(db, { name: 'x'.repeat(101), domain: 'acme.com' })).toEqual({
          ok: false,
          reason: 'invalid-name',
        })
        expect(await createCompany(db, { name: 'Acme', domain: 'not a domain' })).toEqual({
          ok: false,
          reason: 'invalid-domain',
        })
        expect(await db.companies.list()).toEqual([])
      })

      it('lists companies by name with their domains by host', async () => {
        const zeta = await createCompany(db, { name: 'Zeta', domain: 'zeta.io' })
        const acme = await createCompany(db, { name: 'acme', domain: 'shop.acme.com' })
        if (!zeta.ok || !acme.ok) throw new Error('setup failed')
        await addDomain(db, { companyId: acme.company.id, domain: 'acme.com' })
        await addDomain(db, { companyId: acme.company.id, domain: 'blog.acme.com' })

        const list = await db.companies.list()
        expect(list.map((c) => c.name)).toEqual(['acme', 'Zeta'])
        expect(list[0]!.domains.map((d) => d.host)).toEqual([
          'acme.com',
          'blog.acme.com',
          'shop.acme.com',
        ])
        expect(list[1]!.domains.map((d) => d.host)).toEqual(['zeta.io'])
      })

      it('keeps a domain unique across all companies, leaving no half-created company', async () => {
        const first = await createCompany(db, { name: 'Acme', domain: 'acme.com' })
        if (!first.ok) throw new Error('setup failed')
        const other = await createCompany(db, { name: 'Other', domain: 'other.com' })
        if (!other.ok) throw new Error('setup failed')

        // Same host, typed differently: still taken.
        expect(await createCompany(db, { name: 'Rival', domain: 'https://WWW.acme.com' })).toEqual({
          ok: false,
          reason: 'domain-taken',
        })
        expect(await addDomain(db, { companyId: other.company.id, domain: 'acme.com' })).toEqual({
          ok: false,
          reason: 'domain-taken',
        })
        expect((await db.companies.list()).map((c) => c.name)).toEqual(['Acme', 'Other'])
      })

      it('rolls back the company when its domain cannot be stored', async () => {
        const first = await createCompany(db, { name: 'Acme', domain: 'acme.com' })
        if (!first.ok) throw new Error('setup failed')

        // Bypass the policy check: the database itself must refuse and undo the company insert.
        await expect(db.companies.create({ name: 'Rival', host: 'acme.com' })).rejects.toThrow()
        expect((await db.companies.list()).map((c) => c.name)).toEqual(['Acme'])
      })

      it('rejects adding a domain to a company that does not exist', async () => {
        expect(await addDomain(db, { companyId: 'missing', domain: 'acme.com' })).toEqual({
          ok: false,
          reason: 'company-not-found',
        })
        expect(await addDomain(db, { companyId: 'missing', domain: '???' })).toEqual({
          ok: false,
          reason: 'invalid-domain',
        })
      })

      it('lets exactly one of several concurrent registrations of a domain win', async () => {
        const results = await Promise.all(
          ['a', 'b', 'c', 'd'].map((n) =>
            createCompany(db, { name: `Company ${n}`, domain: 'race.com' }),
          ),
        )
        expect(results.filter((r) => r.ok)).toHaveLength(1)
        expect(results.filter((r) => !r.ok)).toEqual(
          Array(3).fill({ ok: false, reason: 'domain-taken' }),
        )
        const list = await db.companies.list()
        expect(list).toHaveLength(1)
        expect(list[0]!.domains).toHaveLength(1)
      })
    })

    describe('admin', () => {
      const first = { name: 'Ada', email: 'Admin@Example.com', password: 'correct horse battery' }

      it('registers the first admin only once', async () => {
        expect(await needsSetup(db)).toBe(true)
        expect(await createFirstAdmin(db, first)).toBe(true)
        expect(await needsSetup(db)).toBe(false)

        const stored = await db.admin.findByEmail('admin@example.com')
        expect(stored?.passwordHash).toBeTruthy()
        expect(stored?.passwordHash).not.toContain(first.password)

        // Setup is closed: a second registration changes nothing.
        const second = { name: 'Eve', email: 'eve@example.com', password: 'another passphrase 1' }
        expect(await createFirstAdmin(db, second)).toBe(false)
        expect(await db.admin.findByEmail('eve@example.com')).toBeNull()
        expect(await db.admin.findByEmail('admin@example.com')).toMatchObject({ id: stored?.id })
      })

      it('lets exactly one of several concurrent setups win', async () => {
        const attempts = ['a', 'b', 'c', 'd'].map((n) =>
          createFirstAdmin(db, {
            name: n,
            email: `${n}@example.com`,
            password: 'long enough pass',
          }),
        )
        const results = await Promise.all(attempts)
        expect(results.filter(Boolean)).toHaveLength(1)

        const winners = await Promise.all(
          ['a', 'b', 'c', 'd'].map((n) => db.admin.findByEmail(`${n}@example.com`)),
        )
        expect(winners.filter(Boolean)).toHaveLength(1)
      })
    })
  })
}
