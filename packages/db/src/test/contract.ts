import {
  DEFAULT_CRAWL_SETTINGS,
  JOB_TYPES,
  crawlUrlHash,
  type CrawlRecurrence,
  type CrawlUrlKind,
} from '@seotools/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createFirstAdmin, needsSetup } from '../admin'
import type { CrawlUrlResult, Database, NewCrawlFile, NewCrawlUrl } from '../types'
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
          await db.crawls.saveIssues({
            crawlId,
            issues: [
              { urlHash: hashOf(pages.gone), issue: 'http-error' },
              { urlHash: hashOf(pages.gone), issue: 'missing-title' },
              { urlHash: hashOf(pages.deep), issue: 'missing-title' },
            ],
            pages: { issue: 2, warning: 0, opportunity: 0 },
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
          await db.crawls.saveIssues({
            crawlId,
            issues: [
              { urlHash: hashOf(pages.gone), issue: 'client-error' },
              { urlHash: crawlUrlHash(`${site}/logo.png`), issue: 'client-error' },
              { urlHash: crawlUrlHash('https://elsewhere.org/'), issue: 'client-error' },
            ],
            pages: { issue: 1, warning: 0, opportunity: 0 },
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

        it('remembers what a domain counts as having issues', async () => {
          const domainId = await domain()
          const base = await db.crawls.settings(domainId)
          expect(base.issueThreshold).toBe('warning')
          await db.crawls.saveSettings(domainId, { ...base, issueThreshold: 'issue' })
          expect((await db.crawls.settings(domainId)).issueThreshold).toBe('issue')
        })
      })

      describe('page issues', () => {
        it('replaces the issues of a crawl and says how many pages have any', async () => {
          const domainId = await domain()
          const { id } = await startCrawl(domainId)
          expect((await db.crawls.get(id))?.pagesByWorstIssue).toBeNull()

          await db.crawls.saveIssues({
            crawlId: id,
            issues: [
              { urlHash: 'a', issue: 'http-error' },
              { urlHash: 'a', issue: 'missing-title', details: ['x', 'y'] },
              { urlHash: 'a', issue: 'missing-title', details: ['x', 'y'] },
              { urlHash: 'b', issue: 'missing-title' },
            ],
            pages: { issue: 1, warning: 2, opportunity: 3 },
          })
          expect((await db.crawls.get(id))?.pagesByWorstIssue).toEqual({
            issue: 1,
            warning: 2,
            opportunity: 3,
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
          await db.crawls.saveIssues({
            crawlId: id,
            issues: [],
            pages: { issue: 0, warning: 0, opportunity: 0 },
          })
          expect((await db.crawls.get(id))?.pagesByWorstIssue).toEqual({
            issue: 0,
            warning: 0,
            opportunity: 0,
          })
          expect(await db.crawls.issueCounts(id)).toEqual([])
        })

        it('keeps the count of a pruned crawl but not its issues', async () => {
          const domainId = await domain()
          const oldest = await finishedCrawl(domainId)
          const newest = await finishedCrawl(domainId)
          for (const crawl of [oldest, newest]) {
            await db.crawls.saveIssues({
              crawlId: crawl.id,
              issues: [{ urlHash: crawlUrlHash('https://acme.com/'), issue: 'missing-title' }],
              pages: { issue: 1, warning: 0, opportunity: 0 },
            })
          }

          expect(await db.crawls.prune({ domainId, type: 'full', keep: 1 })).toBe(1)
          expect(await db.crawls.get(oldest.id)).toMatchObject({
            pruned: true,
            pagesByWorstIssue: { issue: 1, warning: 0, opportunity: 0 },
          })
          expect(await db.crawls.issueCounts(oldest.id)).toEqual([])
          expect(await db.crawls.issueCounts(newest.id)).toEqual([
            { issue: 'missing-title', pages: 1 },
          ])
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
