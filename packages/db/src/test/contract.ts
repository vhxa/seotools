import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AUDIT_LIMITS,
  AUDIT_SEMANTICS,
  DEFAULT_CRAWL_SETTINGS,
  EMPTY_AUDIT_SNAPSHOT,
  JOB_TYPES,
  compileAuditRules,
  MAX_VERIFICATION_URLS,
  crawlUrlHash,
  type CrawlLinkKind,
  type CrawlRecurrence,
  type CrawlUrlKind,
  type VerificationOutcome,
} from '@seotools/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFirstAdmin, needsSetup } from '../admin'
import type {
  CrawlUrlResult,
  Database,
  NewCrawlFile,
  NewCrawlUrl,
  NewVerificationUrl,
  VerificationAnswer,
} from '../types'
import { addDomain, createCompany } from '../workspace'
import { describeLifecycle } from './lifecycle'
import { describeUsers } from './users'

const minutes = (n: number) => n * 60_000

/**
 * Behaviour every dialect must provide. `reset` must leave all tables empty.
 * SQLite runs it always; Postgres/MySQL run it when TEST_POSTGRES_URL / TEST_MYSQL_URL are set.
 */
/** What only an older version of the code wrote, put into the database as it was. */
export interface LegacyWrites {
  /** Sets the flag that accepted the page's own `nofollow` on a rule, retired with semantics 3. */
  acceptNofollow(ruleId: string, accept: boolean): Promise<void>
  /** Marks a URL of an analysis as it was stored when it had accepted the page's own `nofollow`. */
  urlAcceptedNofollow(crawlId: string, urlHash: string): Promise<void>
}

export function describeDatabaseContract(
  name: string,
  setup: () => Promise<{
    db: Database
    reset: () => Promise<void>
    legacy: LegacyWrites
    /** Rows in a table, by its name: for proving that nothing is left behind. */
    countRows: (table: string) => Promise<number>
  }>,
  options: { skip?: boolean } = {},
) {
  describe.skipIf(options.skip)(`database contract: ${name}`, () => {
    let db: Database
    let reset: () => Promise<void>
    let legacy: LegacyWrites
    let countRows: (table: string) => Promise<number>

    beforeAll(async () => {
      ;({ db, reset, legacy, countRows } = await setup())
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

    it('refuses unknown migration history before applying DDL', async () => {
      const folder = mkdtempSync(join(tmpdir(), 'seotools-migrations-'))
      mkdirSync(join(folder, 'meta'))
      writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ entries: [] }))
      try {
        await expect(db.checkMigrations(folder)).rejects.toThrow(
          /database is newer.*restoring the backup/,
        )
        await expect(db.migrate(folder)).rejects.toThrow(/database is newer/)
        await expect(db.checkMigrations()).resolves.toBeUndefined()
      } finally {
        rmSync(folder, { recursive: true, force: true })
      }
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

      it('claims only the requested types', async () => {
        const mail = await db.jobs.enqueue({ type: 'mail' })
        const crawl = await db.jobs.enqueue({ type: 'crawl' })

        const lane = await db.jobs.claim({ workerId: 'w', limit: 10, types: ['crawl'] })
        expect(lane.map((j) => j.id)).toEqual([crawl.id])

        const crawl2 = await db.jobs.enqueue({ type: 'crawl' })
        const others = await db.jobs.claim({ workerId: 'w', limit: 10, excludeTypes: ['crawl'] })
        expect(others.map((j) => j.id)).toEqual([mail.id])
        expect((await db.jobs.get(crawl2.id))?.status).toBe('pending')
      })

      it('renewing a lock keeps a long job from being taken for orphaned', async () => {
        const longAgo = new Date(Date.now() - minutes(30))
        const job = await db.jobs.enqueue({ type: 't', runAt: new Date(longAgo.getTime() - 1000) })
        await db.jobs.claim({ workerId: 'w1', limit: 1, now: longAgo })

        await db.jobs.renewLock({ id: job.id, workerId: 'intruder' })
        await db.jobs.renewLock({ id: job.id, workerId: 'w1' })

        const lockedBefore = new Date(Date.now() - minutes(5))
        expect(await db.jobs.requeueStale({ lockedBefore })).toBe(0)
        expect((await db.jobs.get(job.id))?.status).toBe('running')
      })

      it('releases a job without spending an attempt, only for the lock owner', async () => {
        const job = await db.jobs.enqueue({ type: 't' })
        await db.jobs.claim({ workerId: 'w1', limit: 1 })

        await db.jobs.release({ id: job.id, workerId: 'intruder' })
        expect((await db.jobs.get(job.id))?.status).toBe('running')

        await db.jobs.release({ id: job.id, workerId: 'w1' })
        expect(await db.jobs.get(job.id)).toMatchObject({
          status: 'pending',
          attempts: 0,
          lockedBy: null,
        })
        expect((await db.jobs.claim({ workerId: 'w2', limit: 1 }))[0]).toMatchObject({
          id: job.id,
          attempts: 1,
        })
      })

      it('can hand a job back to run later, not before', async () => {
        const job = await db.jobs.enqueue({ type: 't' })
        const now = new Date()
        await db.jobs.claim({ workerId: 'w1', limit: 1, now })

        const later = new Date(now.getTime() + minutes(10))
        await db.jobs.release({ id: job.id, workerId: 'w1', runAt: later })
        expect(await db.jobs.get(job.id)).toMatchObject({
          status: 'pending',
          attempts: 0,
          lockedBy: null,
        })
        expect(await db.jobs.claim({ workerId: 'w1', limit: 1, now })).toEqual([])
        expect(
          (
            await db.jobs.claim({ workerId: 'w1', limit: 1, now: new Date(later.getTime() + 1) })
          ).map((claimed) => claimed.id),
        ).toEqual([job.id])
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

    describeLifecycle(
      () => db,
      (table) => countRows(table),
    )
    describeUsers(() => db)

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

    describe('crawls', () => {
      const newUrl = (url: string, overrides: Partial<NewCrawlUrl> = {}): NewCrawlUrl => ({
        url,
        urlHash: crawlUrlHash(url),
        scope: 'internal',
        source: 'link',
        depth: 1,
        ...overrides,
      })
      const result = (kind: CrawlUrlKind, overrides: Partial<CrawlUrlResult> = {}) => ({
        kind,
        statusCode: 200,
        contentType: 'text/html',
        redirectTo: null,
        title: null,
        metaRobots: null,
        xRobotsTag: null,
        canonical: null,
        responseTimeMs: 12,
        bytes: 100,
        error: null,
        data: null,
        ...overrides,
      })

      const NO_PAGES = {
        audited: 0,
        excluded: 0,
        indexable: 0,
        notIndexable: 0,
        unknownIndexability: 0,
      }
      /** An analysis with nothing audit-wise to say, as the ones made before audit rules existed. */
      const saveIssues = (
        input: Omit<Parameters<Database['crawls']['saveAnalysis']>[0], 'audit'> & {
          audit?: Partial<Parameters<Database['crawls']['saveAnalysis']>[0]['audit']>
        },
      ) =>
        db.crawls.saveAnalysis({
          ...input,
          audit: { snapshot: EMPTY_AUDIT_SNAPSHOT, pages: NO_PAGES, urls: [], ...input.audit },
        })

      async function domain(host = 'acme.com') {
        const created = await createCompany(db, { name: host, domain: host })
        if (!created.ok) throw new Error('setup failed')
        return created.domain.id
      }

      async function startCrawl(domainId: string, type: 'full' | 'priority' = 'full') {
        const crawl = await db.crawls.start({ domainId, type, trigger: 'manual' })
        if (!crawl) throw new Error('crawl did not start')
        return crawl
      }

      /** A finished full crawl with one page, for retention tests. */
      async function finishedCrawl(domainId: string, url = 'https://acme.com/') {
        const crawl = await startCrawl(domainId)
        await db.crawls.addUrls(crawl.id, [newUrl(url)])
        await db.crawls.recordResult({
          crawlId: crawl.id,
          urlHash: crawlUrlHash(url),
          result: result('page'),
        })
        await db.crawls.finish(crawl.id, { status: 'completed' })
        // Retention orders by creation time, which has millisecond resolution.
        await new Promise((r) => setTimeout(r, 5))
        return crawl
      }

      it('uses the defaults until a domain saves its settings', async () => {
        const domainId = await domain()
        expect(await db.crawls.settings(domainId)).toEqual(DEFAULT_CRAWL_SETTINGS)

        const custom = {
          ...DEFAULT_CRAWL_SETTINGS,
          userAgent: 'MyBot/1.0',
          concurrency: 4,
          maxUrls: null,
          retainCrawls: null,
        }
        await db.crawls.saveSettings(domainId, custom)
        expect(await db.crawls.settings(domainId)).toEqual(custom)
        await db.crawls.saveSettings(domainId, { ...custom, concurrency: 8 })
        expect((await db.crawls.settings(domainId)).concurrency).toBe(8)

        const withFiles = {
          ...custom,
          optionalFiles: ['ads', 'feed'] as const,
          indexNowKey: 'abcd1234',
        }
        await db.crawls.saveSettings(domainId, {
          ...withFiles,
          optionalFiles: [...withFiles.optionalFiles],
        })
        expect(await db.crawls.settings(domainId)).toMatchObject({
          optionalFiles: ['ads', 'feed'],
          indexNowKey: 'abcd1234',
        })
      })

      it('lists the extra files each domain turned on', async () => {
        const first = await domain('first.com')
        const second = await domain('second.com')
        const third = await domain('third.com')

        expect((await db.crawls.enabledFiles()).size).toBe(0)

        const base = await db.crawls.settings(first)
        await db.crawls.saveSettings(first, { ...base, optionalFiles: ['feed', 'ads'] })
        await db.crawls.saveSettings(second, { ...base, indexNowKey: 'abcd1234' })
        // Saved, but with nothing turned on: no different from a domain with no row.
        await db.crawls.saveSettings(third, base)

        expect(await db.crawls.enabledFiles()).toEqual(
          new Map([
            [first, ['ads', 'feed']],
            [second, ['indexnow']],
          ]),
        )
      })

      it('starts a crawl together with the job that runs it', async () => {
        const domainId = await domain()
        const crawl = await startCrawl(domainId)

        expect(crawl).toMatchObject({
          domainId,
          type: 'full',
          status: 'pending',
          trigger: 'manual',
        })
        expect(await db.jobs.get(crawl.jobId)).toMatchObject({
          type: JOB_TYPES.crawlRun,
          status: 'pending',
          payload: { crawlId: crawl.id },
        })
        expect((await db.crawls.active(domainId))?.id).toBe(crawl.id)
      })

      it('allows one active crawl per domain, whatever its type', async () => {
        const domainId = await domain()
        const otherDomainId = await domain('other.com')
        const crawl = await startCrawl(domainId)

        expect(await db.crawls.start({ domainId, type: 'priority', trigger: 'manual' })).toBeNull()
        expect(await db.crawls.list(domainId)).toHaveLength(1)
        expect((await db.jobs.countByStatus()).pending).toBe(1)
        expect(
          await db.crawls.start({ domainId: otherDomainId, type: 'full', trigger: 'manual' }),
        ).not.toBeNull()

        await db.crawls.finish(crawl.id, { status: 'completed' })
        expect(await db.crawls.active(domainId)).toBeNull()
        expect(
          await db.crawls.start({ domainId, type: 'priority', trigger: 'schedule' }),
        ).toMatchObject({ type: 'priority', trigger: 'schedule' })
      })

      it('lets exactly one of several concurrent starts win', async () => {
        const domainId = await domain()
        const results = await Promise.all(
          [1, 2, 3, 4].map(() => db.crawls.start({ domainId, type: 'full', trigger: 'manual' })),
        )
        expect(results.filter(Boolean)).toHaveLength(1)
        expect(await db.crawls.list(domainId)).toHaveLength(1)
        expect((await db.jobs.countByStatus()).pending).toBe(1)
      })

      it('runs, cancels and finishes only while active', async () => {
        const domainId = await domain()
        const crawl = await startCrawl(domainId)

        const running = await db.crawls.markRunning(crawl.id)
        expect(running?.status).toBe('running')
        expect(running?.startedAt).toBeInstanceOf(Date)

        expect(await db.crawls.cancel(crawl.id)).toBe(true)
        expect(await db.crawls.cancel(crawl.id)).toBe(false)
        expect(await db.crawls.markRunning(crawl.id)).toBeNull()
        expect(await db.crawls.finish(crawl.id, { status: 'completed' })).toBe(false)
        expect(await db.crawls.get(crawl.id)).toMatchObject({ status: 'cancelled' })
        expect((await db.crawls.get(crawl.id))?.finishedAt).toBeInstanceOf(Date)
      })

      it('queues internal URLs shallowest first and only records external ones', async () => {
        const domainId = await domain()
        const { id } = await startCrawl(domainId)
        await db.crawls.addUrls(id, [
          newUrl('https://acme.com/deep', { depth: 3 }),
          newUrl('https://acme.com/', { depth: 0, source: 'seed' }),
          newUrl('https://elsewhere.org/', { scope: 'external' }),
        ])
        // Adding a URL again is a no-op.
        await db.crawls.addUrls(id, [newUrl('https://acme.com/', { depth: 9 })])

        const queued = await db.crawls.nextQueued(id, 10)
        expect(queued.map((u) => u.url)).toEqual(['https://acme.com/', 'https://acme.com/deep'])
        expect(queued[0]).toMatchObject({ depth: 0, source: 'seed', scope: 'internal' })
        expect(await db.crawls.nextQueued(id, 1)).toHaveLength(1)
        expect(await db.crawls.knownUrls(id)).toHaveLength(3)
      })

      it('records a result with what it discovered, atomically and idempotently', async () => {
        const domainId = await domain()
        const { id } = await startCrawl(domainId)
        const home = 'https://acme.com/'
        const about = 'https://acme.com/about'
        const outside = 'https://elsewhere.org/'
        await db.crawls.addUrls(id, [newUrl(home, { depth: 0 })])

        const record = () =>
          db.crawls.recordResult({
            crawlId: id,
            urlHash: crawlUrlHash(home),
            result: result('page', {
              title: 'Home',
              metaRobots: 'noindex',
              xRobotsTag: 'nofollow',
              canonical: home,
              data: {
                h1: ['Welcome'],
                hreflang: [{ lang: 'es', url: `${home}es`, source: 'html' }],
              },
            }),
            urls: [newUrl(about), newUrl(outside, { scope: 'external' })],
            links: [
              { sourceHash: crawlUrlHash(home), targetHash: crawlUrlHash(about), kind: 'anchor' },
              { sourceHash: crawlUrlHash(home), targetHash: crawlUrlHash(outside), kind: 'anchor' },
              { sourceHash: crawlUrlHash(home), targetHash: crawlUrlHash(outside), kind: 'image' },
            ],
          })
        await record()
        await record()

        expect((await db.crawls.nextQueued(id, 10)).map((u) => u.url)).toEqual([about])
        expect(await db.crawls.countUrls(id)).toEqual({
          urlsCount: 2,
          urlsDoneCount: 1,
          pagesCount: 1,
          externalCount: 1,
        })
        const [page] = await db.crawls.listUrls({
          crawlId: id,
          view: 'pages',
          limit: 10,
          offset: 0,
        })
        expect(page).toMatchObject({
          url: home,
          state: 'done',
          statusCode: 200,
          title: 'Home',
          metaRobots: 'noindex',
          xRobotsTag: 'nofollow',
          canonical: home,
          data: { h1: ['Welcome'], hreflang: [{ lang: 'es', url: `${home}es` }] },
        })
        expect(page?.fetchedAt).toBeInstanceOf(Date)

        const sources = await db.crawls.linkSources(id, crawlUrlHash(outside))
        expect(sources.map((s) => s.kind).sort()).toEqual(['anchor', 'image'])
        expect(new Set(sources.map((s) => s.url))).toEqual(new Set([home]))
      })

      it('stores what a website sends, however odd', async () => {
        const domainId = await domain()
        const { id } = await startCrawl(domainId)
        const url = 'https://acme.com/'
        await db.crawls.addUrls(id, [newUrl(url)])
        await db.crawls.recordResult({
          crawlId: id,
          urlHash: crawlUrlHash(url),
          result: result('page', {
            title: `nul\u0000 byte 🦄 ${'x'.repeat(5000)}`,
            contentType: `text/html; ${'y'.repeat(500)}`,
            bytes: 5_000_000_000,
          }),
        })
        await db.crawls.saveRobots(id, {
          'https://acme.com': { status: 200, body: 'User-agent: *\u0000\nDisallow: /' },
        })

        const [page] = await db.crawls.listUrls({ crawlId: id, view: 'pages', limit: 1, offset: 0 })
        expect(page?.title).toMatch(/^nul byte 🦄 x+$/)
        expect(page?.title).toHaveLength(2048)
        expect(page?.contentType).toHaveLength(255)
        expect(page?.bytes).toBe(2_147_483_647)
        expect((await db.crawls.get(id))?.robots).toEqual({
          'https://acme.com': { status: 200, body: 'User-agent: *\nDisallow: /' },
        })
      })

      it('separates pages, the rest of the site and external URLs', async () => {
        const domainId = await domain()
        const { id } = await startCrawl(domainId)
        const urls = {
          page: 'https://acme.com/',
          image: 'https://acme.com/a.png',
          moved: 'https://acme.com/moved',
          external: 'https://elsewhere.org/',
        }
        await db.crawls.addUrls(id, [
          newUrl(urls.page),
          newUrl(urls.image),
          newUrl(urls.moved),
          newUrl(urls.external, { scope: 'external' }),
        ])
        for (const [url, kind] of [
          [urls.page, 'page'],
          [urls.image, 'resource'],
          [urls.moved, 'redirect'],
        ] as const) {
          await db.crawls.recordResult({
            crawlId: id,
            urlHash: crawlUrlHash(url),
            result: result(kind),
          })
        }
        const view = async (view: 'pages' | 'other' | 'external') =>
          (await db.crawls.listUrls({ crawlId: id, view, limit: 10, offset: 0 })).map((u) => u.url)

        expect(await view('pages')).toEqual([urls.page])
        expect((await view('other')).sort()).toEqual([urls.image, urls.moved].sort())
        expect(await view('external')).toEqual([urls.external])

        // External URLs never count towards the pages or URLs of the site.
        expect(await db.crawls.finish(id, { status: 'completed' })).toBe(true)
        expect(await db.crawls.get(id)).toMatchObject({
          status: 'completed',
          pagesCount: 1,
          urlsCount: 3,
          urlsDoneCount: 3,
          externalCount: 1,
        })
      })

      it('pages through a view in a stable order', async () => {
        const domainId = await domain()
        const { id } = await startCrawl(domainId)
        const urls = ['a', 'b', 'c', 'd', 'e'].map((p) => `https://acme.com/${p}`)
        await db.crawls.addUrls(
          id,
          urls.map((url) => newUrl(url)),
        )
        for (const url of urls) {
          await db.crawls.recordResult({
            crawlId: id,
            urlHash: crawlUrlHash(url),
            result: result('page'),
          })
        }
        const page = async (offset: number) =>
          (await db.crawls.listUrls({ crawlId: id, view: 'pages', limit: 2, offset })).map(
            (u) => u.url,
          )
        expect(await page(0)).toEqual(urls.slice(0, 2))
        expect(await page(2)).toEqual(urls.slice(2, 4))
        expect(await page(4)).toEqual(urls.slice(4))
      })

      it('pages through a filtered list without skipping or repeating a URL, whatever the order', async () => {
        // What an export does: walk every URL the filters leave, in batches. Many URLs tie on
        // depth, status, title and size, and two of them differ only in case, which a dialect's
        // collation may take for the same address: the order still has to be total.
        const domainId = await domain()
        const { id } = await startCrawl(domainId)
        const urls = [
          ...Array.from({ length: 23 }, (_, i) => `https://acme.com/p${i}`),
          'https://acme.com/Case',
          'https://acme.com/case',
        ]
        await db.crawls.addUrls(
          id,
          urls.map((url) => newUrl(url)),
        )
        for (const [index, url] of urls.entries()) {
          await db.crawls.recordResult({
            crawlId: id,
            urlHash: crawlUrlHash(url),
            result: result('page', {
              statusCode: index % 5 === 0 ? 404 : 200,
              title: index % 3 === 0 ? null : 'Same title',
              bytes: 100,
            }),
          })
        }
        const everything = async (
          filter: Partial<Parameters<typeof db.crawls.listUrls>[0]>,
          size: number,
        ) => {
          const found: string[] = []
          for (let offset = 0; ; offset += size) {
            const batch = await db.crawls.listUrls({
              crawlId: id,
              view: 'pages',
              ...filter,
              limit: size,
              offset,
            })
            found.push(...batch.map((row) => row.urlHash))
            if (batch.length < size) return found
          }
        }
        for (const sort of [undefined, 'url', 'title', 'status', 'bytes', 'depth'] as const) {
          for (const direction of ['asc', 'desc'] as const) {
            const filter = { ...(sort ? { sort, direction } : {}) }
            const all = await everything(filter, 100)
            expect(new Set(all).size).toBe(urls.length)
            // Any batch size walks the same list.
            expect(await everything(filter, 4)).toEqual(all)
            expect(await everything(filter, 7)).toEqual(all)
          }
        }
        // Narrowed by a filter, the walk holds exactly what the count says.
        const narrowed = { status: '4xx' as const }
        const walked = await everything({ ...narrowed, sort: 'title' }, 3)
        expect(walked).toHaveLength(
          await db.crawls.countListed({ crawlId: id, view: 'pages', ...narrowed }),
        )
        expect(new Set(walked).size).toBe(walked.length)
      })

      describe('lists of URLs', () => {
        const site = 'https://acme.com'
        const pages = {
          home: { path: '/', title: 'Home', status: 200, ms: 30, depth: 0 },
          about: { path: '/about', title: 'About us', status: 200, ms: 10, depth: 1 },
          gone: { path: '/gone', title: null, status: 404, ms: 20, depth: 1 },
          deep: { path: '/blog/50%_off', title: 'Sale', status: 200, ms: null, depth: 2 },
        }
        const hashOf = (page: { path: string }) => crawlUrlHash(`${site}${page.path}`)

        async function crawlOfPages() {
          const domainId = await domain()
          const { id } = await startCrawl(domainId)
          await db.crawls.addUrls(
            id,
            Object.values(pages).map((p) => newUrl(`${site}${p.path}`, { depth: p.depth })),
          )
          await db.crawls.addUrls(id, [
            newUrl(`${site}/logo.png`),
            newUrl('https://elsewhere.org/', { scope: 'external' }),
          ])
          for (const p of Object.values(pages)) {
            await db.crawls.recordResult({
              crawlId: id,
              urlHash: hashOf(p),
              result: result('page', {
                title: p.title,
                statusCode: p.status,
                responseTimeMs: p.ms,
              }),
            })
          }
          await db.crawls.recordResult({
            crawlId: id,
            urlHash: crawlUrlHash(`${site}/logo.png`),
            result: result('resource', { contentType: 'image/png' }),
          })
          return id
        }

        const paths = async (
          crawlId: string,
          options: Partial<Parameters<typeof db.crawls.listUrls>[0]> = {},
        ) =>
          (
            await db.crawls.listUrls({
              crawlId,
              view: 'pages',
              limit: 10,
              offset: 0,
              ...options,
            })
          ).map((u) => u.url.slice(site.length))

        it('orders by a column in either direction, leaving empty values last', async () => {
          const crawlId = await crawlOfPages()
          expect(await paths(crawlId)).toEqual(['/', '/about', '/gone', '/blog/50%_off'])
          expect(await paths(crawlId, { sort: 'url' })).toEqual([
            '/',
            '/about',
            '/blog/50%_off',
            '/gone',
          ])
          expect(await paths(crawlId, { sort: 'responseTime' })).toEqual([
            '/about',
            '/gone',
            '/',
            '/blog/50%_off',
          ])
          expect(await paths(crawlId, { sort: 'responseTime', direction: 'desc' })).toEqual([
            '/',
            '/gone',
            '/about',
            '/blog/50%_off',
          ])
          expect(await paths(crawlId, { sort: 'title' })).toEqual([
            '/about',
            '/',
            '/blog/50%_off',
            '/gone',
          ])
          expect(await paths(crawlId, { sort: 'status', direction: 'desc' })).toEqual([
            '/gone',
            '/',
            '/about',
            '/blog/50%_off',
          ])
        })

        it('searches the URL and the title, whatever the case, taking % and _ literally', async () => {
          const crawlId = await crawlOfPages()
          expect(await paths(crawlId, { search: 'ABOUT' })).toEqual(['/about'])
          expect(await paths(crawlId, { search: 'sale' })).toEqual(['/blog/50%_off'])
          expect(await paths(crawlId, { search: '50%_' })).toEqual(['/blog/50%_off'])
          expect(await paths(crawlId, { search: '%' })).toEqual(['/blog/50%_off'])
          expect(await paths(crawlId, { search: 'a_out' })).toEqual([])
          expect(await paths(crawlId, { search: 'nothing like this' })).toEqual([])
        })

        it('filters pages by issue and counts what a list shows', async () => {
          const crawlId = await crawlOfPages()
          await saveIssues({
            crawlId,
            issues: [
              { urlHash: hashOf(pages.gone), issue: 'http-error' },
              { urlHash: hashOf(pages.gone), issue: 'missing-title' },
              { urlHash: hashOf(pages.deep), issue: 'missing-title' },
            ],
            pages: { issue: 2, warning: 0, opportunity: 0 },
            withType: { issue: 2, warning: 0, opportunity: 0 },
            catalog: 'v1',
          })
          expect(await paths(crawlId, { issue: 'missing-title' })).toEqual([
            '/gone',
            '/blog/50%_off',
          ])
          expect(await paths(crawlId, { issue: 'http-error' })).toEqual(['/gone'])
          expect(await paths(crawlId, { issue: 'http-error', search: 'about' })).toEqual([])
          expect(await paths(crawlId, { issue: 'unknown' })).toEqual([])

          expect(await db.crawls.countListed({ crawlId, view: 'pages' })).toBe(4)
          expect(await db.crawls.countListed({ crawlId, view: 'pages', search: 'about' })).toBe(1)
          expect(
            await db.crawls.countListed({ crawlId, view: 'pages', issue: 'missing-title' }),
          ).toBe(2)
          expect(await db.crawls.countListed({ crawlId, view: 'other' })).toBe(1)
          expect(await db.crawls.countListed({ crawlId, view: 'external' })).toBe(1)
          expect(await db.crawls.countListed({ crawlId: 'missing', view: 'pages' })).toBe(0)
        })

        it('finds the URLs of an issue in whichever view they are', async () => {
          const crawlId = await crawlOfPages()
          await saveIssues({
            crawlId,
            issues: [
              { urlHash: hashOf(pages.gone), issue: 'client-error' },
              { urlHash: crawlUrlHash(`${site}/logo.png`), issue: 'client-error' },
              { urlHash: crawlUrlHash('https://elsewhere.org/'), issue: 'client-error' },
            ],
            pages: { issue: 1, warning: 0, opportunity: 0 },
            withType: { issue: 1, warning: 0, opportunity: 0 },
            catalog: 'v1',
          })
          expect(
            await db.crawls.countListed({ crawlId, view: 'pages', issue: 'client-error' }),
          ).toBe(3)
          const listed = await db.crawls.listUrls({
            crawlId,
            view: 'pages',
            issue: 'client-error',
            limit: 10,
            offset: 0,
          })
          expect(listed.map((url) => url.url).sort()).toEqual(
            ['https://elsewhere.org/', `${site}/gone`, `${site}/logo.png`].sort(),
          )
        })

        it('gets a URL and the URLs it links to', async () => {
          const crawlId = await crawlOfPages()
          const home = `${site}/`
          const outside = 'https://elsewhere.org/'
          await db.crawls.recordResult({
            crawlId,
            urlHash: crawlUrlHash(home),
            result: result('page', { title: 'Home' }),
            links: [
              { sourceHash: crawlUrlHash(home), targetHash: hashOf(pages.about), kind: 'anchor' },
              {
                sourceHash: crawlUrlHash(home),
                targetHash: crawlUrlHash(outside),
                kind: 'anchor',
              },
            ],
          })

          expect(await db.crawls.getUrl(crawlId, hashOf(pages.about))).toMatchObject({
            url: `${site}/about`,
            title: 'About us',
            statusCode: 200,
          })
          expect(await db.crawls.getUrl(crawlId, 'nope')).toBeNull()
          expect(await db.crawls.getUrl('missing', hashOf(pages.about))).toBeNull()

          const targets = await db.crawls.linkTargets(crawlId, crawlUrlHash(home))
          expect(new Set(targets.map((t) => t.url))).toEqual(new Set([`${site}/about`, outside]))
          expect(await db.crawls.linkTargets(crawlId, hashOf(pages.about))).toEqual([])
          // Sorted by URL, so a cap keeps the first ones.
          expect(await db.crawls.linkTargets(crawlId, crawlUrlHash(home), { limit: 1 })).toEqual([
            { url: `${site}/about`, kind: 'anchor' },
          ])
          expect(await db.crawls.linkSources(crawlId, hashOf(pages.about), { limit: 1 })).toEqual([
            { url: home, kind: 'anchor' },
          ])
        })
      })

      describe('views and filters of a list of URLs', () => {
        const site = 'https://acme.com'
        const outside = 'https://elsewhere.org'
        const hashOf = (path: string) => crawlUrlHash(`${site}${path}`)
        const audit = (
          path: string,
          overrides: Partial<{
            participation: 'audited' | 'excluded'
            indexability: 'indexable' | 'not-indexable' | 'unknown'
            blockers: string[]
          }> = {},
        ) => ({
          urlHash: hashOf(path),
          participation: 'audited' as const,
          participationRule: null,
          intent: 'indexable' as const,
          intentRule: null,
          conditions: {},
          indexability: 'unknown' as const,
          blockers: [],
          ...overrides,
        })

        /**
         * A site of every sort: pages that answer, fail and are left out, a redirect, an image, a
         * URL that failed before answering, one nobody requested, and external links, one of
         * them never checked.
         */
        async function crawlOfEverything(analysed = true) {
          const domainId = await domain()
          const { id } = await startCrawl(domainId)
          await db.crawls.addUrls(id, [
            newUrl(`${site}/`, { depth: 0 }),
            newUrl(`${site}/gone`),
            newUrl(`${site}/boom`),
            newUrl(`${site}/hidden`),
            newUrl(`${site}/old`),
            newUrl(`${site}/logo.png`),
            newUrl(`${site}/broken`),
            newUrl(`${site}/never`),
            newUrl(`${outside}/ok`, { scope: 'external' }),
            newUrl(`${outside}/missing`, { scope: 'external' }),
            newUrl(`${outside}/unchecked`, { scope: 'external' }),
          ])
          const answers: [string, CrawlUrlKind, Partial<CrawlUrlResult>][] = [
            ['/', 'page', { title: 'Home' }],
            ['/gone', 'page', { statusCode: 404 }],
            ['/boom', 'page', { statusCode: 500 }],
            ['/hidden', 'page', { metaRobots: 'noindex' }],
            ['/old', 'redirect', { statusCode: 301, redirectTo: `${site}/` }],
            ['/logo.png', 'resource', { contentType: 'image/png' }],
            ['/broken', 'unknown', { statusCode: null, error: 'ECONNRESET' }],
          ]
          for (const [path, kind, overrides] of answers) {
            await db.crawls.recordResult({
              crawlId: id,
              urlHash: hashOf(path),
              result: result(kind, overrides),
            })
          }
          for (const [path, statusCode] of [
            ['/ok', 200],
            ['/missing', 404],
          ] as const) {
            await db.crawls.recordResult({
              crawlId: id,
              urlHash: crawlUrlHash(`${outside}${path}`),
              result: result('unknown', { statusCode, contentType: null, bytes: null }),
            })
          }
          const none = { issue: 0, warning: 0, opportunity: 0 }
          await saveIssues({
            crawlId: id,
            issues: [
              { urlHash: hashOf('/gone'), issue: 'client-error' },
              { urlHash: hashOf('/old'), issue: 'client-error' },
              { urlHash: crawlUrlHash(`${outside}/missing`), issue: 'client-error' },
              { urlHash: hashOf('/broken'), issue: 'client-error' },
            ],
            pages: none,
            withType: none,
            catalog: 'v1',
            ...(analysed
              ? {
                  audit: {
                    snapshot: EMPTY_AUDIT_SNAPSHOT,
                    pages: {
                      audited: 3,
                      excluded: 1,
                      indexable: 1,
                      notIndexable: 3,
                      unknownIndexability: 0,
                    },
                    urls: [
                      audit('/', { indexability: 'indexable' }),
                      audit('/gone', { indexability: 'not-indexable', blockers: ['http-error'] }),
                      audit('/boom', { indexability: 'not-indexable', blockers: ['http-error'] }),
                      audit('/hidden', {
                        participation: 'excluded',
                        indexability: 'not-indexable',
                        blockers: ['noindex'],
                      }),
                      audit('/old', { indexability: 'not-indexable', blockers: ['redirect'] }),
                      audit('/logo.png'),
                      audit('/broken'),
                      audit('/never'),
                    ],
                  },
                }
              : {}),
          })
          return id
        }

        const list = async (
          crawlId: string,
          query: Partial<Parameters<typeof db.crawls.listUrls>[0]> = {},
        ) => {
          const filter = { crawlId, view: 'all' as const, ...query }
          const urls = (
            await db.crawls.listUrls({ limit: 100, offset: 0, sort: 'url', ...filter })
          ).map((row) => row.url.replace(site, '').replace(outside, 'ext'))
          // What a page shows as the total is what the list holds, whatever the filters.
          expect(await db.crawls.countListed(filter)).toBe(urls.length)
          return urls
        }

        it('has a view for pages, resources, redirects, external URLs and everything', async () => {
          const crawlId = await crawlOfEverything()
          expect(await list(crawlId, { view: 'pages' })).toEqual(['/', '/boom', '/gone', '/hidden'])
          expect(await list(crawlId, { view: 'resources' })).toEqual(['/logo.png'])
          expect(await list(crawlId, { view: 'redirects' })).toEqual(['/old'])
          expect(await list(crawlId, { view: 'external' })).toEqual([
            'ext/missing',
            'ext/ok',
            'ext/unchecked',
          ])
          // `other` keeps meaning the site's URLs that are not pages, for the links that exist.
          expect(await list(crawlId, { view: 'other' })).toEqual([
            '/broken',
            '/logo.png',
            '/never',
            '/old',
          ])
          // `all` is the only view with the URLs of the site that never answered, and the external ones.
          expect(await list(crawlId, { view: 'all' })).toEqual([
            '/',
            '/boom',
            '/broken',
            '/gone',
            '/hidden',
            '/logo.png',
            '/never',
            '/old',
            'ext/missing',
            'ext/ok',
            'ext/unchecked',
          ])
        })

        it('counts what each view starts from, to compare with what a filter leaves', async () => {
          const crawlId = await crawlOfEverything()
          expect(await db.crawls.viewCounts(crawlId)).toEqual({
            pages: 4,
            resources: 1,
            redirects: 1,
            other: 4,
            external: 3,
            all: 11,
          })
          expect(await db.crawls.viewCounts('missing')).toEqual({
            pages: 0,
            resources: 0,
            redirects: 0,
            other: 0,
            external: 0,
            all: 0,
          })
          // The views and their counts are one thing: the count of each is the size of its list.
          for (const view of [
            'pages',
            'resources',
            'redirects',
            'other',
            'external',
            'all',
          ] as const) {
            expect(await db.crawls.countListed({ crawlId, view })).toBe(
              (await db.crawls.viewCounts(crawlId))[view],
            )
          }
        })

        it('filters by the class of the HTTP status, or by having none', async () => {
          const crawlId = await crawlOfEverything()
          expect(await list(crawlId, { status: '2xx' })).toEqual([
            '/',
            '/hidden',
            '/logo.png',
            'ext/ok',
          ])
          expect(await list(crawlId, { status: '3xx' })).toEqual(['/old'])
          expect(await list(crawlId, { status: '4xx' })).toEqual(['/gone', 'ext/missing'])
          expect(await list(crawlId, { status: '5xx' })).toEqual(['/boom'])
          // No status is neither a success nor an error: the URLs that failed or were not requested.
          expect(await list(crawlId, { status: 'none' })).toEqual([
            '/broken',
            '/never',
            'ext/unchecked',
          ])
          // Within a view.
          expect(await list(crawlId, { view: 'pages', status: '2xx' })).toEqual(['/', '/hidden'])
          expect(await list(crawlId, { view: 'external', status: '4xx' })).toEqual(['ext/missing'])
          expect(await list(crawlId, { view: 'pages', status: 'none' })).toEqual([])
        })

        it('filters by what a URL of the site turned out to be, leaving external ones out', async () => {
          const crawlId = await crawlOfEverything()
          expect(await list(crawlId, { type: 'page' })).toEqual(['/', '/boom', '/gone', '/hidden'])
          expect(await list(crawlId, { type: 'resource' })).toEqual(['/logo.png'])
          expect(await list(crawlId, { type: 'redirect' })).toEqual(['/old'])
          // External URLs are stored as `unknown` but are not URLs of the site that failed.
          expect(await list(crawlId, { type: 'unknown' })).toEqual(['/broken', '/never'])
          expect(await list(crawlId, { view: 'other', type: 'unknown' })).toEqual([
            '/broken',
            '/never',
          ])
          expect(await list(crawlId, { view: 'external', type: 'unknown' })).toEqual([])
          // A type the view cannot hold lists nothing.
          expect(await list(crawlId, { view: 'pages', type: 'resource' })).toEqual([])
        })

        it('filters by technical indexability, which only URLs of the site have', async () => {
          const crawlId = await crawlOfEverything()
          expect(await list(crawlId, { indexability: 'indexable' })).toEqual(['/'])
          expect(await list(crawlId, { indexability: 'not-indexable' })).toEqual([
            '/boom',
            '/gone',
            '/hidden',
            '/old',
          ])
          // Unknown is its own state: what the crawl could not tell, not "not indexable".
          expect(await list(crawlId, { indexability: 'unknown' })).toEqual([
            '/broken',
            '/logo.png',
            '/never',
          ])
          expect(await list(crawlId, { view: 'pages', indexability: 'unknown' })).toEqual([])
          expect(await list(crawlId, { view: 'external', indexability: 'indexable' })).toEqual([])
          expect(await list(crawlId, { view: 'external', indexability: 'unknown' })).toEqual([])
          expect(await list(crawlId, { view: 'external', participation: 'audited' })).toEqual([])
        })

        it('has nothing to filter by indexability in a crawl analysed without it', async () => {
          const crawlId = await crawlOfEverything(false)
          expect(await list(crawlId, { indexability: 'unknown' })).toEqual([])
          expect(await list(crawlId, { indexability: 'indexable' })).toEqual([])
          // The rest of what the crawl stored does not depend on the analysis.
          expect(await list(crawlId, { view: 'pages', status: '4xx' })).toEqual(['/gone'])
        })

        it('adds filters up, with the search and the audit ones', async () => {
          const crawlId = await crawlOfEverything()
          expect(await list(crawlId, { status: '4xx', indexability: 'not-indexable' })).toEqual([
            '/gone',
          ])
          expect(await list(crawlId, { type: 'page', participation: 'excluded' })).toEqual([
            '/hidden',
          ])
          expect(await list(crawlId, { status: '2xx', type: 'page', search: 'home' })).toEqual([
            '/',
          ])
          expect(
            await list(crawlId, { view: 'pages', status: '2xx', indexability: 'not-indexable' }),
          ).toEqual(['/hidden'])
          expect(await list(crawlId, { status: '5xx', type: 'resource' })).toEqual([])
        })

        it('narrows an issue, which lists its URLs in every view, with the other filters', async () => {
          const crawlId = await crawlOfEverything()
          // The view is ignored, like listing everything.
          expect(await list(crawlId, { view: 'resources', issue: 'client-error' })).toEqual([
            '/broken',
            '/gone',
            '/old',
            'ext/missing',
          ])
          expect(
            await list(crawlId, { view: 'pages', issue: 'client-error', status: 'none' }),
          ).toEqual(['/broken'])
          expect(
            await list(crawlId, { view: 'pages', issue: 'client-error', type: 'redirect' }),
          ).toEqual(['/old'])
          expect(
            await list(crawlId, { view: 'pages', issue: 'client-error', indexability: 'unknown' }),
          ).toEqual(['/broken'])
        })

        it('orders and pages every view the same way, the URLs without a value last', async () => {
          const crawlId = await crawlOfEverything()
          const page = async (offset: number, direction: 'asc' | 'desc') =>
            (
              await db.crawls.listUrls({
                crawlId,
                view: 'all',
                sort: 'status',
                direction,
                limit: 4,
                offset,
              })
            ).map((row) => row.statusCode)
          expect([
            ...(await page(0, 'asc')),
            ...(await page(4, 'asc')),
            ...(await page(8, 'asc')),
          ]).toEqual([200, 200, 200, 200, 301, 404, 404, 500, null, null, null])
          expect([
            ...(await page(0, 'desc')),
            ...(await page(4, 'desc')),
            ...(await page(8, 'desc')),
          ]).toEqual([500, 404, 404, 301, 200, 200, 200, 200, null, null, null])
        })
      })

      describe('the links of a URL', () => {
        const site = 'https://acme.com'
        const outside = 'https://elsewhere.org/'
        const url = (path: string) => `${site}${path}`
        const hashOf = (address: string) => crawlUrlHash(address)
        const home = url('/')
        const sale = url('/sale/50%_off')
        const never = url('/never-requested')

        async function crawlWithLinks(domainId?: string) {
          const { id } = await startCrawl(domainId ?? (await domain()))
          await db.crawls.addUrls(id, [
            newUrl(home, { depth: 0 }),
            ...['/about', '/app.js', '/blog/a', '/blog/b', '/gone', '/logo.png'].map((path) =>
              newUrl(url(path)),
            ),
            newUrl(sale),
            newUrl(never),
            newUrl(outside, { scope: 'external' }),
          ])
          const answered = {
            [home]: result('page', { title: 'Home' }),
            [url('/about')]: result('page', { title: 'About' }),
            [url('/blog/a')]: result('page'),
            [url('/blog/b')]: result('page'),
            [url('/gone')]: result('page', { statusCode: 404 }),
            [url('/app.js')]: result('resource', { contentType: 'text/javascript' }),
            [url('/logo.png')]: result('resource', { contentType: 'image/png' }),
            [sale]: result('page', { statusCode: 500, error: 'boom' }),
          }
          const link = (from: string, to: string, kind: CrawlLinkKind) => ({
            sourceHash: hashOf(from),
            targetHash: hashOf(to),
            kind,
          })
          const links = {
            [home]: [
              link(home, url('/about'), 'anchor'),
              link(home, url('/blog/a'), 'anchor'),
              link(home, url('/blog/b'), 'anchor-nofollow'),
              link(home, url('/gone'), 'anchor'),
              link(home, sale, 'anchor'),
              link(home, never, 'anchor'),
              link(home, outside, 'anchor'),
              link(home, url('/logo.png'), 'image'),
              link(home, url('/app.js'), 'script'),
              link(home, home, 'canonical'),
            ],
            [url('/about')]: [
              link(url('/about'), home, 'anchor'),
              link(url('/about'), url('/logo.png'), 'image'),
            ],
            [url('/blog/a')]: [
              link(url('/blog/a'), home, 'anchor'),
              link(url('/blog/a'), home, 'canonical'),
            ],
            [url('/blog/b')]: [link(url('/blog/b'), home, 'anchor-nofollow')],
          }
          for (const [address, outcome] of Object.entries(answered)) {
            await db.crawls.recordResult({
              crawlId: id,
              urlHash: hashOf(address),
              result: outcome,
              links: links[address as keyof typeof links] ?? [],
            })
          }
          // A domain runs one crawl at a time.
          await db.crawls.finish(id, { status: 'completed' })
          return id
        }

        const list = (
          crawlId: string,
          address: string,
          direction: 'in' | 'out',
          options: Partial<Parameters<Database['crawls']['listLinks']>[0]> = {},
        ) =>
          db.crawls.listLinks({
            crawlId,
            urlHash: hashOf(address),
            direction,
            limit: 100,
            offset: 0,
            ...options,
          })
        const pairs = (rows: { url: string; kind: string }[]) =>
          rows.map((row) => `${row.url.replace(site, '')} ${row.kind}`)

        it('lists each direction on its own, by address and then by type', async () => {
          const crawlId = await crawlWithLinks()
          expect(pairs(await list(crawlId, home, 'in'))).toEqual([
            '/ canonical',
            '/about anchor',
            '/blog/a anchor',
            '/blog/a canonical',
            '/blog/b anchor-nofollow',
          ])
          expect(pairs(await list(crawlId, home, 'out'))).toEqual([
            '/ canonical',
            '/about anchor',
            '/app.js script',
            '/blog/a anchor',
            '/blog/b anchor-nofollow',
            '/gone anchor',
            '/logo.png image',
            '/never-requested anchor',
            '/sale/50%_off anchor',
            'https://elsewhere.org/ anchor',
          ])
          expect(pairs(await list(crawlId, url('/logo.png'), 'in'))).toEqual([
            '/ image',
            '/about image',
          ])
          expect(await list(crawlId, url('/logo.png'), 'out')).toEqual([])
          expect(await list(crawlId, 'nope', 'in')).toEqual([])
        })

        it('says what the crawl knows of the URL at the other end, and nothing it does not', async () => {
          const crawlId = await crawlWithLinks()
          const out = await list(crawlId, home, 'out')
          const at = (address: string) => out.find((row) => row.url === address)
          expect(at(url('/gone'))).toMatchObject({
            urlHash: hashOf(url('/gone')),
            scope: 'internal',
            urlKind: 'page',
            state: 'done',
            statusCode: 404,
            error: null,
          })
          expect(at(sale)).toMatchObject({ statusCode: 500, error: 'boom' })
          expect(at(url('/logo.png'))).toMatchObject({ urlKind: 'resource', statusCode: 200 })
          // Linked but never requested, or external and not requested: unknown, not a verdict.
          for (const address of [never, outside]) {
            expect(at(address)).toMatchObject({
              urlKind: 'unknown',
              state: expect.stringMatching(/queued|skipped/),
              statusCode: null,
            })
          }
          expect(at(outside)).toMatchObject({ scope: 'external' })
        })

        it('filters by the types of link, and an empty list of them keeps nothing', async () => {
          const crawlId = await crawlWithLinks()
          expect(pairs(await list(crawlId, home, 'out', { kinds: ['image', 'script'] }))).toEqual([
            '/app.js script',
            '/logo.png image',
          ])
          expect(
            pairs(await list(crawlId, home, 'in', { kinds: ['anchor', 'anchor-nofollow'] })),
          ).toEqual(['/about anchor', '/blog/a anchor', '/blog/b anchor-nofollow'])
          expect(await list(crawlId, home, 'out', { kinds: [] })).toEqual([])
          expect(
            await db.crawls.countLinks({
              crawlId,
              urlHash: hashOf(home),
              direction: 'out',
              kinds: [],
            }),
          ).toBe(0)
        })

        it('searches the other address as text, ignoring case', async () => {
          const crawlId = await crawlWithLinks()
          const search = async (text: string) =>
            pairs(await list(crawlId, home, 'out', { search: text }))
          expect(await search('ABOUT')).toEqual(['/about anchor'])
          expect(await search('/blog/')).toEqual(['/blog/a anchor', '/blog/b anchor-nofollow'])
          // % and _ are characters here, not wildcards.
          expect(await search('50%_')).toEqual(['/sale/50%_off anchor'])
          expect(await search('%')).toEqual(['/sale/50%_off anchor'])
          expect(await search('_')).toEqual(['/sale/50%_off anchor'])
          expect(await search('a!b')).toEqual([])
          expect(await search('')).toHaveLength(10)
          expect(
            await db.crawls.countLinks({
              crawlId,
              urlHash: hashOf(home),
              direction: 'out',
              kinds: ['anchor'],
              search: '/blog/',
            }),
          ).toBe(1)
        })

        it('pages without skipping or repeating a link, and counts what it pages', async () => {
          const crawlId = await crawlWithLinks()
          const query = { crawlId, urlHash: hashOf(home), direction: 'out' as const }
          const everything = await list(crawlId, home, 'out')
          expect(await db.crawls.countLinks(query)).toBe(everything.length)
          const paged = []
          for (let offset = 0; offset < everything.length; offset += 4) {
            paged.push(...(await list(crawlId, home, 'out', { limit: 4, offset })))
          }
          expect(paged).toEqual(everything)
          expect(await list(crawlId, home, 'out', { limit: 4, offset: 40 })).toEqual([])
        })

        it('counts the links of each type in a direction', async () => {
          const crawlId = await crawlWithLinks()
          const counts = async (address: string, direction: 'in' | 'out') =>
            Object.fromEntries(
              (await db.crawls.linkKindCounts(crawlId, hashOf(address), direction)).map(
                ({ kind, count }) => [kind, count],
              ),
            )
          expect(await counts(home, 'in')).toEqual({
            anchor: 2,
            'anchor-nofollow': 1,
            canonical: 2,
          })
          expect(await counts(home, 'out')).toEqual({
            anchor: 6,
            'anchor-nofollow': 1,
            image: 1,
            script: 1,
            canonical: 1,
          })
          expect(await counts(url('/logo.png'), 'out')).toEqual({})
          expect(await db.crawls.linkKindCounts(crawlId, 'nope', 'in')).toEqual([])
        })

        it('keeps one crawl apart from another, and from another domain', async () => {
          const domainId = await domain()
          const first = await crawlWithLinks(domainId)
          const second = await crawlWithLinks(domainId)
          const other = await crawlWithLinks(await domain('other.com'))
          // The same URLs are in every crawl; a link between them is only in the crawl that saw it.
          await db.crawls.recordResult({
            crawlId: second,
            urlHash: hashOf(url('/about')),
            result: result('page'),
            links: [
              {
                sourceHash: hashOf(url('/about')),
                targetHash: hashOf(url('/blog/a')),
                kind: 'anchor',
              },
            ],
          })
          const links = async (crawlId: string) => pairs(await list(crawlId, url('/blog/a'), 'in'))
          expect(await links(first)).toEqual(['/ anchor'])
          expect(await links(second)).toEqual(['/ anchor', '/about anchor'])
          expect(await links(other)).toEqual(['/ anchor'])
          expect(await links('missing')).toEqual([])
          expect(
            await db.crawls.countLinks({
              crawlId: 'missing',
              urlHash: hashOf(home),
              direction: 'in',
            }),
          ).toBe(0)
          expect(await db.crawls.linkKindCounts('missing', hashOf(home), 'in')).toEqual([])
        })
      })

      describe('what checking for issues reads', () => {
        const page = 'https://acme.com/'
        const other = 'https://acme.com/other'

        it('lists the links going out of some URLs', async () => {
          const domainId = await domain()
          const { id } = await startCrawl(domainId)
          await db.crawls.addUrls(id, [newUrl(page), newUrl(other)])
          await db.crawls.recordResult({
            crawlId: id,
            urlHash: crawlUrlHash(page),
            result: result('page'),
            links: [
              {
                sourceHash: crawlUrlHash(page),
                targetHash: crawlUrlHash(other),
                kind: 'anchor-nofollow',
              },
            ],
          })
          await db.crawls.recordResult({
            crawlId: id,
            urlHash: crawlUrlHash(other),
            result: result('page'),
            links: [
              { sourceHash: crawlUrlHash(other), targetHash: crawlUrlHash(page), kind: 'anchor' },
            ],
          })
          expect(await db.crawls.linksFrom(id, [crawlUrlHash(page)])).toEqual([
            {
              sourceHash: crawlUrlHash(page),
              targetHash: crawlUrlHash(other),
              kind: 'anchor-nofollow',
            },
          ])
          expect(await db.crawls.linksFrom(id, [])).toEqual([])
        })

        it('keeps the hreflang of sitemaps, once each, until the crawl is pruned', async () => {
          const domainId = await domain()
          const crawl = await finishedCrawl(domainId)
          const entry = { pageHash: crawlUrlHash(page), lang: 'es', url: `${page}es` }
          await db.crawls.addSitemapHreflang(crawl.id, [
            entry,
            entry,
            { pageHash: crawlUrlHash(other), lang: 'x'.repeat(50), url: `${other}/fr` },
          ])
          await db.crawls.addSitemapHreflang(crawl.id, [entry])
          expect(await db.crawls.sitemapHreflangOf(crawl.id, [crawlUrlHash(page)])).toEqual([entry])
          const [long] = await db.crawls.sitemapHreflangOf(crawl.id, [crawlUrlHash(other)])
          expect(long?.lang).toHaveLength(35)
          expect(await db.crawls.sitemapHreflangOf(crawl.id, [])).toEqual([])

          await finishedCrawl(domainId)
          await db.crawls.prune({ domainId, type: 'full', keep: 1 })
          expect(await db.crawls.sitemapHreflangOf(crawl.id, [crawlUrlHash(page)])).toEqual([])
        })

        it('lists the external URLs that anchors link to until they are requested', async () => {
          const domainId = await domain()
          const { id } = await startCrawl(domainId)
          const linked = 'https://elsewhere.org/linked'
          const nofollow = 'https://elsewhere.org/nofollow'
          const image = 'https://elsewhere.org/image.png'
          await db.crawls.addUrls(id, [newUrl(page)])
          await db.crawls.recordResult({
            crawlId: id,
            urlHash: crawlUrlHash(page),
            result: result('page'),
            urls: [linked, nofollow, image].map((url) => newUrl(url, { scope: 'external' })),
            links: [
              { sourceHash: crawlUrlHash(page), targetHash: crawlUrlHash(linked), kind: 'anchor' },
              // Twice, but only one row is expected.
              { sourceHash: crawlUrlHash(page), targetHash: crawlUrlHash(linked), kind: 'image' },
              {
                sourceHash: crawlUrlHash(page),
                targetHash: crawlUrlHash(nofollow),
                kind: 'anchor-nofollow',
              },
              { sourceHash: crawlUrlHash(page), targetHash: crawlUrlHash(image), kind: 'image' },
            ],
          })

          const pending = await db.crawls.pendingExternalLinks(id, 10)
          expect(pending.map((url) => url.url).sort()).toEqual([linked, nofollow])
          expect(await db.crawls.pendingExternalLinks(id, 1)).toHaveLength(1)

          await db.crawls.recordResult({
            crawlId: id,
            urlHash: crawlUrlHash(linked),
            result: result('unknown', { statusCode: 404 }),
          })
          expect((await db.crawls.pendingExternalLinks(id, 10)).map((url) => url.url)).toEqual([
            nofollow,
          ])
          // Still external, and answering does not make it a page or a URL of the site.
          expect(await db.crawls.countUrls(id)).toMatchObject({ externalCount: 3, urlsCount: 1 })
        })
      })

      describe('page issues', () => {
        it('replaces the issues of a crawl and says how many pages have any', async () => {
          const domainId = await domain()
          const { id } = await startCrawl(domainId)
          expect((await db.crawls.get(id))?.pagesByWorstIssue).toBeNull()

          await saveIssues({
            crawlId: id,
            issues: [
              { urlHash: 'a', issue: 'http-error' },
              { urlHash: 'a', issue: 'missing-title', details: ['x', 'y'] },
              { urlHash: 'a', issue: 'missing-title', details: ['x', 'y'] },
              { urlHash: 'b', issue: 'missing-title' },
            ],
            pages: { issue: 1, warning: 2, opportunity: 3 },
            withType: { issue: 4, warning: 5, opportunity: 6 },
            catalog: 'v1',
          })
          expect((await db.crawls.get(id))?.pagesByWorstIssue).toEqual({
            issue: 1,
            warning: 2,
            opportunity: 3,
          })
          expect((await db.crawls.get(id))?.pagesWithType).toEqual({
            issue: 4,
            warning: 5,
            opportunity: 6,
          })
          expect(
            (await db.crawls.issueCounts(id)).sort((x, y) => x.issue.localeCompare(y.issue)),
          ).toEqual([
            { issue: 'http-error', pages: 1 },
            { issue: 'missing-title', pages: 2 },
          ])
          expect((await db.crawls.issuesOf(id, ['a', 'zzz'])).map((i) => i.issue).sort()).toEqual([
            'http-error',
            'missing-title',
          ])
          expect(await db.crawls.issuesOf(id, [])).toEqual([])
          expect(
            (await db.crawls.issuesOf(id, ['a'])).find((i) => i.issue === 'missing-title'),
          ).toEqual({ urlHash: 'a', issue: 'missing-title', details: ['x', 'y'] })
          expect(
            (await db.crawls.issuesOf(id, ['a'])).find((i) => i.issue === 'http-error'),
          ).toEqual({ urlHash: 'a', issue: 'http-error' })

          // Analysing again replaces the previous result; zero issues is still "analysed".
          await saveIssues({
            crawlId: id,
            issues: [],
            pages: { issue: 0, warning: 0, opportunity: 0 },
            withType: { issue: 0, warning: 0, opportunity: 0 },
            catalog: 'v1',
          })
          expect((await db.crawls.get(id))?.pagesByWorstIssue).toEqual({
            issue: 0,
            warning: 0,
            opportunity: 0,
          })
          expect(await db.crawls.issueCounts(id)).toEqual([])
        })

        it('keeps what rules accept apart from what is pending, and lists it', async () => {
          const domainId = await domain()
          const { id } = await startCrawl(domainId)
          const [urlA, urlB, urlC] = ['a', 'b', 'c'].map((path) => `https://acme.com/${path}`) as [
            string,
            string,
            string,
          ]
          await db.crawls.addUrls(id, [newUrl(urlA), newUrl(urlB), newUrl(urlC)])
          for (const url of [urlA, urlB, urlC]) {
            await db.crawls.recordResult({
              crawlId: id,
              urlHash: crawlUrlHash(url),
              result: result('page'),
            })
          }
          const a = crawlUrlHash(urlA)
          const b = crawlUrlHash(urlB)
          const c = crawlUrlHash(urlC)
          const finding = (urlHash: string, issue: string, acceptedBy: string) => ({
            urlHash,
            issue,
            acceptedBy,
            acceptance: {
              kind: 'relation' as const,
              end: 'destination' as const,
              blockers: ['noindex' as const],
              rules: ['rule-1'],
            },
            evidence: { kind: 'related-urls' as const, total: 1, urls: ['https://acme.com/c'] },
          })
          await saveIssues({
            crawlId: id,
            issues: [{ urlHash: a, issue: 'title-missing' }],
            accepted: [
              finding(a, 'hreflang-noindex', c),
              finding(b, 'hreflang-noindex', c),
              finding(b, 'canonical-not-indexable', c),
              {
                urlHash: c,
                issue: 'noindex',
                acceptedBy: c,
                acceptance: {
                  kind: 'condition',
                  condition: 'noindex',
                  requirement: 'allowed',
                  rule: 'rule-1',
                },
              },
            ],
            pages: { issue: 0, warning: 1, opportunity: 0 },
            withType: { issue: 0, warning: 1, opportunity: 0 },
            catalog: 'v1',
          })

          // What is pending knows nothing of them.
          expect(await db.crawls.issueCounts(id)).toEqual([{ issue: 'title-missing', pages: 1 }])
          expect((await db.crawls.issuesOf(id, [b, c])).length).toBe(0)
          expect(
            (await db.crawls.acceptedCounts(id)).sort((x, y) => x.issue.localeCompare(y.issue)),
          ).toEqual([
            { issue: 'canonical-not-indexable', pages: 1 },
            { issue: 'hreflang-noindex', pages: 2 },
            { issue: 'noindex', pages: 1 },
          ])
          expect(await db.crawls.acceptedOf(id, [a])).toEqual([finding(a, 'hreflang-noindex', c)])

          // Lists: any finding or one, whatever the view; and a URL with several is listed once.
          const listed = async (accepted: string) =>
            (
              await db.crawls.listUrls({
                crawlId: id,
                view: 'pages',
                accepted,
                limit: 10,
                offset: 0,
              })
            )
              .map(({ urlHash }) => urlHash)
              .sort()
          expect(await listed('all')).toEqual([a, b, c].sort())
          expect(await listed('noindex')).toEqual([c])
          expect(await db.crawls.countListed({ crawlId: id, view: 'pages', accepted: 'all' })).toBe(
            3,
          )

          // What a rule of a URL does beyond it: the URL's own finding is not one of them.
          expect(await db.crawls.acceptedBecauseOf(id, c, { limit: 2 })).toEqual({
            total: 3,
            findings: [
              { urlHash: a, url: urlA, issue: 'hreflang-noindex' },
              { urlHash: b, url: urlB, issue: 'canonical-not-indexable' },
            ],
          })
          expect((await db.crawls.acceptedBecauseOf(id, a, { limit: 2 })).total).toBe(0)

          // A history tells them apart from what the crawl reported.
          const [trace] = await db.crawls.urlHistory({ domainId, crawlIds: [id], urlHashes: [c] })
          expect(trace).toMatchObject({ issues: [], accepted: ['noindex'] })

          // Analysing again replaces them.
          await saveIssues({
            crawlId: id,
            issues: [],
            pages: { issue: 0, warning: 0, opportunity: 0 },
            withType: { issue: 0, warning: 0, opportunity: 0 },
            catalog: 'v1',
          })
          expect(await db.crawls.acceptedCounts(id)).toEqual([])
        })

        it('keeps the evidence of a finding next to what it details', async () => {
          const domainId = await domain()
          const { id } = await startCrawl(domainId)
          const images = {
            kind: 'images' as const,
            total: 12,
            items: [{ src: '/a.png', url: 'https://acme.com/a.png', id: 'logo' }],
          }
          const related = {
            kind: 'related-urls' as const,
            total: 40,
            atLeast: true as const,
            urls: ['https://acme.com/b', 'https://acme.com/c'],
          }
          await saveIssues({
            crawlId: id,
            issues: [
              { urlHash: 'a', issue: 'img-no-alt', evidence: images },
              { urlHash: 'a', issue: 'title-duplicate', evidence: related },
              // With and without details, as findings written before evidence existed are.
              { urlHash: 'a', issue: 'missing-security-header', details: ['Referrer-Policy'] },
              { urlHash: 'a', issue: 'noindex' },
              { urlHash: 'a', issue: 'both', details: ['x'], evidence: images },
            ],
            pages: { issue: 1, warning: 0, opportunity: 0 },
            withType: { issue: 1, warning: 0, opportunity: 0 },
            catalog: 'v1',
          })
          const stored = new Map(
            (await db.crawls.issuesOf(id, ['a'])).map((row) => [row.issue, row]),
          )
          expect(stored.get('img-no-alt')).toEqual({
            urlHash: 'a',
            issue: 'img-no-alt',
            evidence: images,
          })
          expect(stored.get('title-duplicate')?.evidence).toEqual(related)
          expect(stored.get('missing-security-header')).toEqual({
            urlHash: 'a',
            issue: 'missing-security-header',
            details: ['Referrer-Policy'],
          })
          expect(stored.get('noindex')).toEqual({ urlHash: 'a', issue: 'noindex' })
          expect(stored.get('both')).toEqual({
            urlHash: 'a',
            issue: 'both',
            details: ['x'],
            evidence: images,
          })
        })

        it('keeps the count of a pruned crawl but not its issues', async () => {
          const domainId = await domain()
          const oldest = await finishedCrawl(domainId)
          const newest = await finishedCrawl(domainId)
          for (const crawl of [oldest, newest]) {
            await saveIssues({
              crawlId: crawl.id,
              issues: [{ urlHash: crawlUrlHash('https://acme.com/'), issue: 'missing-title' }],
              accepted: [
                {
                  urlHash: crawlUrlHash('https://acme.com/'),
                  issue: 'noindex',
                  acceptedBy: crawlUrlHash('https://acme.com/'),
                  acceptance: { kind: 'expectation', rule: null },
                },
              ],
              pages: { issue: 1, warning: 0, opportunity: 0 },
              withType: { issue: 1, warning: 0, opportunity: 0 },
              catalog: 'v1',
            })
          }

          expect(await db.crawls.prune({ domainId, type: 'full', keep: 1 })).toBe(1)
          expect(await db.crawls.get(oldest.id)).toMatchObject({
            pruned: true,
            pagesByWorstIssue: { issue: 1, warning: 0, opportunity: 0 },
          })
          expect(await db.crawls.issueCounts(oldest.id)).toEqual([])
          expect(await db.crawls.acceptedCounts(oldest.id)).toEqual([])
          expect(await db.crawls.acceptedCounts(newest.id)).toEqual([
            { issue: 'noindex', pages: 1 },
          ])
          expect(await db.crawls.issueCounts(newest.id)).toEqual([
            { issue: 'missing-title', pages: 1 },
          ])
        })

        it('finds the analyses made with another version of the catalog', async () => {
          const domainId = await domain()
          // The oldest is the one that pruning removes the results of.
          const pruned = await finishedCrawl(domainId)
          const old = await finishedCrawl(domainId)
          const current = await finishedCrawl(domainId)
          const unanalysed = await finishedCrawl(domainId)
          const pages = { issue: 0, warning: 0, opportunity: 0 }
          await saveIssues({
            crawlId: old.id,
            issues: [],
            pages,
            withType: pages,
            catalog: 'v1',
          })
          await saveIssues({
            crawlId: current.id,
            issues: [],
            pages,
            withType: pages,
            catalog: 'v2',
          })
          await saveIssues({
            crawlId: pruned.id,
            issues: [],
            pages,
            withType: pages,
            catalog: 'v1',
          })
          expect((await db.crawls.get(old.id))?.issueCatalog).toBe('v1')
          expect((await db.crawls.get(unanalysed.id))?.issueCatalog).toBeNull()
          expect(await db.crawls.prune({ domainId, type: 'full', keep: 3 })).toBe(1)

          // Not the current one, nor one never analysed, nor one whose results are gone.
          const ids = (await db.crawls.outdatedAnalyses('v2', 10)).map((crawl) => crawl.id)
          expect(ids).not.toContain(current.id)
          expect(ids).not.toContain(unanalysed.id)
          expect(ids).toContain(old.id)
          expect(ids).not.toContain(pruned.id)
          expect(await db.crawls.outdatedAnalyses('v2', 0)).toEqual([])

          await saveIssues({
            crawlId: old.id,
            issues: [],
            pages,
            withType: pages,
            catalog: 'v2',
          })
          expect(
            (await db.crawls.outdatedAnalyses('v2', 10)).map((crawl) => crawl.id),
          ).not.toContain(old.id)
        })

        it('lists the crawls of one type', async () => {
          const domainId = await domain()
          const full = await finishedCrawl(domainId)
          const priority = await startCrawl(domainId, 'priority')
          await db.crawls.finish(priority.id, { status: 'completed' })

          expect((await db.crawls.list(domainId)).map((c) => c.id).sort()).toEqual(
            [full.id, priority.id].sort(),
          )
          expect((await db.crawls.list(domainId, { type: 'full' })).map((c) => c.id)).toEqual([
            full.id,
          ])
        })
      })

      describe('audit rules and exceptions', () => {
        const prefixRule = (
          path: string,
          value: 'exclude' | 'include' = 'exclude',
          extra: { enabled?: boolean; reason?: string | null } = {},
        ) => ({
          dimension: 'audit' as const,
          value,
          selector: {
            kind: 'prefix' as const,
            path,
            query: { mode: 'any' as const },
            scope: 'literal' as const,
          },
          reason: extra.reason ?? null,
          enabled: extra.enabled ?? true,
        })
        const intentRule = (path: string, value: 'indexable' | 'not-indexable') => ({
          dimension: 'intent' as const,
          value,
          selector: {
            kind: 'path' as const,
            path,
            query: { mode: 'exact' as const, value: '' },
            scope: 'literal' as const,
          },
          reason: null,
          enabled: true,
        })
        const recomputeJobs = async () =>
          (await db.jobs.list({ status: 'pending', limit: 100 })).filter(
            (job) => job.type === JOB_TYPES.auditRecompute,
          )

        it('starts at version 0, with no rules', async () => {
          const domainId = await domain()
          expect(await db.audit.config(domainId)).toEqual({
            version: 0,
            rules: [],
            languages: { prefixes: [], unprefixed: false },
            recomputeError: null,
          })
        })

        it('creates, edits, switches and deletes rules, moving the version for each change', async () => {
          const domainId = await domain()
          const created = await db.audit.saveRule({
            domainId,
            rule: prefixRule('/cart', 'exclude', { reason: 'The cart' }),
          })
          expect(created).toMatchObject({ ok: true, version: 1, changed: true })
          const id = created.ok ? created.rule!.id : ''
          const [stored] = (await db.audit.config(domainId)).rules
          expect(stored).toMatchObject({
            id,
            domainId,
            dimension: 'audit',
            value: 'exclude',
            selector: { kind: 'prefix', path: '/cart', query: { mode: 'any' } },
            reason: 'The cart',
            enabled: true,
          })

          expect(
            await db.audit.saveRule({
              domainId,
              id,
              rule: prefixRule('/cart', 'exclude', { reason: 'The cart' }),
            }),
          ).toMatchObject({ ok: true, version: 1, changed: false })
          expect(
            await db.audit.saveRule({ domainId, id, rule: prefixRule('/basket', 'exclude') }),
          ).toMatchObject({ ok: true, version: 2, changed: true })
          expect(await db.audit.setRuleEnabled({ domainId, id, enabled: false })).toMatchObject({
            ok: true,
            version: 3,
          })
          expect(await db.audit.setRuleEnabled({ domainId, id, enabled: false })).toMatchObject({
            ok: true,
            version: 3,
            changed: false,
          })
          expect(await db.audit.setRuleEnabled({ domainId, id, enabled: true })).toMatchObject({
            ok: true,
            version: 4,
          })
          expect((await db.audit.config(domainId)).rules[0]).toMatchObject({
            selector: { path: '/basket' },
            enabled: true,
          })
          expect(await db.audit.deleteRule({ domainId, id })).toMatchObject({
            ok: true,
            version: 5,
          })
          expect(await db.audit.config(domainId)).toMatchObject({ version: 5, rules: [] })
          expect(await db.audit.deleteRule({ domainId, id })).toEqual({
            ok: false,
            error: 'not-found',
          })
          expect(
            await db.audit.saveRule({ domainId, id: 'missing', rule: prefixRule('/x') }),
          ).toEqual({ ok: false, error: 'not-found' })
        })

        it('round-trips every kind of selector, the empty query included', async () => {
          const domainId = await domain()
          const selectors = [
            { kind: 'url' as const, url: 'https://acme.com/a?b=1&a=2' },
            {
              kind: 'path' as const,
              path: '/a',
              query: { mode: 'any' as const },
              scope: 'literal' as const,
            },
            {
              kind: 'path' as const,
              path: '/a',
              query: { mode: 'exact' as const, value: '' },
              scope: 'literal' as const,
            },
            {
              kind: 'prefix' as const,
              path: '/a',
              query: { mode: 'exact' as const, value: 'x=1&x=1' },
              scope: 'shared' as const,
            },
            {
              kind: 'prefix' as const,
              path: '/',
              query: { mode: 'any' as const },
              scope: 'literal' as const,
            },
          ]
          for (const selector of selectors) {
            const saved = await db.audit.saveRule({
              domainId,
              rule: { dimension: 'audit', value: 'exclude', selector, reason: null, enabled: true },
            })
            expect(saved.ok).toBe(true)
          }
          const stored = (await db.audit.config(domainId)).rules.map((rule) => rule.selector)
          expect(stored).toHaveLength(selectors.length)
          expect(stored).toEqual(expect.arrayContaining(selectors))
        })

        it('refuses two enabled rules of a dimension with the same selector', async () => {
          const domainId = await domain()
          const first = await db.audit.saveRule({ domainId, rule: prefixRule('/cart') })
          expect(first.ok).toBe(true)
          expect(
            await db.audit.saveRule({ domainId, rule: prefixRule('/cart', 'include') }),
          ).toEqual({
            ok: false,
            error: 'conflict',
          })
          // Another dimension, another query, another kind of selector: all different.
          expect(
            (await db.audit.saveRule({ domainId, rule: intentRule('/cart', 'indexable') })).ok,
          ).toBe(true)
          expect(
            (
              await db.audit.saveRule({
                domainId,
                rule: {
                  ...prefixRule('/cart'),
                  selector: {
                    kind: 'prefix',
                    path: '/cart',
                    query: { mode: 'exact', value: 'a=1' },
                    scope: 'literal',
                  },
                },
              })
            ).ok,
          ).toBe(true)
          expect(
            (
              await db.audit.saveRule({
                domainId,
                rule: {
                  ...prefixRule('/cart'),
                  selector: {
                    kind: 'path',
                    path: '/cart',
                    query: { mode: 'any' },
                    scope: 'literal',
                  },
                },
              })
            ).ok,
          ).toBe(true)
        })

        it('lets a disabled rule share a selector, until someone enables it', async () => {
          const domainId = await domain()
          await db.audit.saveRule({ domainId, rule: prefixRule('/cart') })
          const off = await db.audit.saveRule({
            domainId,
            rule: prefixRule('/cart', 'include', { enabled: false }),
          })
          expect(off.ok).toBe(true)
          const id = off.ok ? off.rule!.id : ''
          expect(await db.audit.setRuleEnabled({ domainId, id, enabled: true })).toEqual({
            ok: false,
            error: 'conflict',
          })
          expect(
            await db.audit.saveRule({ domainId, id, rule: prefixRule('/cart', 'include') }),
          ).toEqual({ ok: false, error: 'conflict' })
          // Editing it into a selector nobody has is fine.
          expect(
            (await db.audit.saveRule({ domainId, id, rule: prefixRule('/other', 'include') })).ok,
          ).toBe(true)
        })

        it('lets exactly one of several concurrent identical rules in', async () => {
          const domainId = await domain()
          const outcomes = await Promise.all(
            Array.from({ length: 6 }, () =>
              db.audit.saveRule({ domainId, rule: prefixRule('/cart') }),
            ),
          )
          expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
          expect(outcomes.filter((outcome) => !outcome.ok)).toEqual(
            Array(5).fill({ ok: false, error: 'conflict' }),
          )
          const config = await db.audit.config(domainId)
          expect(config.rules).toHaveLength(1)
          expect(config.version).toBe(1)
        })

        it('counts every concurrent change, none lost and none counted twice', async () => {
          const domainId = await domain()
          const writes = Array.from({ length: 12 }, (_, i) =>
            db.audit.saveRule({ domainId, rule: prefixRule(`/section-${i}`) }),
          )
          const reads = Array.from({ length: 12 }, () => db.audit.config(domainId))
          const [outcomes, configs] = await Promise.all([Promise.all(writes), Promise.all(reads)])
          expect(outcomes.every((outcome) => outcome.ok)).toBe(true)
          expect(
            outcomes.map((outcome) => (outcome.ok ? outcome.version : 0)).sort((a, b) => a - b),
          ).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
          // Whatever it caught in the middle, a version never stands for fewer rules than it names.
          for (const config of configs)
            expect(config.rules.length).toBeGreaterThanOrEqual(config.version)
          expect(await db.audit.config(domainId)).toMatchObject({ version: 12 })
        })

        it('limits the rules of a domain', async () => {
          const domainId = await domain()
          const urls = Array.from(
            { length: AUDIT_LIMITS.rulesPerDomain },
            (_, i) => `https://acme.com/p${i}`,
          )
          expect(
            await db.audit.setUrlConfig({
              host: 'acme.com',
              domainId,
              urls,
              audit: 'exclude',
              reason: null,
            }),
          ).toMatchObject({
            ok: true,
          })
          expect(await db.audit.saveRule({ domainId, rule: prefixRule('/one-more') })).toEqual({
            ok: false,
            error: 'limit',
          })
          expect(
            await db.audit.setUrlConfig({
              host: 'acme.com',
              domainId,
              urls: ['https://acme.com/one-more'],
              audit: 'exclude',
              reason: null,
            }),
          ).toEqual({ ok: false, error: 'limit' })
          // Changing what exists is not adding.
          expect(
            await db.audit.setUrlConfig({
              host: 'acme.com',
              domainId,
              urls: urls.slice(0, 5),
              audit: 'include',
              reason: null,
            }),
          ).toMatchObject({ ok: true, changed: true })
          expect((await db.audit.config(domainId)).rules).toHaveLength(AUDIT_LIMITS.rulesPerDomain)
        })

        it('keeps each domain to its own rules', async () => {
          const acme = await domain('acme.com')
          const other = await domain('other.com')
          const mine = await db.audit.saveRule({ domainId: acme, rule: prefixRule('/cart') })
          const id = mine.ok ? mine.rule!.id : ''
          // The same selector is a different rule in another domain.
          expect((await db.audit.saveRule({ domainId: other, rule: prefixRule('/cart') })).ok).toBe(
            true,
          )
          expect((await db.audit.config(acme)).rules).toHaveLength(1)
          expect((await db.audit.config(other)).rules).toHaveLength(1)
          expect((await db.audit.config(other)).rules[0]!.id).not.toBe(id)

          // Nobody can reach a rule of another domain by its id.
          expect(await db.audit.deleteRule({ domainId: other, id })).toEqual({
            ok: false,
            error: 'not-found',
          })
          expect(await db.audit.setRuleEnabled({ domainId: other, id, enabled: false })).toEqual({
            ok: false,
            error: 'not-found',
          })
          expect(await db.audit.saveRule({ domainId: other, id, rule: prefixRule('/x') })).toEqual({
            ok: false,
            error: 'not-found',
          })
          expect((await db.audit.config(acme)).rules[0]).toMatchObject({ id, enabled: true })
          expect((await db.audit.config(acme)).version).toBe(1)
        })

        it('sets what is declared for exact URLs with one version, and inherits by removing it', async () => {
          const domainId = await domain()
          const a = 'https://acme.com/cart'
          const b = 'https://acme.com/checkout'
          expect(
            await db.audit.setUrlConfig({
              host: 'acme.com',
              domainId,
              urls: [a, b, a],
              audit: 'exclude',
              intent: 'not-indexable',
              reason: 'Transactional',
            }),
          ).toMatchObject({ ok: true, version: 1, changed: true })
          let rules = (await db.audit.config(domainId)).rules
          expect(rules).toHaveLength(4)
          expect(
            rules.every((rule) => rule.selector.kind === 'url' && rule.reason === 'Transactional'),
          ).toBe(true)

          // The same again changes nothing, and does not move the version.
          expect(
            await db.audit.setUrlConfig({
              host: 'acme.com',
              domainId,
              urls: [a, b],
              audit: 'exclude',
              intent: 'not-indexable',
              reason: 'Transactional',
            }),
          ).toMatchObject({ ok: true, version: 1, changed: false })

          // Changing a value replaces the rule instead of adding another; a dimension left out stays.
          await db.audit.setUrlConfig({
            host: 'acme.com',
            domainId,
            urls: [a],
            audit: 'include',
            reason: null,
          })
          rules = (await db.audit.config(domainId)).rules
          expect(rules).toHaveLength(4)
          expect(
            rules.find(
              (rule) =>
                rule.dimension === 'audit' &&
                rule.selector.kind === 'url' &&
                rule.selector.url === a,
            ),
          ).toMatchObject({
            value: 'include',
            reason: null,
          })
          expect(
            rules.find(
              (rule) =>
                rule.dimension === 'intent' &&
                rule.selector.kind === 'url' &&
                rule.selector.url === a,
            ),
          ).toMatchObject({
            value: 'not-indexable',
            reason: 'Transactional',
          })

          // Inheriting removes only that dimension's rule for that URL.
          await db.audit.setUrlConfig({
            host: 'acme.com',
            domainId,
            urls: [a],
            audit: 'inherit',
            reason: null,
          })
          rules = (await db.audit.config(domainId)).rules
          expect(rules).toHaveLength(3)
          expect(
            rules.some(
              (rule) =>
                rule.dimension === 'audit' &&
                rule.selector.kind === 'url' &&
                rule.selector.url === a,
            ),
          ).toBe(false)
          // Inheriting what was never set is nothing.
          expect(
            await db.audit.setUrlConfig({
              host: 'acme.com',
              domainId,
              urls: [a],
              audit: 'inherit',
              reason: null,
            }),
          ).toMatchObject({ ok: true, changed: false })

          // A rule that was switched off is back on when the URL is set again.
          const off = rules.find((rule) => rule.dimension === 'audit')!
          await db.audit.setRuleEnabled({ domainId, id: off.id, enabled: false })
          await db.audit.setUrlConfig({
            host: 'acme.com',
            domainId,
            urls: [b],
            audit: 'exclude',
            reason: 'Transactional',
          })
          expect(
            (await db.audit.config(domainId)).rules.find((rule) => rule.id === off.id)?.enabled,
          ).toBe(true)
        })

        describe('asking for the latest crawl to be analysed again', () => {
          it('does not, when there is no crawl with results', async () => {
            const domainId = await domain()
            await db.audit.saveRule({ domainId, rule: prefixRule('/cart') })
            expect(await recomputeJobs()).toEqual([])
            // A priority crawl is not the one that says what the site is like.
            const priority = await startCrawl(domainId, 'priority')
            await db.crawls.finish(priority.id, { status: 'completed' })
            await db.audit.saveRule({ domainId, rule: prefixRule('/basket') })
            expect(await recomputeJobs()).toEqual([])
            // Nor one still running, or one that failed.
            const failed = await startCrawl(domainId)
            await db.crawls.finish(failed.id, { status: 'failed', error: 'x' })
            await db.audit.saveRule({ domainId, rule: prefixRule('/shop') })
            expect(await recomputeJobs()).toEqual([])
          })

          it('queues one job for the domain, however many changes wait for it', async () => {
            const domainId = await domain()
            const other = await domain('other.com')
            await finishedCrawl(domainId)
            await finishedCrawl(other, 'https://other.com/')
            await db.audit.saveRule({ domainId, rule: prefixRule('/cart') })
            await db.audit.saveRule({ domainId, rule: prefixRule('/basket') })
            await db.audit.setUrlConfig({
              host: 'acme.com',
              domainId,
              urls: ['https://acme.com/a'],
              audit: 'exclude',
              reason: null,
            })
            await db.audit.saveRule({ domainId: other, rule: prefixRule('/cart') })
            const jobs = await recomputeJobs()
            expect(
              jobs
                .map((job) => job.payload)
                .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
            ).toEqual(
              [{ domainId }, { domainId: other }].sort((x, y) =>
                JSON.stringify(x).localeCompare(JSON.stringify(y)),
              ),
            )
          })

          it('queues a new one for a change made while the last is running', async () => {
            const domainId = await domain()
            await finishedCrawl(domainId)
            await db.audit.saveRule({ domainId, rule: prefixRule('/cart') })
            const [claimed] = await db.jobs.claim({
              workerId: 'w1',
              limit: 1,
              types: [JOB_TYPES.auditRecompute],
            })
            expect(claimed).toBeDefined()
            expect(await recomputeJobs()).toEqual([])
            await db.audit.saveRule({ domainId, rule: prefixRule('/basket') })
            expect(await recomputeJobs()).toHaveLength(1)
          })

          it('writes the rules, the version and the job together or not at all', async () => {
            const domainId = await domain()
            await finishedCrawl(domainId)
            await db.audit.saveRule({ domainId, rule: prefixRule('/cart') })
            // A refused change leaves no trace: no version, no job.
            await db.jobs.claim({ workerId: 'w1', limit: 10, types: [JOB_TYPES.auditRecompute] })
            expect(await db.audit.saveRule({ domainId, rule: prefixRule('/cart') })).toEqual({
              ok: false,
              error: 'conflict',
            })
            expect((await db.audit.config(domainId)).version).toBe(1)
            expect(await recomputeJobs()).toEqual([])
          })
        })

        it('records a failed recalculation, until someone asks again or the rules change', async () => {
          const domainId = await domain()
          await finishedCrawl(domainId)
          await db.audit.saveRule({ domainId, rule: prefixRule('/cart') })
          await db.jobs.claim({ workerId: 'w1', limit: 10, types: [JOB_TYPES.auditRecompute] })

          await db.audit.failRecompute({ domainId, version: 1, error: 'boom' })
          expect((await db.audit.config(domainId)).recomputeError).toEqual({
            message: 'boom',
            version: 1,
          })

          // A failure for a version the rules have left behind says nothing about the current one.
          await db.audit.saveRule({ domainId, rule: prefixRule('/basket') })
          expect((await db.audit.config(domainId)).recomputeError).toBeNull()
          await db.audit.failRecompute({ domainId, version: 1, error: 'late' })
          expect((await db.audit.config(domainId)).recomputeError).toBeNull()

          await db.audit.failRecompute({ domainId, version: 2, error: 'again' })
          await db.jobs.claim({ workerId: 'w1', limit: 10, types: [JOB_TYPES.auditRecompute] })
          await db.audit.retryRecompute(domainId)
          expect((await db.audit.config(domainId)).recomputeError).toBeNull()
          expect(await recomputeJobs()).toHaveLength(1)
          // Asking twice does not queue twice.
          await db.audit.retryRecompute(domainId)
          expect(await recomputeJobs()).toHaveLength(1)

          await db.audit.failRecompute({ domainId, version: 2, error: 'and again' })
          await db.audit.clearRecomputeFailure({ domainId, version: 2 })
          expect((await db.audit.config(domainId)).recomputeError).toBeNull()
        })

        it('survives the crawls, and the removal of their results', async () => {
          const domainId = await domain()
          const old = await finishedCrawl(domainId)
          await db.audit.saveRule({
            domainId,
            rule: prefixRule('/cart', 'exclude', { reason: 'Cart' }),
          })
          const config = await db.audit.config(domainId)
          const hash = crawlUrlHash('https://acme.com/')
          await saveIssues({
            crawlId: old.id,
            issues: [],
            pages: { issue: 0, warning: 0, opportunity: 0 },
            withType: { issue: 0, warning: 0, opportunity: 0 },
            catalog: 'v1',
            audit: {
              snapshot: { version: config.version, rules: config.rules },
              pages: {
                audited: 1,
                excluded: 0,
                indexable: 1,
                notIndexable: 0,
                unknownIndexability: 0,
              },
              urls: [
                {
                  urlHash: hash,
                  participation: 'audited',
                  participationRule: null,
                  intent: 'indexable',
                  intentRule: null,
                  conditions: {},
                  indexability: 'indexable',
                  blockers: [],
                },
              ],
            },
          })
          await finishedCrawl(domainId)
          expect(await db.crawls.prune({ domainId, type: 'full', keep: 1 })).toBe(1)

          // The rules are untouched by new crawls and by pruning.
          expect((await db.audit.config(domainId)).rules).toHaveLength(1)
          // The old crawl keeps what it concluded and the configuration it used, but not its URLs.
          expect(await db.crawls.get(old.id)).toMatchObject({
            pruned: true,
            auditVersion: 1,
            pagesAudit: {
              audited: 1,
              excluded: 0,
              indexable: 1,
              notIndexable: 0,
              unknownIndexability: 0,
            },
            auditSnapshot: { version: 1, rules: [expect.objectContaining({ reason: 'Cart' })] },
          })
          expect(await db.crawls.auditOf(old.id, [hash])).toEqual([])
        })

        it('removes the rules of a domain with the domain, not those of another', async () => {
          const acme = await domain('acme.com')
          const other = await domain('other.com')
          await db.audit.saveRule({ domainId: acme, rule: prefixRule('/cart') })
          await db.audit.saveRule({ domainId: other, rule: prefixRule('/cart') })
          expect((await db.audit.config(other)).rules).toHaveLength(1)
        })
      })

      describe('scopes, nofollow and language directories', () => {
        const LANGS = { prefixes: ['/ca', '/en', '/es'], unprefixed: true }
        const recomputeJobs = async () =>
          (await db.jobs.list({ status: 'pending', limit: 100 })).filter(
            (job) => job.type === JOB_TYPES.auditRecompute,
          )
        const rule = (
          dimension: string,
          value: string,
          path: string,
          options: {
            kind?: 'path' | 'prefix'
            scope?: 'literal' | 'shared'
            enabled?: boolean
          } = {},
        ) =>
          ({
            dimension,
            value,
            selector: {
              kind: options.kind ?? 'prefix',
              path,
              query: { mode: 'any' },
              scope: options.scope ?? 'literal',
            },
            reason: null,
            enabled: options.enabled ?? true,
          }) as Parameters<Database['audit']['saveRule']>[0]['rule']
        const exceptionOf = async (domainId: string, dimension: string, url: string) =>
          (await db.audit.config(domainId)).rules.find(
            (r) => r.dimension === dimension && r.selector.kind === 'url' && r.selector.url === url,
          )
        const URL_A = 'https://acme.com/es/cart'
        const urlException = (value: 'exclude' | 'include', enabled: boolean) =>
          ({
            dimension: 'audit',
            value,
            selector: { kind: 'url', url: URL_A },
            reason: null,
            enabled,
          }) as Parameters<Database['audit']['saveRule']>[0]['rule']

        it('keeps a shared rule and a literal one for the same path apart, and returns both', async () => {
          const domainId = await domain()
          const literal = await db.audit.saveRule({
            domainId,
            rule: rule('audit', 'exclude', '/cart'),
          })
          const sharedRule = await db.audit.saveRule({
            domainId,
            rule: rule('audit', 'exclude', '/cart', { scope: 'shared' }),
          })
          expect(literal.ok && sharedRule.ok).toBe(true)
          // The same scope again is the same selector.
          expect(
            await db.audit.saveRule({
              domainId,
              rule: rule('audit', 'include', '/cart', { scope: 'shared' }),
            }),
          ).toEqual({ ok: false, error: 'conflict' })
          const rules = (await db.audit.config(domainId)).rules
          expect(
            rules.map((r) => (r.selector.kind === 'url' ? 'url' : r.selector.scope)).sort(),
          ).toEqual(['literal', 'shared'])
        })

        it('stores a rule for each condition, apart from the others that share its selector', async () => {
          const domainId = await domain()
          const values = {
            audit: 'exclude',
            intent: 'not-indexable',
            noindex: 'required',
            nofollow: 'allowed',
            robots: 'forbidden',
            sitemap: 'required',
          }
          for (const [dimension, value] of Object.entries(values)) {
            expect(
              await db.audit.saveRule({ domainId, rule: rule(dimension, value, '/a') }),
            ).toMatchObject({ ok: true, changed: true })
          }
          const stored = (await db.audit.config(domainId)).rules
          expect(stored.map((r) => `${r.dimension}=${r.value}`).sort()).toEqual([
            'audit=exclude',
            'intent=not-indexable',
            'nofollow=allowed',
            'noindex=required',
            'robots=forbidden',
            'sitemap=required',
          ])
          // A condition says nothing about the retired flag of the expectation, which is always off.
          expect(stored.find((r) => r.dimension === 'noindex')).not.toHaveProperty('acceptNofollow')
          expect(stored.find((r) => r.dimension === 'intent')).toMatchObject({
            acceptNofollow: false,
          })
          // The same condition for the same selector is the same rule, enabled; a disabled one is not.
          expect(
            await db.audit.saveRule({ domainId, rule: rule('noindex', 'forbidden', '/a') }),
          ).toEqual({ ok: false, error: 'conflict' })
          expect(
            await db.audit.saveRule({
              domainId,
              rule: rule('noindex', 'forbidden', '/a', { enabled: false }),
            }),
          ).toMatchObject({ ok: true })
        })

        describe('what the table and the detail set for exact URLs', () => {
          const exceptions = async (domainId: string) =>
            (await db.audit.config(domainId)).rules
              .filter((r) => r.selector.kind === 'url')
              .map((r) => `${r.dimension}=${r.value}`)
              .sort()
          const set = (domainId: string, change: Record<string, unknown>) =>
            db.audit.setUrlConfig({
              host: 'acme.com',
              domainId,
              urls: [URL_A],
              ...change,
            } as Parameters<Database['audit']['setUrlConfig']>[0])

          it('states each statement as a row of its own, and removes only the one set back to the rules', async () => {
            const domainId = await domain()
            expect(
              await set(domainId, {
                audit: 'exclude',
                intent: 'not-indexable',
                conditions: { noindex: 'required', nofollow: 'allowed', sitemap: 'forbidden' },
                reason: 'Cart',
              }),
            ).toMatchObject({ ok: true, changed: true })
            expect(await exceptions(domainId)).toEqual([
              'audit=exclude',
              'intent=not-indexable',
              'nofollow=allowed',
              'noindex=required',
              'sitemap=forbidden',
            ])
            await set(domainId, { conditions: { noindex: 'inherit' } })
            expect(await exceptionOf(domainId, 'noindex', URL_A)).toBeUndefined()
            expect(await exceptionOf(domainId, 'nofollow', URL_A)).toMatchObject({
              value: 'allowed',
              reason: 'Cart',
            })
            await set(domainId, { audit: 'inherit' })
            expect(await exceptionOf(domainId, 'audit', URL_A)).toBeUndefined()
            expect(await exceptions(domainId)).toEqual([
              'intent=not-indexable',
              'nofollow=allowed',
              'sitemap=forbidden',
            ])
            await set(domainId, {
              intent: 'inherit',
              conditions: { nofollow: 'inherit', sitemap: 'inherit' },
            })
            expect(await exceptions(domainId)).toEqual([])
          })

          it('never states, resets or copies a statement it was not given', async () => {
            const domainId = await domain()
            // The URL is covered by rules for the expectation and for the nofollow.
            await db.audit.setLanguages({ domainId, languages: LANGS })
            await db.audit.saveRule({ domainId, rule: rule('intent', 'not-indexable', '/es') })
            await db.audit.saveRule({ domainId, rule: rule('nofollow', 'allowed', '/es') })
            await set(domainId, { conditions: { nofollow: 'forbidden' } })
            // One row, for one condition: the expectation is not pinned, nor the other conditions.
            expect(await exceptions(domainId)).toEqual(['nofollow=forbidden'])
            const config = await db.audit.config(domainId)
            const found = compileAuditRules(config.rules, 'acme.com', {
              languages: config.languages,
            }).resolve(URL_A)
            expect(found.conditions.nofollow.requirement).toBe('forbidden')
            expect(found.intent).toMatchObject({ value: 'not-indexable' })
            // Later changes to the rules still reach what the exception does not state.
            const broad = config.rules.find((r) => r.dimension === 'intent')!
            await db.audit.saveRule({
              domainId,
              id: broad.id,
              rule: rule('intent', 'indexable', '/es'),
            })
            const later = await db.audit.config(domainId)
            expect(
              compileAuditRules(later.rules, 'acme.com', { languages: later.languages }).resolve(
                URL_A,
              ).intent.value,
            ).toBe('indexable')
          })

          it('does not touch what the change does not name', async () => {
            const domainId = await domain()
            await set(domainId, {
              audit: 'exclude',
              intent: 'not-indexable',
              conditions: { robots: 'required' },
              reason: 'Because',
            })
            const before = await exceptionOf(domainId, 'audit', URL_A)
            await set(domainId, { intent: 'indexable' })
            expect(await exceptionOf(domainId, 'audit', URL_A)).toEqual(before)
            expect(await exceptionOf(domainId, 'intent', URL_A)).toMatchObject({
              value: 'indexable',
              reason: 'Because',
            })
            expect(await exceptionOf(domainId, 'robots', URL_A)).toMatchObject({
              value: 'required',
              reason: 'Because',
            })
            // A reason is only replaced when one is given.
            await set(domainId, { audit: 'include' })
            expect(await exceptionOf(domainId, 'audit', URL_A)).toMatchObject({
              value: 'include',
              reason: 'Because',
            })
            await set(domainId, { audit: 'include', reason: null })
            expect(await exceptionOf(domainId, 'audit', URL_A)).toMatchObject({ reason: null })
          })

          it('changes nothing, and moves nothing, when it asks for what is already there', async () => {
            const domainId = await domain()
            await set(domainId, { conditions: { sitemap: 'required' }, reason: 'x' })
            const version = (await db.audit.config(domainId)).version
            expect(await set(domainId, { conditions: { sitemap: 'required' } })).toMatchObject({
              ok: true,
              changed: false,
              version,
            })
            // An exception that is not there cannot be removed.
            expect(await set(domainId, { conditions: { noindex: 'inherit' } })).toMatchObject({
              changed: false,
            })
          })

          it('does not use a disabled exception, and replaces or removes it when asked', async () => {
            const domainId = await domain()
            await db.audit.saveRule({ domainId, rule: urlException('exclude', false) })
            const disabled = await exceptionOf(domainId, 'audit', URL_A)
            expect(disabled).toMatchObject({ enabled: false })
            // Choosing a value turns the same exception on, instead of adding a second one.
            await set(domainId, { audit: 'exclude' })
            expect(await exceptionOf(domainId, 'audit', URL_A)).toMatchObject({
              id: disabled!.id,
              enabled: true,
            })
            // With an enabled one next to a disabled one, a change goes to the one that acts.
            await db.audit.saveRule({ domainId, rule: urlException('include', false) })
            await set(domainId, { audit: 'include' })
            const audit = (await db.audit.config(domainId)).rules.filter(
              (r) => r.dimension === 'audit' && r.selector.kind === 'url',
            )
            expect(audit.filter((r) => r.enabled).map((r) => r.value)).toEqual(['include'])
            // Back to the rules removes every exception of the URL, disabled ones too.
            await set(domainId, { audit: 'inherit' })
            expect(
              (await db.audit.config(domainId)).rules.filter((r) => r.dimension === 'audit'),
            ).toEqual([])
          })

          it('treats each condition apart when one of them has a disabled exception', async () => {
            const domainId = await domain()
            await db.audit.saveRule({
              domainId,
              rule: {
                dimension: 'noindex',
                value: 'required',
                selector: { kind: 'url', url: URL_A },
                reason: null,
                enabled: false,
              },
            })
            await set(domainId, { conditions: { sitemap: 'allowed' } })
            expect(await exceptionOf(domainId, 'noindex', URL_A)).toMatchObject({ enabled: false })
            expect(await exceptionOf(domainId, 'sitemap', URL_A)).toMatchObject({ enabled: true })
          })

          it('takes one version and one recalculation for many statements and URLs', async () => {
            const domainId = await domain()
            await finishedCrawl(domainId)
            const before = (await db.audit.config(domainId)).version
            const urls = ['https://acme.com/a', 'https://acme.com/b', 'https://acme.com/c']
            expect(
              await db.audit.setUrlConfig({
                host: 'acme.com',
                domainId,
                urls,
                audit: 'exclude',
                conditions: { noindex: 'required', robots: 'allowed' },
              }),
            ).toMatchObject({ ok: true, changed: true, version: before + 1 })
            expect((await db.audit.config(domainId)).rules).toHaveLength(9)
            expect(await recomputeJobs()).toHaveLength(1)
          })

          it('writes nothing when the change would go over the limit', async () => {
            const domainId = await domain()
            const urls = Array.from({ length: 60 }, (_, i) => `https://acme.com/p${i}`)
            // 60 URLs x 4 statements is more than a domain can have.
            expect(
              await db.audit.setUrlConfig({
                host: 'acme.com',
                domainId,
                urls,
                audit: 'exclude',
                intent: 'not-indexable',
                conditions: { noindex: 'required', sitemap: 'required' },
              }),
            ).toEqual({ ok: false, error: 'limit' })
            expect((await db.audit.config(domainId)).rules).toEqual([])
            expect((await db.audit.config(domainId)).version).toBe(0)
          })

          it('reads the effective result through the language directories of the domain', async () => {
            const domainId = await domain()
            await db.audit.setLanguages({ domainId, languages: LANGS })
            await db.audit.saveRule({
              domainId,
              rule: rule('nofollow', 'allowed', '/cart', { scope: 'shared' }),
            })
            await set(domainId, { conditions: { nofollow: 'forbidden' } })
            const config = await db.audit.config(domainId)
            const resolver = compileAuditRules(config.rules, 'acme.com', {
              languages: config.languages,
            })
            // /es/cart is under the shared rule, and the exception beats it for this URL only.
            expect(resolver.resolve(URL_A).conditions.nofollow.requirement).toBe('forbidden')
            expect(
              resolver.resolve('https://acme.com/ca/cart').conditions.nofollow.requirement,
            ).toBe('allowed')
          })
        })

        describe('saving a rule as the editor shows it', () => {
          const selector = (path: string, kind: 'path' | 'prefix' = 'prefix') => ({
            kind,
            path,
            query: { mode: 'any' as const },
            scope: 'literal' as const,
          })
          const save = (domainId: string, input: Record<string, unknown>) =>
            db.audit.saveRuleSet({
              domainId,
              selector: selector('/shop'),
              statements: { audit: 'exclude' },
              reason: null,
              enabled: true,
              ...input,
            } as Parameters<Database['audit']['saveRuleSet']>[0])
          const at = async (domainId: string, path: string) =>
            (await db.audit.config(domainId)).rules
              .filter((r) => r.selector.kind !== 'url' && r.selector.path === path)
              .map((r) => `${r.dimension}=${r.value}`)
              .sort()

          it('creates the statements of a rule together, in one change', async () => {
            const domainId = await domain()
            await finishedCrawl(domainId)
            const result = await save(domainId, {
              statements: {
                audit: 'include',
                intent: 'indexable',
                conditions: { noindex: 'forbidden', sitemap: 'required' },
              },
              reason: 'The shop',
            })
            expect(result).toMatchObject({ ok: true, changed: true, version: 1 })
            expect(await at(domainId, '/shop')).toEqual([
              'audit=include',
              'intent=indexable',
              'noindex=forbidden',
              'sitemap=required',
            ])
            const rules = (await db.audit.config(domainId)).rules
            expect(new Set(rules.map((r) => r.reason))).toEqual(new Set(['The shop']))
            expect(await recomputeJobs()).toHaveLength(1)
          })

          it('writes nothing when one of its statements clashes with an enabled rule', async () => {
            const domainId = await domain()
            await db.audit.saveRule({ domainId, rule: rule('sitemap', 'required', '/shop') })
            const before = (await db.audit.config(domainId)).version
            expect(
              await save(domainId, {
                statements: { audit: 'exclude', conditions: { sitemap: 'forbidden' } },
              }),
            ).toEqual({ ok: false, error: 'conflict' })
            // The statement that was fine was not written either.
            expect(await at(domainId, '/shop')).toEqual(['sitemap=required'])
            expect((await db.audit.config(domainId)).version).toBe(before)
            // Created switched off, it can share the selector.
            expect(
              await save(domainId, {
                statements: { conditions: { sitemap: 'forbidden' } },
                enabled: false,
              }),
            ).toMatchObject({ ok: true })
          })

          it('replaces the statements of the rule being edited, keeping the rows that stay', async () => {
            const domainId = await domain()
            await save(domainId, {
              statements: {
                audit: 'exclude',
                conditions: { noindex: 'required', robots: 'allowed' },
              },
            })
            const before = (await db.audit.config(domainId)).rules
            const noindex = before.find((r) => r.dimension === 'noindex')!
            await save(domainId, {
              editing: selector('/shop'),
              statements: { conditions: { noindex: 'allowed', nofollow: 'forbidden' } },
            })
            const after = await db.audit.config(domainId)
            // The audit and robots statements were left out: they are gone. The noindex row stays.
            expect(await at(domainId, '/shop')).toEqual(['nofollow=forbidden', 'noindex=allowed'])
            expect(after.rules.find((r) => r.dimension === 'noindex')).toMatchObject({
              id: noindex.id,
              value: 'allowed',
            })
          })

          it('moves the whole rule to another selector, and refuses to land on another rule', async () => {
            const domainId = await domain()
            await save(domainId, {
              statements: { audit: 'exclude', conditions: { sitemap: 'required' } },
            })
            const ids = (await db.audit.config(domainId)).rules.map((r) => r.id).sort()
            await save(domainId, {
              editing: selector('/shop'),
              selector: selector('/store'),
              statements: { audit: 'exclude', conditions: { sitemap: 'required' } },
            })
            expect(await at(domainId, '/shop')).toEqual([])
            expect(await at(domainId, '/store')).toEqual(['audit=exclude', 'sitemap=required'])
            expect((await db.audit.config(domainId)).rules.map((r) => r.id).sort()).toEqual(ids)
            // Another rule already says the same thing at the selector it moves to.
            await save(domainId, {
              selector: selector('/blog'),
              statements: { conditions: { sitemap: 'allowed' } },
            })
            expect(
              await save(domainId, {
                editing: selector('/store'),
                selector: selector('/blog'),
                statements: { conditions: { sitemap: 'required' } },
              }),
            ).toEqual({ ok: false, error: 'conflict' })
            expect(await at(domainId, '/store')).toEqual(['audit=exclude', 'sitemap=required'])
          })

          it('does not edit a rule that is not there, and does not count a change that changes nothing', async () => {
            const domainId = await domain()
            expect(
              await save(domainId, {
                editing: selector('/nowhere'),
                statements: { audit: 'exclude' },
              }),
            ).toEqual({ ok: false, error: 'not-found' })
            await save(domainId, { statements: { audit: 'exclude' } })
            const version = (await db.audit.config(domainId)).version
            expect(
              await save(domainId, {
                editing: selector('/shop'),
                statements: { audit: 'exclude' },
              }),
            ).toMatchObject({ ok: true, changed: false, version })
          })

          it('turns the rows of one rule on and off together, or none of them', async () => {
            const domainId = await domain()
            await save(domainId, {
              statements: { audit: 'exclude', conditions: { noindex: 'required' } },
            })
            const ids = (await db.audit.config(domainId)).rules.map((r) => r.id)
            expect(await db.audit.setRulesEnabled({ domainId, ids, enabled: false })).toMatchObject(
              {
                ok: true,
                changed: true,
              },
            )
            expect((await db.audit.config(domainId)).rules.every((r) => !r.enabled)).toBe(true)
            // One row is missing: nothing is changed.
            expect(
              await db.audit.setRulesEnabled({ domainId, ids: [...ids, 'nope'], enabled: true }),
            ).toEqual({ ok: false, error: 'not-found' })
            expect((await db.audit.config(domainId)).rules.every((r) => !r.enabled)).toBe(true)
            // Another enabled rule has the place of one of them: none is enabled.
            await save(domainId, {
              selector: selector('/shop'),
              statements: { conditions: { noindex: 'forbidden' } },
            })
            expect(await db.audit.setRulesEnabled({ domainId, ids, enabled: true })).toEqual({
              ok: false,
              error: 'conflict',
            })
            expect(
              (await db.audit.config(domainId)).rules.filter((r) => r.enabled).map((r) => r.value),
            ).toEqual(['forbidden'])
          })

          it('removes the rows of one rule together, or none of them', async () => {
            const domainId = await domain()
            await save(domainId, {
              statements: { audit: 'exclude', conditions: { noindex: 'required' } },
            })
            const ids = (await db.audit.config(domainId)).rules.map((r) => r.id)
            expect(await db.audit.deleteRules({ domainId, ids: [...ids, 'nope'] })).toEqual({
              ok: false,
              error: 'not-found',
            })
            expect((await db.audit.config(domainId)).rules).toHaveLength(2)
            expect(await db.audit.deleteRules({ domainId, ids })).toMatchObject({
              ok: true,
              changed: true,
            })
            expect((await db.audit.config(domainId)).rules).toEqual([])
          })

          it('keeps the rules of one domain from being reached with the ids of another', async () => {
            const mine = await domain('acme.com')
            const other = await domain('other.com')
            await save(other, { statements: { audit: 'exclude' } })
            const ids = (await db.audit.config(other)).rules.map((r) => r.id)
            expect(await db.audit.deleteRules({ domainId: mine, ids })).toEqual({
              ok: false,
              error: 'not-found',
            })
            expect(await db.audit.setRulesEnabled({ domainId: mine, ids, enabled: false })).toEqual(
              { ok: false, error: 'not-found' },
            )
            expect((await db.audit.config(other)).rules.every((r) => r.enabled)).toBe(true)
          })

          it('limits the rows of a domain', async () => {
            const domainId = await domain()
            for (let i = 0; i < AUDIT_LIMITS.rulesPerDomain; i++) {
              const saved = await db.audit.saveRule({
                domainId,
                rule: rule('audit', 'exclude', `/p${i}`),
              })
              if (!saved.ok) throw new Error('setup failed')
            }
            expect(await save(domainId, { selector: selector('/over') })).toEqual({
              ok: false,
              error: 'limit',
            })
          })
        })

        describe('the language directories', () => {
          it('start as none, and are kept sorted, once each, with whether the root has pages', async () => {
            const domainId = await domain()
            expect((await db.audit.config(domainId)).languages).toEqual({
              prefixes: [],
              unprefixed: false,
            })
            expect(
              await db.audit.setLanguages({
                domainId,
                languages: { prefixes: ['/es', '/en', '/es', '/ca'], unprefixed: true },
              }),
            ).toMatchObject({ ok: true, version: 1, changed: true })
            expect((await db.audit.config(domainId)).languages).toEqual(LANGS)
          })

          it('move the version only when they change, and ask for the crawl to be analysed again', async () => {
            const domainId = await domain()
            await finishedCrawl(domainId)
            await db.audit.setLanguages({ domainId, languages: LANGS })
            expect(await recomputeJobs()).toHaveLength(1)
            await db.jobs.claim({ workerId: 'w1', limit: 10, types: [JOB_TYPES.auditRecompute] })
            // The same, in another order: nothing changed, so nothing is asked for.
            expect(
              await db.audit.setLanguages({
                domainId,
                languages: { prefixes: ['/es', '/ca', '/en'], unprefixed: true },
              }),
            ).toMatchObject({ ok: true, version: 1, changed: false })
            expect(await recomputeJobs()).toEqual([])
            expect(
              await db.audit.setLanguages({ domainId, languages: { ...LANGS, unprefixed: false } }),
            ).toMatchObject({ version: 2, changed: true })
            expect(await recomputeJobs()).toHaveLength(1)
          })

          it('can be emptied again', async () => {
            const domainId = await domain()
            await db.audit.setLanguages({ domainId, languages: LANGS })
            await db.audit.setLanguages({
              domainId,
              languages: { prefixes: [], unprefixed: false },
            })
            expect((await db.audit.config(domainId)).languages).toEqual({
              prefixes: [],
              unprefixed: false,
            })
          })

          it('belong to their domain', async () => {
            const acme = await domain('acme.com')
            const other = await domain('other.com')
            await db.audit.setLanguages({ domainId: acme, languages: LANGS })
            expect((await db.audit.config(other)).languages).toEqual({
              prefixes: [],
              unprefixed: false,
            })
            expect((await db.audit.config(other)).version).toBe(0)
          })

          it('survive a change of rules, and rules survive a change of languages', async () => {
            const domainId = await domain()
            await db.audit.setLanguages({ domainId, languages: LANGS })
            await db.audit.saveRule({ domainId, rule: rule('audit', 'exclude', '/cart') })
            await db.audit.setLanguages({
              domainId,
              languages: { prefixes: ['/fr'], unprefixed: false },
            })
            const config = await db.audit.config(domainId)
            expect(config.rules).toHaveLength(1)
            expect(config.languages).toEqual({ prefixes: ['/fr'], unprefixed: false })
            expect(config.version).toBe(3)
          })

          it('are read together with the version they came with, however many changes race', async () => {
            const domainId = await domain()
            const writes = Array.from({ length: 6 }, (_, i) =>
              db.audit.setLanguages({
                domainId,
                languages: { prefixes: [`/l${i}`], unprefixed: i % 2 === 0 },
              }),
            )
            const reads = Array.from({ length: 10 }, () => db.audit.config(domainId))
            const [, configs] = await Promise.all([Promise.all(writes), Promise.all(reads)])
            for (const config of configs) {
              // Never languages of one change under the version of another that has not happened.
              expect(config.version).toBeLessThanOrEqual(6)
              if (config.version > 0) expect(config.languages.prefixes).toHaveLength(1)
            }
            expect((await db.audit.config(domainId)).version).toBe(6)
          })
        })

        describe('moving from the first semantics', () => {
          const SETTING = 'audit.semantics'

          it('drops the rules of the retired intent and keeps everything else, then moves the version', async () => {
            const domainId = await domain()
            await finishedCrawl(domainId)
            const none = await db.audit.saveRule({
              domainId,
              rule: { ...rule('intent', 'indexable', '/blog'), value: 'none' } as never,
            })
            await db.audit.saveRule({ domainId, rule: rule('intent', 'not-indexable', '/account') })
            await db.audit.saveRule({ domainId, rule: rule('audit', 'exclude', '/cart') })
            const before = (await db.audit.config(domainId)).version
            await db.jobs.claim({ workerId: 'w1', limit: 10, types: [JOB_TYPES.auditRecompute] })

            // As if this were a database from before: the marker is not there yet.
            await db.settings.delete(SETTING)
            await db.migrate()

            const config = await db.audit.config(domainId)
            expect(config.rules.some((r) => r.id === (none.ok ? none.rule!.id : ''))).toBe(false)
            expect(config.rules.map((r) => r.dimension).sort()).toEqual(['audit', 'intent'])
            expect(config.version).toBe(before + 1)
            expect(await recomputeJobs()).toHaveLength(1)
            expect(await db.settings.get(SETTING)).toMatchObject({ value: String(AUDIT_SEMANTICS) })
          })

          it('moves the version of a domain with a crawl and no rules, and leaves the others alone', async () => {
            const withCrawl = await domain('acme.com')
            const empty = await domain('empty.com')
            await finishedCrawl(withCrawl)
            await db.settings.delete(SETTING)
            await db.migrate()
            expect((await db.audit.config(withCrawl)).version).toBe(1)
            expect((await db.audit.config(empty)).version).toBe(0)
            expect(await recomputeJobs()).toHaveLength(1)
          })

          it('happens once: the marker keeps later migrations from moving the version again', async () => {
            const domainId = await domain()
            await db.audit.saveRule({ domainId, rule: rule('audit', 'exclude', '/cart') })
            await db.settings.delete(SETTING)
            await db.migrate()
            const version = (await db.audit.config(domainId)).version
            await db.migrate()
            await db.migrate()
            expect((await db.audit.config(domainId)).version).toBe(version)
          })

          it('does not rewrite what an analysis made before it concluded or used', async () => {
            const domainId = await domain()
            const crawl = await finishedCrawl(domainId)
            const legacy = {
              version: 4,
              rules: [{ ...rule('intent', 'indexable', '/blog'), id: 'old', value: 'none' }],
            } as never
            await saveIssues({
              crawlId: crawl.id,
              issues: [],
              pages: { issue: 0, warning: 0, opportunity: 0 },
              withType: { issue: 0, warning: 0, opportunity: 0 },
              catalog: 'v1',
              audit: { snapshot: legacy },
            })
            await db.settings.delete(SETTING)
            await db.migrate()
            // The snapshot keeps its rule, its version and its lack of a semantics.
            const stored = (await db.crawls.get(crawl.id))!
            expect(stored.auditVersion).toBe(4)
            expect(stored.auditSnapshot?.semantics).toBeUndefined()
            expect(stored.auditSnapshot?.rules[0]).toMatchObject({ id: 'old', value: 'none' })
          })
        })

        describe('moving from the second semantics', () => {
          const SETTING = 'audit.semantics'
          const asSecond = () => db.settings.set(SETTING, '2', false)
          const nofollowRules = async (domainId: string) =>
            (await db.audit.config(domainId)).rules
              .filter((r) => r.dimension === 'nofollow')
              .map((r) => ({
                path: r.selector.kind === 'url' ? r.selector.url : r.selector.path,
                value: r.value,
                enabled: r.enabled,
                reason: r.reason,
              }))
              .sort((a, b) => (a.path < b.path ? -1 : 1))

          it('turns an accepted nofollow into the condition and keeps every expectation as it was', async () => {
            const domainId = await domain()
            await finishedCrawl(domainId)
            const accepting = await db.audit.saveRule({
              domainId,
              rule: { ...rule('intent', 'not-indexable', '/cart'), reason: 'Cart' },
            })
            await db.audit.saveRule({ domainId, rule: rule('intent', 'indexable', '/cart/help') })
            await db.audit.saveRule({ domainId, rule: rule('intent', 'indexable', '/blog') })
            await db.audit.saveRule({ domainId, rule: rule('audit', 'exclude', '/old') })
            await legacy.acceptNofollow(accepting.ok ? accepting.rule!.id : '', true)
            const before = (await db.audit.config(domainId)).version
            await db.jobs.claim({ workerId: 'w1', limit: 10, types: [JOB_TYPES.auditRecompute] })

            await asSecond()
            await db.migrate()

            const config = await db.audit.config(domainId)
            // Accepted where it was, written down as refused only where a rule under it would have
            // decided otherwise, and nowhere else.
            expect(await nofollowRules(domainId)).toEqual([
              { path: '/cart', value: 'allowed', enabled: true, reason: 'Cart' },
              { path: '/cart/help', value: 'forbidden', enabled: true, reason: null },
            ])
            // The expectations are what they were: an old `not-indexable` is not a required `noindex`.
            expect(
              config.rules
                .filter((r) => r.dimension === 'intent')
                .map((r) => `${r.selector.kind === 'url' ? '' : r.selector.path}=${r.value}`)
                .sort(),
            ).toEqual(['/blog=indexable', '/cart/help=indexable', '/cart=not-indexable'])
            expect(config.rules.some((r) => r.dimension === 'noindex')).toBe(false)
            expect(config.rules.every((r) => r.dimension !== 'intent' || !r.acceptNofollow)).toBe(
              true,
            )
            expect(config.rules.filter((r) => r.dimension === 'audit')).toHaveLength(1)
            expect(config.version).toBe(before + 1)
            expect(await recomputeJobs()).toHaveLength(1)
            expect(await db.settings.get(SETTING)).toMatchObject({ value: String(AUDIT_SEMANTICS) })
          })

          it('reads the same for the URLs that were covered, whichever rule decided them', async () => {
            const domainId = await domain()
            const general = await db.audit.saveRule({
              domainId,
              rule: rule('intent', 'not-indexable', '/cart'),
            })
            await db.audit.saveRule({
              domainId,
              rule: {
                ...rule('intent', 'indexable', '/cart/help'),
                selector: { kind: 'url', url: 'https://acme.com/cart/help' },
              },
            })
            await legacy.acceptNofollow(general.ok ? general.rule!.id : '', true)
            const old = compileAuditRules((await db.audit.config(domainId)).rules, 'acme.com', {
              semantics: 2,
            })
            const accepted = (url: string) =>
              old.resolve(url).conditions.nofollow.requirement === 'allowed'
            const expected = {
              'https://acme.com/cart': true,
              'https://acme.com/cart/x': true,
              'https://acme.com/cart/help': false,
              'https://acme.com/blog': false,
            }

            await asSecond()
            await db.migrate()
            const now = compileAuditRules((await db.audit.config(domainId)).rules, 'acme.com')
            for (const [url, wanted] of Object.entries(expected)) {
              expect(accepted(url)).toBe(wanted)
              expect(now.resolve(url).conditions.nofollow.requirement === 'allowed').toBe(wanted)
              // Under the old meaning the rule beyond acceptance was the expectation's own.
              expect(now.resolve(url).intent.value).toBe(old.resolve(url).intent.value)
            }
          })

          it('leaves a domain without an accepted nofollow, and its crawl, as they are', async () => {
            const domainId = await domain()
            await finishedCrawl(domainId)
            // Nothing here is read another way by the meaning after this one either.
            await db.audit.saveRule({ domainId, rule: rule('intent', 'indexable', '/cart') })
            await db.audit.saveRule({ domainId, rule: rule('audit', 'exclude', '/old') })
            const before = await db.audit.config(domainId)
            await db.jobs.claim({ workerId: 'w1', limit: 10, types: [JOB_TYPES.auditRecompute] })
            await asSecond()
            await db.migrate()
            const after = await db.audit.config(domainId)
            expect(after.version).toBe(before.version)
            expect(after.rules.map((r) => r.id).sort()).toEqual(
              before.rules.map((r) => r.id).sort(),
            )
            expect(await recomputeJobs()).toHaveLength(0)
            expect(await db.settings.get(SETTING)).toMatchObject({ value: String(AUDIT_SEMANTICS) })
          })

          it('leaves a domain with a crawl and no rules alone', async () => {
            const withCrawl = await domain('acme.com')
            await finishedCrawl(withCrawl)
            await db.jobs.claim({ workerId: 'w1', limit: 10, types: [JOB_TYPES.auditRecompute] })
            await asSecond()
            await db.migrate()
            expect((await db.audit.config(withCrawl)).version).toBe(0)
            expect(await recomputeJobs()).toHaveLength(0)
          })

          it('keeps only the condition of an exception that was only accepting the nofollow', async () => {
            const domainId = await domain()
            const general = await db.audit.saveRule({
              domainId,
              rule: rule('intent', 'not-indexable', '/cart'),
            })
            const only = await db.audit.saveRule({
              domainId,
              rule: {
                dimension: 'intent',
                value: 'inherit',
                selector: { kind: 'url', url: 'https://acme.com/cart/pay' },
                reason: 'Pay',
                enabled: true,
              } as never,
            })
            await legacy.acceptNofollow(only.ok ? only.rule!.id : '', true)
            await asSecond()
            await db.migrate()
            const config = await db.audit.config(domainId)
            expect(
              config.rules.find((r) => r.id === (only.ok ? only.rule!.id : '')),
            ).toBeUndefined()
            expect(
              config.rules.find((r) => r.id === (general.ok ? general.rule!.id : '')),
            ).toMatchObject({
              value: 'not-indexable',
            })
            expect(await nofollowRules(domainId)).toEqual([
              { path: 'https://acme.com/cart/pay', value: 'allowed', enabled: true, reason: 'Pay' },
            ])
          })

          it('keeps a rule that is switched off switched off', async () => {
            const domainId = await domain()
            const off = await db.audit.saveRule({
              domainId,
              rule: rule('intent', 'indexable', '/cart', { enabled: false }),
            })
            await legacy.acceptNofollow(off.ok ? off.rule!.id : '', true)
            await asSecond()
            await db.migrate()
            expect(await nofollowRules(domainId)).toEqual([
              { path: '/cart', value: 'allowed', enabled: false, reason: null },
            ])
          })

          it('happens once: running the upgrade again finds nothing to change', async () => {
            const domainId = await domain()
            const accepting = await db.audit.saveRule({
              domainId,
              rule: rule('intent', 'indexable', '/cart'),
            })
            await legacy.acceptNofollow(accepting.ok ? accepting.rule!.id : '', true)
            await asSecond()
            await db.migrate()
            const first = await db.audit.config(domainId)
            await db.audit.upgradeSemantics()
            await db.migrate()
            // Not even with the marker gone: nothing carries the retired flag any more.
            await asSecond()
            await db.audit.upgradeSemantics()
            const again = await db.audit.config(domainId)
            expect(again.version).toBe(first.version)
            expect(again.rules.map((r) => r.id).sort()).toEqual(first.rules.map((r) => r.id).sort())
          })

          it('does what the first upgrade and this one do, in one step, from the first semantics', async () => {
            const domainId = await domain()
            const none = await db.audit.saveRule({
              domainId,
              rule: { ...rule('intent', 'indexable', '/blog'), value: 'none' } as never,
            })
            const accepting = await db.audit.saveRule({
              domainId,
              rule: rule('intent', 'indexable', '/cart'),
            })
            await legacy.acceptNofollow(accepting.ok ? accepting.rule!.id : '', true)
            await db.settings.delete(SETTING)
            await db.migrate()
            const config = await db.audit.config(domainId)
            expect(config.rules.some((r) => r.id === (none.ok ? none.rule!.id : ''))).toBe(false)
            expect(await nofollowRules(domainId)).toEqual([
              { path: '/cart', value: 'allowed', enabled: true, reason: null },
            ])
          })
        })

        describe('moving from the third semantics', () => {
          const SETTING = 'audit.semantics'
          const asThird = () => db.settings.set(SETTING, '3', false)
          const idsOf = async (domainId: string) =>
            (await db.audit.config(domainId)).rules.map((r) => r.id).sort()

          it.each([
            ['a required noindex', () => rule('noindex', 'required', '/es')],
            ['an allowed noindex', () => rule('noindex', 'allowed', '/es')],
            ['a required robots block', () => rule('robots', 'required', '/es')],
            ['an allowed robots block', () => rule('robots', 'allowed', '/es')],
            ['an expectation of not being indexable', () => rule('intent', 'not-indexable', '/es')],
          ])('analyses a domain with %s again, and writes no rule', async (_, makeRule) => {
            const domainId = await domain()
            await finishedCrawl(domainId)
            await db.audit.saveRule({ domainId, rule: makeRule() as never })
            const before = await db.audit.config(domainId)
            await db.jobs.claim({ workerId: 'w1', limit: 10, types: [JOB_TYPES.auditRecompute] })

            await asThird()
            await db.migrate()

            const after = await db.audit.config(domainId)
            // The rules are the ones the user wrote; what they accept is what changed.
            expect(await idsOf(domainId)).toEqual(before.rules.map((r) => r.id).sort())
            expect(after.rules).toEqual(before.rules)
            expect(after.version).toBe(before.version + 1)
            expect(await recomputeJobs()).toHaveLength(1)
            expect(await db.settings.get(SETTING)).toMatchObject({
              value: String(AUDIT_SEMANTICS),
            })
          })

          it('leaves a domain whose rules read the same alone, with its crawl', async () => {
            const domainId = await domain()
            await finishedCrawl(domainId)
            for (const statement of [
              rule('audit', 'exclude', '/old'),
              rule('intent', 'indexable', '/blog'),
              rule('noindex', 'forbidden', '/blog'),
              rule('nofollow', 'allowed', '/blog'),
              rule('robots', 'forbidden', '/blog'),
              rule('sitemap', 'required', '/blog'),
            ]) {
              await db.audit.saveRule({ domainId, rule: statement as never })
            }
            const before = await db.audit.config(domainId)
            await db.jobs.claim({ workerId: 'w1', limit: 10, types: [JOB_TYPES.auditRecompute] })

            await asThird()
            await db.migrate()

            expect((await db.audit.config(domainId)).version).toBe(before.version)
            expect(await recomputeJobs()).toHaveLength(0)
            expect(await db.settings.get(SETTING)).toMatchObject({ value: String(AUDIT_SEMANTICS) })
          })

          it('leaves a domain with a crawl and no rules alone', async () => {
            const withCrawl = await domain('acme.com')
            await finishedCrawl(withCrawl)
            await db.jobs.claim({ workerId: 'w1', limit: 10, types: [JOB_TYPES.auditRecompute] })
            await asThird()
            await db.migrate()
            expect((await db.audit.config(withCrawl)).version).toBe(0)
            expect(await recomputeJobs()).toHaveLength(0)
          })

          it('does not count a rule that is switched off: it accepts nothing', async () => {
            const domainId = await domain()
            await finishedCrawl(domainId)
            await db.audit.saveRule({
              domainId,
              rule: rule('noindex', 'allowed', '/es', { enabled: false }) as never,
            })
            const before = (await db.audit.config(domainId)).version
            await db.jobs.claim({ workerId: 'w1', limit: 10, types: [JOB_TYPES.auditRecompute] })
            await asThird()
            await db.migrate()
            expect((await db.audit.config(domainId)).version).toBe(before)
            expect(await recomputeJobs()).toHaveLength(0)
          })

          it('happens once: the marker keeps later migrations from moving the version again', async () => {
            const domainId = await domain()
            await db.audit.saveRule({ domainId, rule: rule('noindex', 'allowed', '/es') as never })
            await asThird()
            await db.migrate()
            const version = (await db.audit.config(domainId)).version
            await db.migrate()
            await db.migrate()
            expect((await db.audit.config(domainId)).version).toBe(version)
          })

          it('moves the version once when the second upgrade and this one both apply', async () => {
            const domainId = await domain()
            const accepting = await db.audit.saveRule({
              domainId,
              rule: rule('intent', 'not-indexable', '/cart'),
            })
            await db.audit.saveRule({ domainId, rule: rule('noindex', 'allowed', '/es') as never })
            await legacy.acceptNofollow(accepting.ok ? accepting.rule!.id : '', true)
            const before = (await db.audit.config(domainId)).version
            await db.settings.set(SETTING, '2', false)
            await db.migrate()
            expect((await db.audit.config(domainId)).version).toBe(before + 1)
          })

          it('does not rewrite what an analysis made before it concluded or used', async () => {
            const domainId = await domain()
            const crawl = await finishedCrawl(domainId)
            const allowing = (await db.audit.saveRule({
              domainId,
              rule: rule('noindex', 'allowed', '/es') as never,
            })) as { ok: true; rule?: { id: string } }
            await saveIssues({
              crawlId: crawl.id,
              issues: [],
              pages: { issue: 0, warning: 0, opportunity: 0 },
              withType: { issue: 0, warning: 0, opportunity: 0 },
              catalog: 'v1',
              audit: {
                snapshot: {
                  version: 1,
                  semantics: 3,
                  rules: [
                    (await db.audit.config(domainId)).rules.find(
                      (r) => r.id === allowing.rule?.id,
                    )!,
                  ],
                },
              },
            })
            await asThird()
            await db.migrate()
            // The analysis keeps the meaning it was made with: today's rules do not reach it.
            const stored = (await db.crawls.get(crawl.id))!
            expect(stored.auditSnapshot?.semantics).toBe(3)
            expect(stored.auditVersion).toBe(1)
          })
        })

        it('keeps what an analysis used: the semantics and the languages of its snapshot', async () => {
          const domainId = await domain()
          const crawl = await finishedCrawl(domainId)
          await saveIssues({
            crawlId: crawl.id,
            issues: [],
            pages: { issue: 0, warning: 0, opportunity: 0 },
            withType: { issue: 0, warning: 0, opportunity: 0 },
            catalog: 'v1',
            audit: { snapshot: { version: 3, semantics: 2, languages: LANGS, rules: [] } },
          })
          expect((await db.crawls.get(crawl.id))!.auditSnapshot).toEqual({
            version: 3,
            semantics: 2,
            languages: LANGS,
            rules: [],
          })
        })
      })

      describe('what an analysis concludes about each URL', () => {
        const site = 'https://acme.com'
        const hashOf = (path: string) => crawlUrlHash(`${site}${path}`)
        const state = (
          overrides: Partial<
            Parameters<Database['crawls']['saveAnalysis']>[0]['audit']['urls'][number]
          > & { urlHash: string },
        ): Parameters<Database['crawls']['saveAnalysis']>[0]['audit']['urls'][number] => ({
          participation: 'audited',
          participationRule: null,
          intent: 'indexable',
          intentRule: null,
          conditions: {},
          indexability: 'indexable',
          blockers: [],
          ...overrides,
        })
        const none = { issue: 0, warning: 0, opportunity: 0 }

        let hosts = 0
        async function analysedCrawl(version: number, extra: { catalog?: string } = {}) {
          // The first is the host the URLs are on; later ones are other domains, for tests that need two.
          const domainId = await domain(hosts++ === 0 ? 'acme.com' : `site-${hosts}.com`)
          const crawl = await startCrawl(domainId)
          const paths = ['/', '/cart', '/cart/items', '/blog']
          await db.crawls.addUrls(
            crawl.id,
            paths.map((path) => newUrl(`${site}${path}`)),
          )
          for (const path of paths) {
            await db.crawls.recordResult({
              crawlId: crawl.id,
              urlHash: hashOf(path),
              result: result('page'),
            })
          }
          await db.crawls.finish(crawl.id, { status: 'completed' })
          return { domainId, crawlId: crawl.id, version, catalog: extra.catalog ?? 'v1' }
        }

        const save = (
          crawl: { crawlId: string; version: number; catalog: string },
          overrides: { cart?: 'excluded' | 'audited'; version?: number; issue?: string } = {},
        ) =>
          saveIssues({
            crawlId: crawl.crawlId,
            issues: overrides.issue ? [{ urlHash: hashOf('/blog'), issue: overrides.issue }] : [],
            pages: none,
            withType: none,
            catalog: crawl.catalog,
            audit: {
              snapshot: { version: overrides.version ?? crawl.version, rules: [] },
              pages: {
                audited: 2,
                excluded: 2,
                indexable: 4,
                notIndexable: 0,
                unknownIndexability: 0,
              },
              urls: [
                state({ urlHash: hashOf('/') }),
                state({
                  urlHash: hashOf('/cart'),
                  participation: overrides.cart ?? 'excluded',
                  participationRule: 'rule-cart',
                  intent: 'not-indexable',
                  intentRule: 'rule-intent',
                  conditions: {
                    nofollow: {
                      requirement: 'allowed',
                      rule: 'rule-nofollow',
                      observed: 'present',
                    },
                    sitemap: { requirement: 'required', rule: 'rule-sitemap', observed: 'unknown' },
                    robots: { requirement: 'forbidden', rule: 'rule-robots', observed: null },
                  },
                  indexability: 'not-indexable',
                  blockers: ['noindex', 'robots'],
                }),
                state({
                  urlHash: hashOf('/cart/items'),
                  participation: overrides.cart ?? 'excluded',
                  participationRule: 'rule-cart',
                }),
                state({ urlHash: hashOf('/blog'), intent: 'indexable', intentRule: 'rule-blog' }),
              ],
            },
          })

        it('stores it per URL, with the totals and the configuration, as one analysis', async () => {
          const crawl = await analysedCrawl(3)
          expect(await db.crawls.get(crawl.crawlId)).toMatchObject({
            pagesAudit: null,
            auditVersion: null,
            auditSnapshot: null,
          })
          expect(await save(crawl)).toBe(true)
          expect(await db.crawls.get(crawl.crawlId)).toMatchObject({
            pagesAudit: {
              audited: 2,
              excluded: 2,
              indexable: 4,
              notIndexable: 0,
              unknownIndexability: 0,
            },
            auditVersion: 3,
            auditSnapshot: { version: 3, rules: [] },
            pagesByWorstIssue: none,
          })
          const stored = await db.crawls.auditOf(crawl.crawlId, [hashOf('/cart'), hashOf('/nope')])
          expect(stored).toEqual([
            {
              urlHash: hashOf('/cart'),
              participation: 'excluded',
              participationRule: 'rule-cart',
              intent: 'not-indexable',
              intentRule: 'rule-intent',
              conditions: {
                nofollow: { requirement: 'allowed', rule: 'rule-nofollow', observed: 'present' },
                sitemap: { requirement: 'required', rule: 'rule-sitemap', observed: 'unknown' },
                robots: { requirement: 'forbidden', rule: 'rule-robots', observed: null },
              },
              indexability: 'not-indexable',
              blockers: ['noindex', 'robots'],
            },
          ])
          expect(await db.crawls.auditOf(crawl.crawlId, [])).toEqual([])
        })

        it('reads an analysis of semantics 2 with its accepted nofollow as the condition being allowed', async () => {
          const crawl = await analysedCrawl(1)
          await save(crawl)
          await legacy.urlAcceptedNofollow(crawl.crawlId, hashOf('/blog'))
          const [blog] = await db.crawls.auditOf(crawl.crawlId, [hashOf('/blog')])
          // The rule that decided the expectation is the one that accepted it, as it was recorded.
          expect(blog).toMatchObject({
            intentRule: 'rule-blog',
            conditions: { nofollow: { requirement: 'allowed', rule: 'rule-blog', observed: null } },
          })
          // The same for the history of a URL, which reads the same rows.
          const [trace] = await db.crawls.urlHistory({
            domainId: crawl.domainId,
            crawlIds: [crawl.crawlId],
            urlHashes: [hashOf('/blog')],
          })
          expect(trace?.audit?.conditions.nofollow).toMatchObject({ requirement: 'allowed' })
          // A condition stored by a newer analysis wins over the flag.
          const [cart] = await db.crawls.auditOf(crawl.crawlId, [hashOf('/cart')])
          expect(cart?.conditions.nofollow).toEqual({
            requirement: 'allowed',
            rule: 'rule-nofollow',
            observed: 'present',
          })
        })

        it('filters URLs by participation, intent and the rule that decided them', async () => {
          const crawl = await analysedCrawl(1)
          await save(crawl)
          const paths = async (query: Partial<Parameters<Database['crawls']['countListed']>[0]>) =>
            (
              await db.crawls.listUrls({
                crawlId: crawl.crawlId,
                view: 'pages',
                limit: 50,
                offset: 0,
                sort: 'url',
                ...query,
              })
            ).map((row) => new URL(row.url).pathname)
          expect(await paths({ participation: 'excluded' })).toEqual(['/cart', '/cart/items'])
          expect(await paths({ participation: 'audited' })).toEqual(['/', '/blog'])
          // What nothing decided is expected to be indexable, like what a rule says is.
          expect(await paths({ intent: 'indexable' })).toEqual(['/', '/blog', '/cart/items'])
          expect(await paths({ intent: 'not-indexable' })).toEqual(['/cart'])
          expect(await paths({ rule: 'rule-cart' })).toEqual(['/cart', '/cart/items'])
          expect(await paths({ rule: 'rule-intent' })).toEqual(['/cart'])
          // A rule about a condition is a rule too.
          expect(await paths({ rule: 'rule-nofollow' })).toEqual(['/cart'])
          expect(await paths({ rule: 'rule-sitemap' })).toEqual(['/cart'])
          expect(await paths({ rule: 'rule-robots' })).toEqual(['/cart'])
          expect(await paths({ rule: 'nobody' })).toEqual([])
          // Filters add up, and they work along with the search.
          expect(await paths({ participation: 'excluded', intent: 'indexable' })).toEqual([
            '/cart/items',
          ])
          expect(await paths({ participation: 'excluded', search: 'items' })).toEqual([
            '/cart/items',
          ])
          expect(
            await db.crawls.countListed({
              crawlId: crawl.crawlId,
              view: 'pages',
              participation: 'excluded',
            }),
          ).toBe(2)
          expect(
            await db.crawls.countListed({
              crawlId: crawl.crawlId,
              view: 'external',
              participation: 'excluded',
            }),
          ).toBe(0)
          // A crawl analysed without this has nothing to filter by.
          const earlier = await analysedCrawl(0)
          expect(
            await db.crawls.countListed({
              crawlId: earlier.crawlId,
              view: 'pages',
              participation: 'audited',
            }),
          ).toBe(0)
        })

        it('counts how many URLs each rule decided, whatever the dimension', async () => {
          const crawl = await analysedCrawl(1)
          await save(crawl)
          const counts = await db.crawls.auditRuleCounts(crawl.crawlId)
          expect(Object.fromEntries(counts)).toEqual({
            'rule-cart': 2,
            'rule-intent': 1,
            'rule-blog': 1,
            'rule-nofollow': 1,
            'rule-sitemap': 1,
            'rule-robots': 1,
          })
          expect((await db.crawls.auditRuleCounts('missing')).size).toBe(0)
        })

        it('lists the internal URLs of a crawl briefly, in a stable order', async () => {
          const crawl = await analysedCrawl(1)
          await db.crawls.addUrls(crawl.crawlId, [
            newUrl('https://elsewhere.org/', { scope: 'external', source: 'link' }),
          ])
          const first = await db.crawls.urlBriefs(crawl.crawlId, { limit: 3, offset: 0 })
          const rest = await db.crawls.urlBriefs(crawl.crawlId, { limit: 3, offset: 3 })
          const all = [...first, ...rest]
          expect(all.map((row) => row.url).sort()).toEqual(
            ['/', '/blog', '/cart', '/cart/items'].map((path) => `${site}${path}`).sort(),
          )
          expect(first).toHaveLength(3)
          expect(rest).toHaveLength(1)
          expect(all[0]).toEqual({
            urlHash: expect.any(String),
            url: expect.any(String),
            kind: 'page',
            state: 'done',
          })
          expect(new Set(all.map((row) => row.urlHash)).size).toBe(4)
        })

        it('replaces the previous analysis, with the same version or a later one', async () => {
          const crawl = await analysedCrawl(2)
          expect(await save(crawl, { issue: 'title-missing' })).toBe(true)
          expect(await db.crawls.issueCounts(crawl.crawlId)).toEqual([
            { issue: 'title-missing', pages: 1 },
          ])
          expect(await save(crawl)).toBe(true)
          expect(await db.crawls.issueCounts(crawl.crawlId)).toEqual([])
          expect(await save(crawl, { version: 5, cart: 'audited' })).toBe(true)
          expect(await db.crawls.get(crawl.crawlId)).toMatchObject({ auditVersion: 5 })
          expect(
            (await db.crawls.auditOf(crawl.crawlId, [hashOf('/cart')]))[0]?.participation,
          ).toBe('audited')
        })

        it('never lets an analysis with an older configuration replace a newer one', async () => {
          const crawl = await analysedCrawl(1)
          expect(await save(crawl, { version: 4, cart: 'audited', issue: 'title-missing' })).toBe(
            true,
          )
          expect(await save(crawl, { version: 3, cart: 'excluded' })).toBe(false)
          expect(await save(crawl, { version: 0, cart: 'excluded' })).toBe(false)
          // Nothing of the older one got in: not the totals, not the URLs, not the issues.
          expect(await db.crawls.get(crawl.crawlId)).toMatchObject({ auditVersion: 4 })
          expect(
            (await db.crawls.auditOf(crawl.crawlId, [hashOf('/cart')]))[0]?.participation,
          ).toBe('audited')
          expect(await db.crawls.issueCounts(crawl.crawlId)).toEqual([
            { issue: 'title-missing', pages: 1 },
          ])
        })

        it('ends with the newest configuration when analyses race, in whatever order they land', async () => {
          for (let round = 0; round < 3; round++) {
            const crawl = await analysedCrawl(0)
            const versions = [3, 1, 4, 2, 4]
            const saved = await Promise.all(
              versions.map((version) =>
                save(crawl, {
                  version,
                  cart: version === 4 ? 'audited' : 'excluded',
                  issue: `v${version}`,
                }),
              ),
            )
            expect(saved.filter(Boolean).length).toBeGreaterThanOrEqual(1)
            const stored = await db.crawls.get(crawl.crawlId)
            expect(stored?.auditVersion).toBe(4)
            expect(
              (await db.crawls.auditOf(crawl.crawlId, [hashOf('/cart')]))[0]?.participation,
            ).toBe('audited')
            expect((await db.crawls.issueCounts(crawl.crawlId)).map((row) => row.issue)).toEqual([
              'v4',
            ])
          }
        })

        it('does not analyse a crawl whose results are gone', async () => {
          const domainId = await domain()
          const oldest = await finishedCrawl(domainId)
          await finishedCrawl(domainId)
          await db.crawls.prune({ domainId, type: 'full', keep: 1 })
          expect(
            await saveIssues({
              crawlId: oldest.id,
              issues: [],
              pages: none,
              withType: none,
              catalog: 'v1',
              audit: { snapshot: { version: 1, rules: [] } },
            }),
          ).toBe(false)
          expect(await db.crawls.get(oldest.id)).toMatchObject({ auditVersion: null })
          expect(
            await saveIssues({
              crawlId: 'missing',
              issues: [],
              pages: none,
              withType: none,
              catalog: 'v1',
            }),
          ).toBe(false)
        })
      })

      it('finds the latest usable crawl of a type', async () => {
        const domainId = await domain()
        expect(await db.crawls.latestWithResults(domainId, 'full')).toBeNull()

        const good = await finishedCrawl(domainId)
        const failed = await startCrawl(domainId)
        await db.crawls.finish(failed.id, { status: 'failed', error: 'boom' })
        const priority = await startCrawl(domainId, 'priority')
        await db.crawls.finish(priority.id, { status: 'completed' })
        const running = await startCrawl(domainId)

        expect((await db.crawls.latestWithResults(domainId, 'full'))?.id).toBe(good.id)
        expect((await db.crawls.latestWithResults(domainId, 'priority'))?.id).toBe(priority.id)

        await db.crawls.finish(running.id, { status: 'incomplete' })
        expect((await db.crawls.latestWithResults(domainId, 'full'))?.id).toBe(running.id)
      })

      it('prunes old results but keeps the summary of every crawl', async () => {
        const domainId = await domain()
        const oldest = await finishedCrawl(domainId)
        const middle = await finishedCrawl(domainId)
        const newest = await finishedCrawl(domainId)
        const priority = await startCrawl(domainId, 'priority')
        await db.crawls.finish(priority.id, { status: 'completed' })

        expect(await db.crawls.prune({ domainId, type: 'full', keep: null })).toBe(0)
        expect(await db.crawls.prune({ domainId, type: 'full', keep: 2 })).toBe(1)
        expect(await db.crawls.prune({ domainId, type: 'full', keep: 2 })).toBe(0)

        expect(await db.crawls.get(oldest.id)).toMatchObject({ pruned: true, pagesCount: 1 })
        expect(await db.crawls.knownUrls(oldest.id)).toEqual([])
        expect(await db.crawls.knownUrls(middle.id)).toHaveLength(1)
        expect(await db.crawls.knownUrls(newest.id)).toHaveLength(1)
        expect((await db.crawls.get(priority.id))?.pruned).toBe(false)

        await db.crawls.prune({ domainId, type: 'full', keep: 1 })
        expect((await db.crawls.latestWithResults(domainId, 'full'))?.id).toBe(newest.id)
      })

      it('never lets a failed crawl push out good results', async () => {
        const domainId = await domain()
        const good = await finishedCrawl(domainId)
        const failed = await startCrawl(domainId)
        await db.crawls.addUrls(failed.id, [newUrl('https://acme.com/partial')])
        await db.crawls.finish(failed.id, { status: 'failed', error: 'boom' })

        expect(await db.crawls.prune({ domainId, type: 'full', keep: 1 })).toBe(1)
        expect(await db.crawls.knownUrls(good.id)).toHaveLength(1)
        expect(await db.crawls.knownUrls(failed.id)).toEqual([])
      })

      it('fails active crawls whose job has given up', async () => {
        const domainId = await domain()
        const { id, jobId } = await startCrawl(domainId)
        const otherDomainId = await domain('other.com')
        const healthy = await startCrawl(otherDomainId)

        await db.jobs.claim({ workerId: 'w', limit: 1 })
        expect(await db.crawls.failOrphaned()).toBe(0)

        await db.jobs.fail({ id: jobId, workerId: 'w', error: 'out of attempts' })
        expect(await db.crawls.failOrphaned()).toBe(1)
        expect(await db.crawls.get(id)).toMatchObject({
          status: 'failed',
          error: 'out of attempts',
        })
        expect(await db.crawls.active(domainId)).toBeNull()
        expect((await db.crawls.get(healthy.id))?.status).toBe('pending')
      })

      it('finds the most recent result of a URL across crawls', async () => {
        const domainId = await domain()
        const url = 'https://acme.com/'
        const first = await finishedCrawl(domainId, url)
        await new Promise((r) => setTimeout(r, 5))
        const second = await finishedCrawl(domainId, url)

        const [latest, ...rest] = await db.crawls.latestResults(domainId, [crawlUrlHash(url)])
        expect(rest).toEqual([])
        expect(latest?.crawlId).toBe(second.id)
        expect(latest?.crawlId).not.toBe(first.id)
        expect(await db.crawls.latestResults(domainId, [])).toEqual([])
        expect(await db.crawls.latestResults(domainId, ['missing'])).toEqual([])
      })

      describe('comparing and browsing retained crawls', () => {
        const site = 'https://acme.com'
        const urlOf = (path: string) => `${site}${path}`
        const hashOf = (path: string) => crawlUrlHash(urlOf(path))

        interface Page {
          kind?: CrawlUrlKind
          /** Found but never requested, as a crawl that stopped at its limit leaves it. */
          queued?: boolean
          result?: Partial<CrawlUrlResult>
          issues?: string[]
          excluded?: boolean
        }

        async function crawlOf(
          domainId: string,
          pages: Record<string, Page>,
          options: { status?: 'completed' | 'incomplete'; catalog?: string; version?: number } = {},
        ) {
          const crawl = await startCrawl(domainId)
          const entries = Object.entries(pages)
          await db.crawls.addUrls(crawl.id, [
            ...entries.map(([path]) => newUrl(urlOf(path))),
            newUrl('https://elsewhere.org/', { scope: 'external' }),
          ])
          for (const [path, page] of entries) {
            if (page.queued) continue
            await db.crawls.recordResult({
              crawlId: crawl.id,
              urlHash: hashOf(path),
              result: result(page.kind ?? 'page', page.result),
            })
          }
          await db.crawls.recordResult({
            crawlId: crawl.id,
            urlHash: crawlUrlHash('https://elsewhere.org/'),
            result: result('unknown', { statusCode: 200 }),
          })
          await db.crawls.finish(crawl.id, { status: options.status ?? 'completed' })
          await saveIssues({
            crawlId: crawl.id,
            issues: entries.flatMap(([path, page]) =>
              (page.issues ?? []).map((issue) => ({ urlHash: hashOf(path), issue })),
            ),
            pages: { issue: 0, warning: 0, opportunity: 0 },
            withType: { issue: 0, warning: 0, opportunity: 0 },
            catalog: options.catalog ?? 'v1',
            audit: {
              snapshot: { version: options.version ?? 0, rules: [] },
              urls: entries.map(([path, page]) => ({
                urlHash: hashOf(path),
                participation: page.excluded ? ('excluded' as const) : ('audited' as const),
                participationRule: null,
                intent: 'indexable' as const,
                intentRule: null,
                conditions: {},
                indexability: 'indexable' as const,
                blockers: [],
              })),
            },
          })
          // Retention and ordering look at creation time, which has millisecond resolution.
          await new Promise((r) => setTimeout(r, 5))
          return crawl
        }

        const base: Record<string, Page> = {
          '/': { result: { title: 'Home' }, issues: ['title-too-long'] },
          '/about': { result: { title: 'About' }, issues: ['h1-missing'] },
          '/old': { result: { title: 'Old' } },
          '/blog': { result: { title: 'Blog' } },
          '/news': { result: { title: 'News' } },
          '/team': { result: { title: 'Team' } },
          '/case': { result: { title: 'case' } },
          '/same': { result: { title: 'Same' }, issues: ['noindex'] },
          '/queued': { queued: true },
          '/logo.png': { kind: 'resource', result: { contentType: 'image/png' } },
        }
        const target: Record<string, Page> = {
          '/': { result: { title: 'Homepage' } },
          '/about': { result: { title: 'About' }, issues: ['h1-missing', 'noindex'] },
          '/new': { result: { title: 'New' } },
          '/blog': { result: { title: 'Blog', statusCode: 404 } },
          '/news': { result: { title: 'News', canonical: 'https://acme.com/news/' } },
          '/team': { result: { title: 'Team', metaRobots: 'noindex' } },
          '/case': { result: { title: 'Case' } },
          '/same': { result: { title: 'Same' }, issues: ['noindex'] },
          '/queued': { result: { title: 'Queued' } },
          '/logo.png': { kind: 'resource', result: { statusCode: 404 } },
        }

        async function pair() {
          const domainId = await domain()
          const older = await crawlOf(domainId, base)
          const newer = await crawlOf(domainId, target)
          return { domainId, baseId: older.id, targetId: newer.id }
        }

        const paths = (rows: { url: string }[]) => rows.map((row) => row.url.slice(site.length))
        const list = async (
          ids: { domainId: string; baseId: string; targetId: string },
          change: Parameters<Database['crawls']['compareUrls']>[0]['change'],
          options: Partial<Parameters<Database['crawls']['compareUrls']>[0]> = {},
        ) =>
          db.crawls.compareUrls({
            ...ids,
            change,
            view: 'pages',
            limit: 50,
            offset: 0,
            ...options,
          })

        it('counts what was added, is missing and changed, apart from the external URLs', async () => {
          const ids = await pair()
          expect(await db.crawls.compareCounts({ ...ids, view: 'pages' })).toEqual({
            added: 1,
            missing: 1,
            // Found by both, requested only by the later one.
            unrequested: 1,
            compared: 7,
            status: 1,
            title: 2,
            canonical: 1,
            robots: 1,
            gained: 1,
            lost: 1,
          })
          expect(await db.crawls.compareCounts({ ...ids, view: 'other' })).toEqual({
            added: 0,
            missing: 0,
            unrequested: 1,
            compared: 1,
            status: 1,
            title: 0,
            canonical: 0,
            robots: 0,
            gained: 0,
            lost: 0,
          })
        })

        it('lists URLs added and not seen, each with the side that has them', async () => {
          const ids = await pair()
          const added = await list(ids, 'added')
          expect(paths(added)).toEqual(['/new'])
          expect(added[0]).toMatchObject({
            urlHash: hashOf('/new'),
            base: null,
            target: { state: 'done', kind: 'page', statusCode: 200, title: 'New' },
          })
          const missing = await list(ids, 'missing')
          expect(paths(missing)).toEqual(['/old'])
          expect(missing[0]).toMatchObject({ target: null, base: { title: 'Old' } })
          // The external URL is in both crawls and in neither list.
          expect(await db.crawls.countCompared({ ...ids, change: 'added', view: 'pages' })).toBe(1)
        })

        it('lists the changes of an answer, with both sides', async () => {
          const ids = await pair()
          const status = await list(ids, 'status')
          expect(paths(status)).toEqual(['/blog'])
          expect(status[0]).toMatchObject({
            base: { statusCode: 200 },
            target: { statusCode: 404 },
          })
          expect(paths(await list(ids, 'canonical'))).toEqual(['/news'])
          expect((await list(ids, 'canonical'))[0]).toMatchObject({
            base: { canonical: null },
            target: { canonical: 'https://acme.com/news/' },
          })
          expect(paths(await list(ids, 'robots'))).toEqual(['/team'])
          expect((await list(ids, 'robots'))[0]).toMatchObject({
            base: { metaRobots: null },
            target: { metaRobots: 'noindex' },
          })
          expect(paths(await list(ids, 'status', { view: 'other' }))).toEqual(['/logo.png'])
        })

        it('tells a title that only changes case from the same title, in every dialect', async () => {
          const ids = await pair()
          expect(paths(await list(ids, 'title'))).toEqual(['/', '/case'])
        })

        it('does not compare a URL one crawl found and did not request', async () => {
          const ids = await pair()
          for (const change of [
            'status',
            'title',
            'canonical',
            'robots',
            'gained',
            'lost',
          ] as const) {
            expect(paths(await list(ids, change))).not.toContain('/queued')
          }
          expect(paths(await list(ids, 'added'))).not.toContain('/queued')
          expect(paths(await list(ids, 'missing'))).not.toContain('/queued')
        })

        it('lists the findings reported by one crawl only, and narrows them by issue', async () => {
          const ids = await pair()
          expect(paths(await list(ids, 'gained'))).toEqual(['/about'])
          expect(paths(await list(ids, 'lost'))).toEqual(['/'])
          expect(paths(await list(ids, 'gained', { issue: 'noindex' }))).toEqual(['/about'])
          expect(await list(ids, 'gained', { issue: 'h1-missing' })).toEqual([])
          expect(paths(await list(ids, 'lost', { issue: 'title-too-long' }))).toEqual(['/'])
          expect(await list(ids, 'lost', { issue: 'noindex' })).toEqual([])
          // The same finding on both sides is not a difference.
          expect(paths(await list(ids, 'gained'))).not.toContain('/same')
        })

        it('searches the URL or the title, pages a list and says how long it is', async () => {
          const ids = await pair()
          expect(paths(await list(ids, 'title', { search: 'CASE' }))).toEqual(['/case'])
          expect(paths(await list(ids, 'title', { search: 'homepage' }))).toEqual(['/'])
          expect(await list(ids, 'title', { search: '100%_' })).toEqual([])
          const query = { ...ids, change: 'title' as const, view: 'pages' as const }
          expect(await db.crawls.countCompared(query)).toBe(2)
          expect(await db.crawls.countCompared({ ...query, search: 'case' })).toBe(1)
          expect(paths(await list(ids, 'title', { limit: 1, offset: 1 }))).toEqual(['/case'])
          expect(await list(ids, 'title', { limit: 1, offset: 2 })).toEqual([])
        })

        it('compares crawls that stopped at their URL limit', async () => {
          const domainId = await domain()
          const older = await crawlOf(domainId, base, { status: 'incomplete' })
          const newer = await crawlOf(domainId, target, { status: 'incomplete' })
          const counts = await db.crawls.compareCounts({
            domainId,
            baseId: older.id,
            targetId: newer.id,
            view: 'pages',
          })
          expect(counts).toMatchObject({ added: 1, missing: 1 })
        })

        it('compares nothing that does not belong to the domain, or cannot be compared', async () => {
          const ids = await pair()
          const other = await domain('other.com')
          const query = { ...ids, change: 'added' as const, view: 'pages' as const }

          // Another domain's id, with this domain's crawls.
          expect(
            await db.crawls.compareCounts({ ...ids, domainId: other, view: 'pages' }),
          ).toBeNull()
          expect(
            await db.crawls.compareUrls({ ...query, domainId: other, limit: 5, offset: 0 }),
          ).toEqual([])
          expect(await db.crawls.countCompared({ ...query, domainId: other })).toBe(0)

          // One of the crawls is another domain's.
          const foreign = await crawlOf(other, { '/': {} })
          const mixed = { ...ids, targetId: foreign.id }
          expect(await db.crawls.compareCounts({ ...mixed, view: 'pages' })).toBeNull()
          expect(await db.crawls.countCompared({ ...query, ...mixed })).toBe(0)
          expect(
            await db.crawls.compareCounts({ ...ids, baseId: 'missing', view: 'pages' }),
          ).toBeNull()

          // The same crawl twice, or a priority crawl.
          expect(
            await db.crawls.compareCounts({ ...ids, targetId: ids.baseId, view: 'pages' }),
          ).toBeNull()
          const priority = await startCrawl(ids.domainId, 'priority')
          await db.crawls.finish(priority.id, { status: 'completed' })
          expect(
            await db.crawls.compareCounts({ ...ids, targetId: priority.id, view: 'pages' }),
          ).toBeNull()
        })

        it('compares nothing once the results of a crawl were pruned, keeping its totals', async () => {
          const ids = await pair()
          const newest = await crawlOf(ids.domainId, target)
          expect(await db.crawls.prune({ domainId: ids.domainId, type: 'full', keep: 2 })).toBe(1)
          expect(await db.crawls.get(ids.baseId)).toMatchObject({ pruned: true })
          expect(await db.crawls.compareCounts({ ...ids, view: 'pages' })).toBeNull()
          expect(await list(ids, 'added')).toEqual([])
          expect(await db.crawls.countCompared({ ...ids, change: 'added', view: 'pages' })).toBe(0)
          expect(
            await db.crawls.compareCounts({
              domainId: ids.domainId,
              baseId: ids.targetId,
              targetId: newest.id,
              view: 'pages',
            }),
          ).not.toBeNull()
        })

        it('finds a crawl only in its own domain', async () => {
          const ids = await pair()
          const other = await domain('other.com')
          expect(await db.crawls.getInDomain(ids.domainId, ids.baseId)).toMatchObject({
            id: ids.baseId,
            domainId: ids.domainId,
          })
          expect(await db.crawls.getInDomain(other, ids.baseId)).toBeNull()
          expect(await db.crawls.getInDomain(ids.domainId, 'missing')).toBeNull()
        })

        describe('the history of a URL', () => {
          it('gives what each retained crawl recorded of it, with its findings and audit state', async () => {
            const ids = await pair()
            const third = await crawlOf(ids.domainId, {
              '/': { result: { title: 'Homepage 3' }, issues: ['h1-missing'], excluded: true },
            })
            const crawlIds = [ids.baseId, ids.targetId, third.id]
            const history = await db.crawls.urlHistory({
              domainId: ids.domainId,
              crawlIds,
              urlHashes: [hashOf('/')],
            })
            const byCrawl = new Map(history.map((entry) => [entry.crawlId, entry]))
            expect(byCrawl.size).toBe(3)
            expect(byCrawl.get(ids.baseId)).toMatchObject({
              urlHash: hashOf('/'),
              url: urlOf('/'),
              snapshot: { title: 'Home', statusCode: 200, state: 'done', kind: 'page' },
              issues: [{ urlHash: hashOf('/'), issue: 'title-too-long' }],
              audit: { participation: 'audited' },
            })
            expect(byCrawl.get(ids.targetId)).toMatchObject({
              snapshot: { title: 'Homepage' },
              issues: [],
            })
            expect(byCrawl.get(third.id)?.audit).toMatchObject({ participation: 'excluded' })
          })

          it('has no entry for a crawl that does not have the URL', async () => {
            const ids = await pair()
            const history = await db.crawls.urlHistory({
              domainId: ids.domainId,
              crawlIds: [ids.baseId, ids.targetId],
              urlHashes: [hashOf('/old'), hashOf('/new')],
            })
            expect(
              history
                .map(
                  (entry) =>
                    `${entry.crawlId === ids.baseId ? 'base' : 'target'}${entry.url.slice(site.length)}`,
                )
                .sort(),
            ).toEqual(['base/old', 'target/new'])
          })

          it('leaves out external URLs, other domains, other types and pruned crawls', async () => {
            const ids = await pair()
            const newest = await crawlOf(ids.domainId, target)
            const other = await domain('other.com')
            const foreign = await crawlOf(other, { '/': {} })
            const priority = await startCrawl(ids.domainId, 'priority')
            await db.crawls.finish(priority.id, { status: 'completed' })
            await db.crawls.prune({ domainId: ids.domainId, type: 'full', keep: 2 })

            const hashes = [hashOf('/'), crawlUrlHash('https://elsewhere.org/')]
            const history = await db.crawls.urlHistory({
              domainId: ids.domainId,
              crawlIds: [ids.baseId, ids.targetId, newest.id, foreign.id, priority.id],
              urlHashes: hashes,
            })
            // The oldest was pruned; the foreign and priority crawls are not full crawls of the domain.
            expect(history.map((entry) => entry.crawlId).sort()).toEqual(
              [ids.targetId, newest.id].sort(),
            )
            expect(history.every((entry) => entry.urlHash === hashOf('/'))).toBe(true)
            // Asked with another domain, the same crawls give nothing.
            expect(
              await db.crawls.urlHistory({
                domainId: other,
                crawlIds: [ids.targetId, newest.id],
                urlHashes: hashes,
              }),
            ).toEqual([])
            expect(
              await db.crawls.urlHistory({
                domainId: ids.domainId,
                crawlIds: [],
                urlHashes: hashes,
              }),
            ).toEqual([])
            expect(
              await db.crawls.urlHistory({
                domainId: ids.domainId,
                crawlIds: [newest.id],
                urlHashes: [],
              }),
            ).toEqual([])
          })

          it('answers for more URLs and crawls than one query takes', async () => {
            const domainId = await domain()
            const crawl = await crawlOf(domainId, { '/': {} })
            const hashes = Array.from({ length: 450 }, (_, i) =>
              crawlUrlHash(urlOf(`/missing-${i}`)),
            )
            const history = await db.crawls.urlHistory({
              domainId,
              crawlIds: [...Array.from({ length: 250 }, (_, i) => `nope-${i}`), crawl.id],
              urlHashes: [...hashes, hashOf('/')],
            })
            expect(history.map((entry) => entry.urlHash)).toEqual([hashOf('/')])
          })
        })
      })
    })

    describe('rechecks of some URLs', () => {
      const verificationUrl = (url: string, overrides: Partial<NewVerificationUrl> = {}) => ({
        url,
        urlHash: crawlUrlHash(url),
        source: 'link' as const,
        ...overrides,
      })
      const answer = (overrides: Partial<VerificationAnswer> = {}): VerificationAnswer => ({
        kind: 'page',
        statusCode: 200,
        contentType: 'text/html',
        redirectTo: null,
        title: 'A title',
        metaRobots: null,
        xRobotsTag: null,
        canonical: null,
        responseTimeMs: 15,
        bytes: 1200,
        error: null,
        ...overrides,
      })
      const outcome = (issues: string[] = [], overrides: Partial<VerificationOutcome> = {}) => ({
        audit: {
          participation: 'audited' as const,
          participationRule: null,
          intent: 'indexable' as const,
          intentRule: null,
          conditions: {},
          indexability: 'indexable' as const,
          blockers: [],
        },
        findings: issues.map((issue) => ({ issue })),
        unchecked: [],
        ...overrides,
      })
      const domainOf = async (host = 'acme.com') => {
        const created = await createCompany(db, { name: host, domain: host })
        if (!created.ok) throw new Error('setup failed')
        return created.domain.id
      }
      const startVerification = async (
        domainId: string,
        urls = [verificationUrl('https://acme.com/a')],
      ) => {
        const started = await db.verifications.start({
          domainId,
          baseCrawlId: 'a-full-crawl',
          urls,
        })
        if (!started) throw new Error('recheck did not start')
        return started
      }

      it('starts a recheck together with its URLs and the job that runs it', async () => {
        const domainId = await domainOf()
        const urls = [verificationUrl('https://acme.com/b'), verificationUrl('https://acme.com/a')]
        const verification = await startVerification(domainId, urls)

        expect(verification).toMatchObject({
          domainId,
          status: 'pending',
          baseCrawlId: 'a-full-crawl',
          urlsCount: 2,
          urlsDoneCount: 0,
          error: null,
          startedAt: null,
          finishedAt: null,
        })
        expect(await db.jobs.get(verification.jobId)).toMatchObject({
          type: JOB_TYPES.urlVerify,
          status: 'pending',
          payload: { verificationId: verification.id },
        })
        expect((await db.verifications.active(domainId))?.id).toBe(verification.id)
        expect(await db.verifications.queued(verification.id, 10)).toEqual([
          verificationUrl('https://acme.com/a'),
          verificationUrl('https://acme.com/b'),
        ])
        expect(await db.verifications.urlsOf(verification.id)).toMatchObject([
          { url: 'https://acme.com/a', state: 'queued', outcome: null, fetchedAt: null },
          { url: 'https://acme.com/b', state: 'queued' },
        ])
      })

      it('is not a crawl: it leaves the crawls alone and does not block them', async () => {
        const domainId = await domainOf()
        await startVerification(domainId)
        expect(await db.crawls.active(domainId)).toBeNull()
        expect(await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })).not.toBeNull()
        expect(await db.crawls.list(domainId)).toHaveLength(1)
      })

      it('allows one active recheck per domain, and the other domains their own', async () => {
        const domainId = await domainOf()
        const otherId = await domainOf('other.com')
        const first = await startVerification(domainId)

        expect(
          await db.verifications.start({
            domainId,
            baseCrawlId: 'a-full-crawl',
            urls: [verificationUrl('https://acme.com/z')],
          }),
        ).toBeNull()
        expect(await db.verifications.list(domainId)).toHaveLength(1)
        expect((await db.jobs.countByStatus()).pending).toBe(1)
        expect(
          await db.verifications.start({
            domainId: otherId,
            baseCrawlId: 'a-full-crawl',
            urls: [verificationUrl('https://other.com/')],
          }),
        ).not.toBeNull()

        await db.verifications.finish(first.id, { status: 'completed' })
        expect(await db.verifications.active(domainId)).toBeNull()
        expect(
          await db.verifications.start({
            domainId,
            baseCrawlId: 'a-full-crawl',
            urls: [verificationUrl('https://acme.com/z')],
          }),
        ).not.toBeNull()
      })

      it('lets exactly one of several concurrent starts win', async () => {
        const domainId = await domainOf()
        const results = await Promise.all(
          [1, 2, 3, 4].map(() =>
            db.verifications.start({
              domainId,
              baseCrawlId: 'a-full-crawl',
              urls: [verificationUrl('https://acme.com/a')],
            }),
          ),
        )
        expect(results.filter(Boolean)).toHaveLength(1)
        expect(await db.verifications.list(domainId)).toHaveLength(1)
        expect((await db.jobs.countByStatus()).pending).toBe(1)
      })

      it('takes a bounded number of URLs, each once, and writes nothing otherwise', async () => {
        const domainId = await domainOf()
        const many = Array.from({ length: MAX_VERIFICATION_URLS + 1 }, (_, i) =>
          verificationUrl(`https://acme.com/${i}`),
        )
        const start = (urls: NewVerificationUrl[]) =>
          db.verifications.start({ domainId, baseCrawlId: 'a-full-crawl', urls })

        await expect(start([])).rejects.toThrow(RangeError)
        await expect(start(many)).rejects.toThrow(RangeError)
        await expect(
          start([verificationUrl('https://acme.com/a'), verificationUrl('https://acme.com/a')]),
        ).rejects.toThrow(RangeError)
        expect(await db.verifications.list(domainId)).toEqual([])
        expect((await db.jobs.countByStatus()).pending).toBe(0)
        await expect(start(many.slice(0, MAX_VERIFICATION_URLS))).resolves.not.toBeNull()
      })

      it('runs, cancels and finishes only while active', async () => {
        const domainId = await domainOf()
        const verification = await startVerification(domainId)

        const running = await db.verifications.markRunning(verification.id)
        expect(running?.status).toBe('running')
        expect(running?.startedAt).toBeInstanceOf(Date)
        // Running it again (a retry) neither fails nor moves when it started.
        expect((await db.verifications.markRunning(verification.id))?.startedAt).toEqual(
          running?.startedAt,
        )

        expect(await db.verifications.cancel(verification.id)).toBe(true)
        expect(await db.verifications.cancel(verification.id)).toBe(false)
        expect(await db.verifications.markRunning(verification.id)).toBeNull()
        expect(await db.verifications.finish(verification.id, { status: 'completed' })).toBe(false)
        expect(await db.verifications.get(verification.id)).toMatchObject({ status: 'cancelled' })
        expect((await db.verifications.get(verification.id))?.finishedAt).toBeInstanceOf(Date)
        expect(await db.verifications.active(domainId)).toBeNull()
      })

      it('records what a URL answered and concluded, and counts it once', async () => {
        const domainId = await domainOf()
        const a = verificationUrl('https://acme.com/a')
        const b = verificationUrl('https://acme.com/b')
        const verification = await startVerification(domainId, [a, b])
        await db.verifications.markRunning(verification.id)

        const first = {
          verificationId: verification.id,
          urlHash: a.urlHash,
          answer: answer({ title: 'Fresh title', statusCode: 200 }),
          auditVersion: 4,
          outcome: outcome(['title-too-short'], { unchecked: ['noindex'] }),
        }
        expect(await db.verifications.recordResult(first)).toBe(true)
        // Idempotent: a retried job writes the same result again, and the count does not grow.
        expect(await db.verifications.recordResult(first)).toBe(true)

        expect(await db.verifications.queued(verification.id, 10)).toEqual([b])
        expect((await db.verifications.get(verification.id))?.urlsDoneCount).toBe(1)
        const [stored] = await db.verifications.urlsOf(verification.id)
        expect(stored).toMatchObject({
          url: a.url,
          state: 'done',
          kind: 'page',
          statusCode: 200,
          title: 'Fresh title',
          auditVersion: 4,
          outcome: outcome(['title-too-short'], { unchecked: ['noindex'] }),
        })
        expect(stored?.fetchedAt).toBeInstanceOf(Date)
      })

      it('reads the outcome of a recheck from before conditions, with its accepted nofollow', async () => {
        const domainId = await domainOf()
        const a = verificationUrl('https://acme.com/a')
        const verification = await startVerification(domainId, [a])
        await db.verifications.markRunning(verification.id)
        // As an older recheck stored it: the flag, and no conditions at all.
        const { conditions: _conditions, ...audit } = outcome().audit
        await db.verifications.recordResult({
          verificationId: verification.id,
          urlHash: a.urlHash,
          answer: answer({ statusCode: 200 }),
          auditVersion: 2,
          outcome: {
            ...outcome(),
            audit: { ...audit, intentRule: 'r1', acceptNofollow: true },
          } as never,
        })
        const [stored] = await db.verifications.urlsOf(verification.id)
        expect(stored?.outcome?.audit.conditions).toEqual({
          nofollow: { requirement: 'allowed', rule: 'r1', observed: null },
        })
        expect(stored?.outcome?.audit).not.toHaveProperty('acceptNofollow')
      })

      it('stores a failed request as an answer of its own', async () => {
        const domainId = await domainOf()
        const a = verificationUrl('https://acme.com/a')
        const verification = await startVerification(domainId, [a])
        await db.verifications.recordResult({
          verificationId: verification.id,
          urlHash: a.urlHash,
          answer: answer({
            kind: 'unknown',
            statusCode: null,
            contentType: null,
            title: null,
            error: 'ETIMEDOUT: timed out',
            bytes: null,
          }),
          auditVersion: 0,
          outcome: outcome(['no-response']),
        })
        expect((await db.verifications.urlsOf(verification.id))[0]).toMatchObject({
          state: 'done',
          kind: 'unknown',
          statusCode: null,
          error: 'ETIMEDOUT: timed out',
        })
      })

      it('writes nothing once the recheck has ended, or for a URL it does not have', async () => {
        const domainId = await domainOf()
        const a = verificationUrl('https://acme.com/a')
        const verification = await startVerification(domainId, [a])
        const result = (urlHash: string) => ({
          verificationId: verification.id,
          urlHash,
          answer: answer(),
          auditVersion: 0,
          outcome: outcome(),
        })

        expect(await db.verifications.recordResult(result('not-a-url-of-it'))).toBe(false)
        await db.verifications.cancel(verification.id)
        expect(await db.verifications.recordResult(result(a.urlHash))).toBe(false)
        expect((await db.verifications.urlsOf(verification.id))[0]?.state).toBe('queued')
        expect((await db.verifications.get(verification.id))?.urlsDoneCount).toBe(0)
      })

      it('keeps a recheck of one domain from writing to another domain’s', async () => {
        const domainId = await domainOf()
        const otherId = await domainOf('other.com')
        const a = verificationUrl('https://acme.com/a')
        const mine = await startVerification(domainId, [a])
        await db.verifications.start({
          domainId: otherId,
          baseCrawlId: 'a-full-crawl',
          urls: [verificationUrl('https://other.com/a')],
        })
        const ofOther = (await db.verifications.active(otherId))!

        // The same hash under the other recheck is not a URL of it.
        expect(
          await db.verifications.recordResult({
            verificationId: ofOther.id,
            urlHash: a.urlHash,
            answer: answer(),
            auditVersion: 0,
            outcome: outcome(),
          }),
        ).toBe(false)
        expect((await db.verifications.urlsOf(mine.id))[0]?.state).toBe('queued')
      })

      it('ends with the count of what was done', async () => {
        const domainId = await domainOf()
        const a = verificationUrl('https://acme.com/a')
        const b = verificationUrl('https://acme.com/b')
        const verification = await startVerification(domainId, [a, b])
        await db.verifications.recordResult({
          verificationId: verification.id,
          urlHash: a.urlHash,
          answer: answer(),
          auditVersion: 0,
          outcome: outcome(),
        })

        expect(
          await db.verifications.finish(verification.id, { status: 'failed', error: 'boom' }),
        ).toBe(true)
        expect(await db.verifications.get(verification.id)).toMatchObject({
          status: 'failed',
          error: 'boom',
          urlsCount: 2,
          urlsDoneCount: 1,
        })
      })

      it('fails active rechecks whose job has given up', async () => {
        const domainId = await domainOf()
        const verification = await startVerification(domainId)
        expect(await db.verifications.failOrphaned()).toBe(0)

        await db.jobs.claim({ workerId: 'w1', limit: 1 })
        await db.jobs.fail({ id: verification.jobId, workerId: 'w1', error: 'it broke' })
        expect(await db.verifications.failOrphaned()).toBe(1)
        expect(await db.verifications.get(verification.id)).toMatchObject({
          status: 'failed',
          error: 'it broke',
        })
        expect(await db.verifications.active(domainId)).toBeNull()
        expect(await db.verifications.failOrphaned()).toBe(0)
      })

      it('finds the latest finished result of each URL, in the domain asked about only', async () => {
        const domainId = await domainOf()
        const otherId = await domainOf('other.com')
        const a = verificationUrl('https://acme.com/a')
        const b = verificationUrl('https://acme.com/b')
        const record = async (
          id: string,
          url: NewVerificationUrl,
          issues: string[],
          version: number,
        ) => {
          await db.verifications.recordResult({
            verificationId: id,
            urlHash: url.urlHash,
            answer: answer(),
            auditVersion: version,
            outcome: outcome(issues),
          })
        }

        const first = await startVerification(domainId, [a, b])
        await record(first.id, a, ['title-missing'], 1)
        await db.verifications.finish(first.id, { status: 'completed' })
        await new Promise((r) => setTimeout(r, 5))
        const second = await startVerification(domainId, [a])
        await record(second.id, a, [], 2)

        // The same URL under the same hash, in another domain's recheck.
        const foreign = await db.verifications.start({
          domainId: otherId,
          baseCrawlId: 'a-full-crawl',
          urls: [a],
        })
        await record(foreign!.id, a, ['noindex'], 9)

        const latest = await db.verifications.latestFor(domainId, [a.urlHash, b.urlHash, 'nope'])
        // `b` was never answered, so it has no result to show; `a` has the one of the second recheck.
        expect(latest).toHaveLength(1)
        expect(latest[0]).toMatchObject({
          url: a.url,
          verificationId: second.id,
          auditVersion: 2,
          outcome: { findings: [] },
        })
        expect(await db.verifications.latestFor(domainId, [])).toEqual([])
        expect((await db.verifications.latestFor(otherId, [a.urlHash]))[0]?.auditVersion).toBe(9)
      })

      it('keeps the newest ended rechecks and never an active one', async () => {
        const domainId = await domainOf()
        const otherId = await domainOf('other.com')
        const ids: string[] = []
        for (let i = 0; i < 4; i++) {
          const verification = await startVerification(domainId, [
            verificationUrl(`https://acme.com/${i}`),
          ])
          ids.push(verification.id)
          await db.verifications.finish(verification.id, { status: 'completed' })
          await new Promise((r) => setTimeout(r, 3))
        }
        const active = await startVerification(domainId, [verificationUrl('https://acme.com/live')])
        const foreign = await db.verifications.start({
          domainId: otherId,
          baseCrawlId: 'a-full-crawl',
          urls: [verificationUrl('https://other.com/')],
        })
        await db.verifications.finish(foreign!.id, { status: 'completed' })

        expect(await db.verifications.prune({ domainId, keep: 2 })).toBe(2)
        expect((await db.verifications.list(domainId)).map((v) => v.id)).toEqual([
          active.id,
          ids[3],
          ids[2],
        ])
        // Their URLs went with them.
        expect(await db.verifications.urlsOf(ids[0]!)).toEqual([])
        expect(await db.verifications.urlsOf(ids[3]!)).toHaveLength(1)
        expect(await db.verifications.list(otherId)).toHaveLength(1)
        expect(await db.verifications.prune({ domainId, keep: 2 })).toBe(0)
      })
    })

    describe('priority URLs', () => {
      it('keeps one entry per URL, per domain', async () => {
        const a = await createCompany(db, { name: 'A', domain: 'a.com' })
        const b = await createCompany(db, { name: 'B', domain: 'b.com' })
        if (!a.ok || !b.ok) throw new Error('setup failed')
        const url = 'https://a.com/pricing'

        await db.priorityUrls.add({ domainId: a.domain.id, url })
        await db.priorityUrls.add({ domainId: a.domain.id, url })
        await db.priorityUrls.add({ domainId: b.domain.id, url })

        expect(await db.priorityUrls.list(a.domain.id)).toMatchObject([
          { url, urlHash: crawlUrlHash(url) },
        ])
        await db.priorityUrls.remove({ domainId: a.domain.id, urlHash: crawlUrlHash(url) })
        expect(await db.priorityUrls.list(a.domain.id)).toEqual([])
        expect(await db.priorityUrls.list(b.domain.id)).toHaveLength(1)
      })
    })

    describe('crawl schedules', () => {
      const recurrence: CrawlRecurrence = {
        frequency: 'weekly',
        hour: 4,
        minute: 30,
        dayOfWeek: 2,
        dayOfMonth: 1,
        timeZone: 'Europe/Madrid',
      }

      async function domain() {
        const created = await createCompany(db, { name: 'Acme', domain: 'acme.com' })
        if (!created.ok) throw new Error('setup failed')
        return created.domain.id
      }

      it('keeps one schedule per domain and type', async () => {
        const domainId = await domain()
        const nextRunAt = new Date(Date.now() + minutes(60))
        const input = { ...recurrence, domainId, enabled: true, nextRunAt }
        await db.crawlSchedules.save({ ...input, type: 'full' })
        await db.crawlSchedules.save({ ...input, type: 'full', hour: 5 })
        await db.crawlSchedules.save({ ...input, type: 'priority', frequency: 'hourly' })

        const list = await db.crawlSchedules.list(domainId)
        expect(list).toHaveLength(2)
        expect(list.find((s) => s.type === 'full')).toMatchObject({
          ...recurrence,
          hour: 5,
          enabled: true,
          lastRunAt: null,
          lastOutcome: null,
        })
        expect(list.find((s) => s.type === 'priority')?.frequency).toBe('hourly')
      })

      it('only reports enabled schedules that are due', async () => {
        const domainId = await domain()
        const now = new Date()
        const base = { ...recurrence, domainId, type: 'full' as const }
        await db.crawlSchedules.save({
          ...base,
          enabled: true,
          nextRunAt: new Date(now.getTime() - 1000),
        })
        expect(await db.crawlSchedules.due({ now, limit: 10 })).toHaveLength(1)

        await db.crawlSchedules.save({
          ...base,
          enabled: false,
          nextRunAt: new Date(now.getTime() - 1000),
        })
        expect(await db.crawlSchedules.due({ now, limit: 10 })).toEqual([])

        await db.crawlSchedules.save({
          ...base,
          enabled: true,
          nextRunAt: new Date(now.getTime() + 1000),
        })
        expect(await db.crawlSchedules.due({ now, limit: 10 })).toEqual([])
      })

      it('lets only one worker advance a due schedule', async () => {
        const domainId = await domain()
        const now = new Date()
        const expectedNextRunAt = new Date(now.getTime() - 1000)
        await db.crawlSchedules.save({
          ...recurrence,
          domainId,
          type: 'full',
          enabled: true,
          nextRunAt: expectedNextRunAt,
        })
        const [schedule] = await db.crawlSchedules.due({ now, limit: 1 })
        const nextRunAt = new Date(now.getTime() + minutes(60))

        const results = await Promise.all(
          [1, 2, 3].map(() =>
            db.crawlSchedules.advance({ id: schedule!.id, expectedNextRunAt, nextRunAt, now }),
          ),
        )
        expect(results.filter(Boolean)).toHaveLength(1)
        expect(await db.crawlSchedules.due({ now, limit: 1 })).toEqual([])

        await db.crawlSchedules.recordOutcome({ id: schedule!.id, outcome: 'skipped-active' })
        const [saved] = await db.crawlSchedules.list(domainId)
        expect(saved?.lastOutcome).toBe('skipped-active')
        expect(saved?.lastRunAt).toBeInstanceOf(Date)
      })
    })

    describe('crawl files', () => {
      const at = new Date('2026-06-15T10:00:00.000Z')
      const later = new Date('2026-06-15T11:00:00.000Z')

      const domain = async () => {
        const created = await createCompany(db, { name: 'Acme', domain: 'example.com' })
        if (!created.ok) throw new Error('setup failed')
        return created.domain.id
      }
      const file = (overrides: Partial<NewCrawlFile> = {}): NewCrawlFile => ({
        url: 'https://example.com/robots.txt',
        kind: 'robots',
        statusCode: 200,
        contentType: 'text/plain',
        redirectTo: null,
        bytes: 25,
        truncated: false,
        body: 'User-agent: *',
        error: null,
        data: null,
        via: 'crawl',
        fetchedAt: at,
        ...overrides,
      })

      it('keeps one row per URL, replaced by each request', async () => {
        const domainId = await domain()
        await db.crawlFiles.save(domainId, [file()])
        await db.crawlFiles.save(domainId, [
          file({
            statusCode: null,
            body: null,
            error: 'TIMEOUT',
            via: 'refresh',
            fetchedAt: later,
          }),
        ])
        const [stored, ...rest] = await db.crawlFiles.list(domainId)
        expect(rest).toEqual([])
        expect(stored).toMatchObject({
          domainId,
          statusCode: null,
          body: null,
          error: 'TIMEOUT',
          via: 'refresh',
          fetchedAt: later,
        })
      })

      it('lists by kind, sorted by URL, and round-trips the data', async () => {
        const domainId = await domain()
        const data = {
          sitemap: { format: 'urlset' as const, entries: 3, lastModified: '2026-01-01T00:00:00Z' },
        }
        await db.crawlFiles.save(domainId, [
          file({ url: 'https://example.com/z.xml', kind: 'sitemap', body: null, data }),
          file(),
          file({ url: 'https://example.com/a.xml', kind: 'sitemap', body: null, truncated: true }),
        ])

        const sitemaps = await db.crawlFiles.list(domainId, ['sitemap'])
        expect(sitemaps.map((row) => row.url)).toEqual([
          'https://example.com/a.xml',
          'https://example.com/z.xml',
        ])
        expect(sitemaps[0]?.truncated).toBe(true)
        expect(sitemaps[1]?.data).toEqual(data)
        expect(await db.crawlFiles.list(domainId)).toHaveLength(3)
      })

      it('makes whatever a site sends fit', async () => {
        const domainId = await domain()
        await db.crawlFiles.save(domainId, [
          file({ body: 'a\u0000b', bytes: 5_000_000_000, contentType: 'x'.repeat(1000) }),
        ])
        const [stored] = await db.crawlFiles.list(domainId)
        expect(stored?.body).toBe('ab')
        expect(stored?.bytes).toBe(2_147_483_647)
        expect(stored?.contentType).toHaveLength(255)
      })

      it('holds a large body', async () => {
        const domainId = await domain()
        const body = 'x'.repeat(512 * 1024)
        await db.crawlFiles.save(domainId, [file({ body })])
        expect((await db.crawlFiles.list(domainId))[0]?.body).toHaveLength(body.length)
      })

      it('prunes what no request reached, except the kinds it is told to keep', async () => {
        const domainId = await domain()
        await db.crawlFiles.save(domainId, [
          file({ url: 'https://example.com/old.txt', kind: 'llms' }),
          file({ url: 'https://example.com/old.xml', kind: 'sitemap' }),
          file({ url: 'https://example.com/new.txt', kind: 'llms', fetchedAt: later }),
        ])
        expect(await db.crawlFiles.prune({ domainId, before: later, keepKinds: ['sitemap'] })).toBe(
          1,
        )
        expect((await db.crawlFiles.list(domainId)).map((row) => row.url)).toEqual([
          'https://example.com/new.txt',
          'https://example.com/old.xml',
        ])
        expect(await db.crawlFiles.prune({ domainId, before: later })).toBe(1)
      })

      it('makes a domain due until it is checked, and again when asked', async () => {
        const domainId = await domain()
        const next = new Date(at.getTime() + 86_400_000)
        expect(await db.crawlFiles.getCheck(domainId)).toBeNull()
        expect(await db.crawlFiles.dueChecks({ now: at, limit: 10 })).toEqual([
          { id: domainId, host: 'example.com' },
        ])

        await db.crawlFiles.finishCheck({
          domainId,
          outcome: 'ok',
          checkedAt: at,
          nextCheckAt: next,
        })
        expect(await db.crawlFiles.dueChecks({ now: at, limit: 10 })).toEqual([])
        expect(await db.crawlFiles.dueChecks({ now: next, limit: 10 })).toHaveLength(1)

        await db.crawlFiles.requestCheck({ domainId, now: later })
        expect(await db.crawlFiles.getCheck(domainId)).toMatchObject({
          requestedAt: later,
          nextCheckAt: later,
          outcome: 'ok',
          checkedAt: at,
        })
        expect(await db.crawlFiles.dueChecks({ now: later, limit: 10 })).toHaveLength(1)

        await db.crawlFiles.finishCheck({
          domainId,
          outcome: 'unreachable',
          checkedAt: later,
          nextCheckAt: next,
        })
        expect(await db.crawlFiles.getCheck(domainId)).toMatchObject({
          requestedAt: null,
          outcome: 'unreachable',
          checkedAt: later,
          nextCheckAt: next,
        })
      })

      it('lets one of several workers claim a check, including a first one', async () => {
        const domainId = await domain()
        const claim = () => db.crawlFiles.claimCheck({ domainId, now: at, retryAt: later })
        const results = await Promise.all([claim(), claim(), claim()])
        expect(results.filter(Boolean)).toHaveLength(1)
        expect(await db.crawlFiles.dueChecks({ now: at, limit: 10 })).toEqual([])
        expect((await db.crawlFiles.getCheck(domainId))?.nextCheckAt).toEqual(later)

        await db.crawlFiles.requestCheck({ domainId, now: at })
        await db.crawlFiles.deferCheck({ domainId, nextCheckAt: later })
        expect(await db.crawlFiles.getCheck(domainId)).toMatchObject({
          requestedAt: null,
          nextCheckAt: later,
        })
      })
    })

    describe('favicons', () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255, 128, 7])
      const icon = (data = png) => ({
        contentType: 'image/png',
        data,
        sourceUrl: 'https://acme.com/icon.png',
      })
      const setupDomain = async (host = 'acme.com') => {
        const created = await createCompany(db, { name: `Owner of ${host}`, domain: host })
        if (!created.ok) throw new Error('company not created')
        return created.domain.id
      }

      it('lists the domains that were never checked', async () => {
        const now = new Date()
        const first = await setupDomain('first.com')
        const second = await setupDomain('second.com')
        const due = await db.favicons.due({ now, limit: 10 })
        expect(due.toSorted((a, b) => a.host.localeCompare(b.host))).toEqual([
          { id: first, host: 'first.com' },
          { id: second, host: 'second.com' },
        ])
        expect(await db.favicons.due({ now, limit: 1 })).toHaveLength(1)
      })

      it('stores the bytes of an icon exactly and versions them by content', async () => {
        const domainId = await setupDomain()
        const nextCheckAt = new Date(Date.now() + minutes(60))
        await db.favicons.save({ domainId, icon: icon(), nextCheckAt })

        const stored = await db.favicons.get(domainId)
        expect(stored).toMatchObject({
          domainId,
          contentType: 'image/png',
          sourceUrl: 'https://acme.com/icon.png',
        })
        expect(stored?.data.equals(png)).toBe(true)
        expect(stored?.hash).toMatch(/^[0-9a-f]{16}$/)
        expect((await db.favicons.versions()).get(domainId)).toBe(stored?.hash)

        // The same image keeps its version; another image changes it.
        await db.favicons.save({ domainId, icon: icon(), nextCheckAt })
        expect((await db.favicons.get(domainId))?.hash).toBe(stored?.hash)
        await db.favicons.save({ domainId, icon: icon(Buffer.from([...png, 1])), nextCheckAt })
        expect((await db.favicons.get(domainId))?.hash).not.toBe(stored?.hash)
      })

      it('is not due again until its next check', async () => {
        const domainId = await setupDomain()
        const now = new Date()
        await db.favicons.save({
          domainId,
          icon: icon(),
          nextCheckAt: new Date(+now + minutes(60)),
        })
        expect(await db.favicons.due({ now, limit: 10 })).toEqual([])
        expect(await db.favicons.due({ now: new Date(+now + minutes(61)), limit: 10 })).toEqual([
          { id: domainId, host: 'acme.com' },
        ])
      })

      it('records that a site has no icon, and drops the one it had', async () => {
        const domainId = await setupDomain()
        const now = new Date()
        await db.favicons.save({ domainId, icon: icon(), nextCheckAt: now })
        await db.favicons.save({ domainId, icon: null, nextCheckAt: new Date(+now + minutes(60)) })

        expect(await db.favicons.get(domainId)).toBeNull()
        expect((await db.favicons.versions()).has(domainId)).toBe(false)
        // Checked, so it waits for its next check instead of being retried at once.
        expect(await db.favicons.due({ now, limit: 10 })).toEqual([])
      })

      it('keeps the icon it has when a check could not tell', async () => {
        const domainId = await setupDomain()
        const now = new Date()
        await db.favicons.save({ domainId, icon: icon(), nextCheckAt: now })
        await db.favicons.defer({ domainId, nextCheckAt: new Date(+now + minutes(60)) })

        expect((await db.favicons.get(domainId))?.data.equals(png)).toBe(true)
        expect(await db.favicons.due({ now, limit: 10 })).toEqual([])

        // Deferring a domain that was never checked also stops it from being due.
        const other = await setupDomain('other.com')
        await db.favicons.defer({ domainId: other, nextCheckAt: new Date(+now + minutes(60)) })
        expect(await db.favicons.due({ now, limit: 10 })).toEqual([])
        expect(await db.favicons.get(other)).toBeNull()
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
