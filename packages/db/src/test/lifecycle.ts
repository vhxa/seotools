import {
  emptyVitals,
  DEFAULT_CRAWL_SETTINGS,
  EMPTY_AUDIT_SNAPSHOT,
  crawlUrlHash,
  type CrawlRecurrence,
} from '@seotools/core'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { is } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DomainArchivedError } from '../archive'
import * as sqliteSchema from '../schema/sqlite'
import type { Database } from '../types'
import {
  addDomain,
  createCompany,
  deleteCompany,
  deleteDomain,
  moveDomain,
  renameCompany,
} from '../workspace'

const DAY = 24 * 60 * 60_000

/**
 * The tables that hold something of a domain: those that reference it, and, recursively, those that
 * reference them (the URLs of a crawl). Read from the schema, so a table added later is included
 * and must be removed along with its domain, or this suite fails.
 */
function domainTables(): string[] {
  const tables = Object.values(sqliteSchema)
    // Account preferences survive domain deletion with a null reference (contract-tested).
    .filter((value) => is(value, SQLiteTable) && value !== sqliteSchema.userPreferences)
    .map((value) => getTableConfig(value as SQLiteTable))
  const referencing = (target: string) =>
    tables
      .filter((table) =>
        table.foreignKeys.some((fk) => getTableConfig(fk.reference().foreignTable).name === target),
      )
      .map((table) => table.name)
  const found = new Set<string>()
  const pending = ['domains']
  while (pending.length > 0) {
    for (const name of referencing(pending.pop()!)) {
      if (!found.has(name)) {
        found.add(name)
        pending.push(name)
      }
    }
  }
  return [...found].sort()
}

const recurrence: CrawlRecurrence = {
  frequency: 'daily',
  hour: 4,
  minute: 0,
  dayOfWeek: 1,
  dayOfMonth: 1,
  timeZone: 'UTC',
}
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255, 128, 7])

/** Behaviour of archiving, moving and deleting companies and domains, on every dialect. */
export function describeLifecycle(
  getDb: () => Database,
  countRows: (table: string) => Promise<number>,
) {
  describe('company and domain lifecycle', () => {
    const db = new Proxy({} as Database, { get: (_t, key) => getDb()[key as keyof Database] })

    async function company(name: string, host: string) {
      const created = await createCompany(db, { name, domain: host })
      if (!created.ok) throw new Error('setup failed')
      return created
    }

    /** A domain with something in every table that holds data of a domain. */
    async function populated(host: string, companyName = `${host} Inc`) {
      const { domain, company: owner } = await company(companyName, host)
      const domainId = domain.id
      const botRun = await db.botTests.start({ domainId, requestedBy: 'editor' })
      await db.botTests.record({
        runId: botRun!.id,
        botToken: 'baseline',
        statusCode: 200,
        finalUrl: `https://${host}/`,
        responseTimeMs: 1,
        bytes: 2,
        errorCode: null,
        verdict: 'unknown',
        reasons: [],
      })
      const url = `https://${host}/`
      const other = `https://${host}/about`
      await db.crawls.saveSettings(domainId, { ...DEFAULT_CRAWL_SETTINGS, concurrency: 3 })
      await db.crawls.saveRequestSecrets(domainId, 'v1:ciphertext')
      const member = await db.users.create({
        email: `member@${host}`,
        name: 'Member',
        role: 'member',
      })
      await db.users.setGrants(member.id, [{ role: 'viewer', companyId: null, domainId }])
      await db.crawlSchedules.save({
        ...recurrence,
        domainId,
        type: 'full',
        enabled: true,
        nextRunAt: new Date(Date.now() + DAY),
      })
      await db.priorityUrls.add({ domainId, url })
      await db.audit.saveRule({
        domainId,
        rule: {
          dimension: 'audit',
          value: 'exclude',
          selector: {
            kind: 'prefix',
            path: '/cart',
            query: { mode: 'any' },
            scope: 'literal',
          },
          reason: null,
          enabled: true,
        },
      })
      await db.favicons.save({
        domainId,
        icon: { contentType: 'image/png', data: png, sourceUrl: `${url}icon.png` },
        nextCheckAt: new Date(Date.now() + DAY),
      })
      await db.crawlFiles.save(domainId, [
        {
          url: `${url}robots.txt`,
          kind: 'robots',
          statusCode: 200,
          contentType: 'text/plain',
          redirectTo: null,
          bytes: 13,
          truncated: false,
          body: 'User-agent: *',
          error: null,
          data: null,
          via: 'crawl',
          fetchedAt: new Date(),
        },
      ])
      const [robotsFile] = await db.crawlFiles.list(domainId, ['robots'])
      await db.crawlFiles.save(domainId, [{ ...robotsFile!, body: 'User-agent: *\nDisallow: /' }])
      const incident = (await db.incidents.list(domainId))[0]!
      await db.incidents.claim(incident.id, member.id, incident.stage)
      await db.crawlFiles.requestCheck({ domainId, now: new Date() })

      // An older crawl, whose results are pruned to the compact history below.
      const older = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
      if (!older) throw new Error('crawl did not start')
      await db.crawls.addUrls(older.id, [
        { url, urlHash: crawlUrlHash(url), scope: 'internal', source: 'seed', depth: 0, seq: 1 },
      ])
      await db.crawls.recordResult({
        crawlId: older.id,
        urlHash: crawlUrlHash(url),
        result: {
          kind: 'page',
          statusCode: 200,
          contentType: 'text/html',
          redirectTo: null,
          title: 'Home',
          metaRobots: null,
          xRobotsTag: null,
          canonical: null,
          responseTimeMs: 10,
          bytes: 100,
          error: null,
          data: null,
        },
      })
      await db.crawls.finish(older.id, { status: 'completed' })

      const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
      if (!crawl) throw new Error('crawl did not start')
      const page = (u: string) => ({
        url: u,
        urlHash: crawlUrlHash(u),
        scope: 'internal' as const,
        source: 'link' as const,
        depth: 1,
        seq: u === url ? 1 : 2,
      })
      await db.crawls.addUrls(crawl.id, [page(url), page(other)])
      await db.crawls.recordResult({
        crawlId: crawl.id,
        urlHash: crawlUrlHash(url),
        result: {
          kind: 'page',
          statusCode: 200,
          contentType: 'text/html',
          redirectTo: null,
          title: 'Home',
          metaRobots: null,
          xRobotsTag: null,
          canonical: null,
          responseTimeMs: 10,
          bytes: 100,
          error: null,
          data: null,
        },
        links: [{ sourceHash: crawlUrlHash(url), targetHash: crawlUrlHash(other), kind: 'anchor' }],
      })
      await db.crawls.addSitemapHreflang(crawl.id, [
        { pageHash: crawlUrlHash(url), lang: 'es', url: `${url}es` },
      ])
      await db.crawls.finish(crawl.id, { status: 'completed' })
      await db.vitals.queueAlerts(crawl.id)
      const vital = {
        ...emptyVitals(),
        crawlId: crawl.id,
        formFactor: 'PHONE',
        status: 'collected',
        error: null,
        collectedAt: new Date(),
      }
      await db.vitals.saveOrigin(vital)
      await db.vitals.saveUrl({ ...vital, urlHash: crawlUrlHash(url), source: 'field' })
      expect(await db.crawls.prune({ domainId, type: 'full', keep: 1 })).toBe(1)
      await db.alerts.save({
        userId: member.id,
        locale: 'en',
        domains: [{ domainId, kinds: ['crawl-problem'] }],
      })
      await db.alerts.claim({ crawlId: crawl.id, userId: member.id, kinds: ['crawl-problem'] })
      await db.crawls.saveAnalysis({
        crawlId: crawl.id,
        issues: [{ urlHash: crawlUrlHash(url), issue: 'missing-title' }],
        accepted: [
          {
            urlHash: crawlUrlHash(url),
            issue: 'noindex',
            acceptedBy: crawlUrlHash(url),
            acceptance: { kind: 'expectation', rule: null },
          },
        ],
        pages: { issue: 1, warning: 0, opportunity: 0 },
        withType: { issue: 1, warning: 0, opportunity: 0 },
        catalog: 'v1',
        audit: {
          snapshot: EMPTY_AUDIT_SNAPSHOT,
          pages: { audited: 1, excluded: 0, indexable: 1, notIndexable: 0, unknownIndexability: 0 },
          urls: [
            {
              urlHash: crawlUrlHash(url),
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
      const recheck = await db.verifications.start({
        domainId,
        baseCrawlId: crawl.id,
        urls: [{ url, urlHash: crawlUrlHash(url), source: 'link' }],
      })
      if (!recheck) throw new Error('recheck did not start')
      await db.verifications.finish(recheck.id, { status: 'completed' })
      return { domainId, host, url, company: owner, crawlId: crawl.id, recheckId: recheck.id }
    }

    async function rowCounts(tables: string[]) {
      return Object.fromEntries(
        await Promise.all(tables.map(async (table) => [table, await countRows(table)] as const)),
      )
    }

    describe('archiving', () => {
      it('keeps every row and stays readable, remembering the first date', async () => {
        const site = await populated('acme.com')
        const before = await rowCounts(domainTables())

        const archived = await db.domains.archive(site.domainId)
        expect(archived?.archivedAt).toBeInstanceOf(Date)
        const again = await db.domains.archive(site.domainId)
        expect(again?.archivedAt).toEqual(archived?.archivedAt)

        expect(await rowCounts(domainTables())).toEqual(before)
        expect((await db.domains.findByHost('acme.com'))?.archivedAt).toEqual(archived?.archivedAt)
        expect((await db.companies.list())[0]?.domains[0]?.archivedAt).toEqual(archived?.archivedAt)
        expect((await db.crawls.latestWithResults(site.domainId, 'full'))?.id).toBe(site.crawlId)
        expect(await db.crawls.countUrls(site.crawlId)).toMatchObject({ urlsCount: 2 })
        expect((await db.crawls.settings(site.domainId)).concurrency).toBe(3)
        expect(await db.verifications.list(site.domainId)).toHaveLength(1)

        expect(await db.domains.archive('missing')).toBeNull()
      })

      it('stops an active crawl and recheck, the way cancelling does', async () => {
        const site = await populated('acme.com')
        const bystander = await populated('other.com')
        const crawl = await db.crawls.start({
          domainId: site.domainId,
          type: 'full',
          trigger: 'manual',
        })
        const running = await db.crawls.start({
          domainId: bystander.domainId,
          type: 'full',
          trigger: 'manual',
        })
        const recheck = await db.verifications.start({
          domainId: site.domainId,
          baseCrawlId: site.crawlId,
          urls: [{ url: site.url, urlHash: crawlUrlHash(site.url), source: 'link' }],
        })
        expect(crawl && running && recheck).toBeTruthy()
        await db.crawls.markRunning(crawl!.id)

        await db.domains.archive(site.domainId)

        expect(await db.crawls.active(site.domainId)).toBeNull()
        expect((await db.crawls.get(crawl!.id))?.status).toBe('cancelled')
        expect(await db.verifications.active(site.domainId)).toBeNull()
        expect((await db.verifications.get(recheck!.id))?.status).toBe('cancelled')
        // What a worker asks before every step: a cancelled crawl is not running any more, and a
        // job that has not started finds nothing to do.
        expect(await db.crawls.markRunning(crawl!.id)).toBeNull()
        expect(await db.verifications.markRunning(recheck!.id)).toBeNull()
        // Another domain is left alone.
        expect((await db.crawls.active(bystander.domainId))?.id).toBe(running!.id)
      })

      it('refuses to start a crawl or a recheck, creating nothing', async () => {
        const site = await populated('acme.com')
        await db.domains.archive(site.domainId)
        const crawls = (await db.crawls.list(site.domainId)).length
        const jobs = (await db.jobs.list({ limit: 100 })).length

        await expect(
          db.crawls.start({ domainId: site.domainId, type: 'full', trigger: 'schedule' }),
        ).rejects.toBeInstanceOf(DomainArchivedError)
        await expect(
          db.verifications.start({
            domainId: site.domainId,
            baseCrawlId: site.crawlId,
            urls: [{ url: site.url, urlHash: crawlUrlHash(site.url), source: 'link' }],
          }),
        ).rejects.toBeInstanceOf(DomainArchivedError)

        expect((await db.crawls.list(site.domainId)).length).toBe(crawls)
        expect(await db.verifications.list(site.domainId)).toHaveLength(1)
        expect((await db.jobs.list({ limit: 100 })).length).toBe(jobs)
        expect(await db.crawls.active(site.domainId)).toBeNull()
      })

      it('refuses changes to settings, schedules, priority URLs, rules and files', async () => {
        const site = await populated('acme.com')
        const rules = (await db.audit.config(site.domainId)).rules
        await db.domains.archive(site.domainId)
        const refused = (promise: Promise<unknown>) =>
          expect(promise).rejects.toBeInstanceOf(DomainArchivedError)
        const rule = rules[0]!

        await refused(db.crawls.saveSettings(site.domainId, DEFAULT_CRAWL_SETTINGS))
        await refused(db.crawls.saveRequestSecrets(site.domainId, 'v1:ciphertext'))
        await refused(
          db.crawlSchedules.save({
            ...recurrence,
            domainId: site.domainId,
            type: 'priority',
            enabled: true,
            nextRunAt: new Date(),
          }),
        )
        await refused(db.priorityUrls.add({ domainId: site.domainId, url: `${site.url}new` }))
        await refused(
          db.priorityUrls.remove({ domainId: site.domainId, urlHash: crawlUrlHash(site.url) }),
        )
        await refused(db.crawlFiles.requestCheck({ domainId: site.domainId, now: new Date() }))
        await refused(db.audit.saveRule({ domainId: site.domainId, rule }))
        await refused(db.audit.deleteRule({ domainId: site.domainId, id: rule.id }))
        await refused(
          db.audit.setRuleEnabled({ domainId: site.domainId, id: rule.id, enabled: false }),
        )
        await refused(
          db.audit.setRulesEnabled({ domainId: site.domainId, ids: [rule.id], enabled: false }),
        )
        await refused(db.audit.deleteRules({ domainId: site.domainId, ids: [rule.id] }))
        await refused(
          db.audit.setLanguages({
            domainId: site.domainId,
            languages: { prefixes: ['es'], unprefixed: false },
          }),
        )
        await refused(
          db.audit.setUrlConfig({
            domainId: site.domainId,
            host: site.host,
            urls: [site.url],
            audit: 'exclude',
          }),
        )

        expect((await db.crawls.settings(site.domainId)).concurrency).toBe(3)
        expect(await db.crawlSchedules.list(site.domainId)).toHaveLength(1)
        expect(await db.priorityUrls.list(site.domainId)).toHaveLength(1)
        expect((await db.audit.config(site.domainId)).rules).toEqual(rules)
      })

      it('lets another domain change while one is archived', async () => {
        const site = await populated('acme.com')
        const other = await populated('other.com')
        await db.domains.archive(site.domainId)
        await db.priorityUrls.add({ domainId: other.domainId, url: `${other.url}new` })
        expect(await db.priorityUrls.list(other.domainId)).toHaveLength(2)
      })

      it('leaves an archived domain out of everything that runs by itself', async () => {
        const now = new Date()
        const site = await populated('acme.com')
        const other = await populated('other.com')
        const past = new Date(now.getTime() - DAY)
        await db.crawlSchedules.save({
          ...recurrence,
          domainId: site.domainId,
          type: 'full',
          enabled: true,
          nextRunAt: past,
        })
        await db.crawlSchedules.save({
          ...recurrence,
          domainId: other.domainId,
          type: 'full',
          enabled: true,
          nextRunAt: past,
        })
        await db.favicons.defer({ domainId: site.domainId, nextCheckAt: past })
        await db.favicons.defer({ domainId: other.domainId, nextCheckAt: past })
        await db.crawlFiles.requestCheck({ domainId: other.domainId, now })
        // Not archived yet: asking is allowed. Archiving then leaves its check due but unseen.
        await db.crawlFiles.requestCheck({ domainId: site.domainId, now })

        const dueDomains = async () => ({
          schedules: (await db.crawlSchedules.due({ now, limit: 10 })).map((s) => s.domainId),
          favicons: (await db.favicons.due({ now, limit: 10 })).map((d) => d.id),
          files: (await db.crawlFiles.dueChecks({ now, limit: 10 })).map((d) => d.id),
        })
        const active = await dueDomains()
        expect(active.schedules.sort()).toEqual([site.domainId, other.domainId].sort())
        expect(active.favicons).toContain(site.domainId)
        expect(active.files).toContain(site.domainId)

        await db.domains.archive(site.domainId)
        expect(await dueDomains()).toEqual({
          schedules: [other.domainId],
          favicons: [other.domainId],
          files: [other.domainId],
        })
      })

      it('moves the schedules of a restored domain to their next run instead of catching up', async () => {
        const now = new Date()
        const site = await populated('acme.com')
        await db.crawlSchedules.save({
          ...recurrence,
          domainId: site.domainId,
          type: 'full',
          enabled: true,
          nextRunAt: new Date(now.getTime() - 30 * DAY),
        })
        await db.crawlSchedules.save({
          ...recurrence,
          domainId: site.domainId,
          type: 'priority',
          enabled: false,
          nextRunAt: new Date(now.getTime() - 30 * DAY),
        })
        await db.domains.archive(site.domainId)

        const restored = await db.domains.unarchive(site.domainId)
        expect(restored?.archivedAt).toBeNull()
        expect(await db.crawlSchedules.due({ now, limit: 10 })).toEqual([])
        const [full] = (await db.crawlSchedules.list(site.domainId)).filter((s) => s.enabled)
        expect(full!.nextRunAt.getTime()).toBeGreaterThan(now.getTime())
        // It can run again, and be changed again.
        await db.priorityUrls.add({ domainId: site.domainId, url: `${site.url}again` })
        expect(
          await db.crawls.start({ domainId: site.domainId, type: 'full', trigger: 'manual' }),
        ).not.toBeNull()
        expect(await db.domains.unarchive('missing')).toBeNull()
      })
    })

    describe('deleting a domain', () => {
      it('leaves no row of it in any table, and the other domain untouched', async () => {
        const tables = domainTables()
        // The schema is the source of truth for what a domain holds; this guards the test itself.
        expect(tables).toEqual(
          expect.arrayContaining([
            'audit_rules',
            'crawl_files',
            'crawl_url_history',
            'crawl_url_links',
            'crawl_url_accepted_issues',
            'crawl_url_audit',
            'crawl_url_issues',
            'crawl_urls',
            'crawls',
            'domain_audit_config',
            'domain_favicons',
            'priority_urls',
            'url_verification_urls',
            'url_verifications',
          ]),
        )

        const doomed = await populated('acme.com')
        const kept = await populated('other.com')
        const withBoth = await rowCounts(tables)
        for (const table of tables) expect(withBoth[table], table).toBeGreaterThan(0)

        expect(await deleteDomain(db, { domainId: doomed.domainId, confirm: 'ACME.com ' })).toEqual(
          {
            ok: true,
          },
        )

        const onlyKept = await rowCounts(tables)
        for (const table of tables) {
          // What is left is exactly what the other domain has: half of what both had.
          expect(onlyKept[table], table).toBeLessThan(withBoth[table]!)
        }
        expect(await db.domains.findByHost('acme.com')).toBeNull()
        expect(await db.domains.get(doomed.domainId)).toBeNull()
        expect(await db.crawls.list(doomed.domainId)).toEqual([])
        expect(await db.audit.config(doomed.domainId)).toMatchObject({ rules: [] })
        // The company stays, now without domains.
        expect((await db.companies.get(doomed.company.id))?.name).toBe('acme.com Inc')
        expect(await db.crawls.latestWithResults(kept.domainId, 'full')).toMatchObject({
          id: kept.crawlId,
        })
        expect(await db.audit.config(kept.domainId)).toMatchObject({ rules: [expect.anything()] })
        expect(await db.priorityUrls.list(kept.domainId)).toHaveLength(1)

        // Deleting the other one too leaves every table empty.
        await deleteDomain(db, { domainId: kept.domainId, confirm: 'other.com' })
        for (const table of tables) expect(await countRows(table), table).toBe(0)
      })

      it('requires the host, checked against the stored one', async () => {
        const site = await populated('acme.com')
        for (const confirm of ['', 'acme', 'other.com', 'https://acme.com']) {
          expect(await deleteDomain(db, { domainId: site.domainId, confirm })).toEqual({
            ok: false,
            reason: 'confirmation-mismatch',
          })
        }
        expect(await db.domains.get(site.domainId)).not.toBeNull()
        expect(await deleteDomain(db, { domainId: 'missing', confirm: 'acme.com' })).toEqual({
          ok: false,
          reason: 'not-found',
        })
        expect(await db.domains.delete('missing')).toBe(false)
      })

      it('removes the jobs of its crawls and rechecks, so none runs or is retried', async () => {
        const doomed = await populated('acme.com')
        const kept = await populated('other.com')
        const crawl = await db.crawls.start({
          domainId: doomed.domainId,
          type: 'full',
          trigger: 'manual',
        })
        const keptCrawl = await db.crawls.start({
          domainId: kept.domainId,
          type: 'full',
          trigger: 'manual',
        })
        const recheck = await db.verifications.start({
          domainId: doomed.domainId,
          baseCrawlId: doomed.crawlId,
          urls: [{ url: doomed.url, urlHash: crawlUrlHash(doomed.url), source: 'link' }],
        })
        expect(crawl && keptCrawl && recheck).toBeTruthy()
        // One of them is already being worked on by a worker.
        const claimed = await db.jobs.claim({ workerId: 'worker-1', limit: 100 })
        expect(claimed.map((job) => job.id)).toContain(crawl!.jobId)

        await deleteDomain(db, { domainId: doomed.domainId, confirm: 'acme.com' })

        expect(await db.jobs.get(crawl!.jobId)).toBeNull()
        expect(await db.jobs.get(recheck!.jobId)).toBeNull()
        expect(await db.jobs.get(keptCrawl!.jobId)).not.toBeNull()
        // So are the jobs that tell people about the crawls that ended.
        const alertsFor = async (crawlId: string) =>
          (await db.jobs.list({ limit: 100 })).filter(
            (job) =>
              job.type === 'crawl.alerts' &&
              (job.payload as { crawlId: string }).crawlId === crawlId,
          )
        expect(await alertsFor(doomed.crawlId)).toEqual([])
        expect(await alertsFor(kept.crawlId)).toHaveLength(1)
        // What a worker asks next finds nothing, rather than failing.
        expect(await db.crawls.markRunning(crawl!.id)).toBeNull()
        expect(await db.verifications.markRunning(recheck!.id)).toBeNull()
        expect(await db.crawls.get(crawl!.id)).toBeNull()
        // A finished job handing back its result after the delete changes nothing and throws nothing.
        await db.jobs.complete({ id: crawl!.jobId, workerId: 'worker-1' })
        await db.jobs.fail({ id: crawl!.jobId, workerId: 'worker-1', error: 'gone' })
        expect(await db.jobs.get(crawl!.jobId)).toBeNull()
      })
    })

    describe('deleting a company', () => {
      it('removes its domains with everything stored for them, and no other company', async () => {
        const tables = domainTables()
        const first = await populated('acme.com', 'Acme')
        const added = await addDomain(db, { companyId: first.company.id, domain: 'acme.io' })
        if (!added.ok) throw new Error('setup failed')
        const kept = await populated('other.com', 'Other')
        const crawl = await db.crawls.start({
          domainId: first.domainId,
          type: 'full',
          trigger: 'manual',
        })

        expect(await deleteCompany(db, { id: first.company.id, confirm: 'acme' })).toEqual({
          ok: false,
          reason: 'confirmation-mismatch',
        })
        expect(await db.companies.get(first.company.id)).not.toBeNull()

        expect(await deleteCompany(db, { id: first.company.id, confirm: ' Acme ' })).toEqual({
          ok: true,
        })
        expect(await db.companies.get(first.company.id)).toBeNull()
        expect(await db.domains.findByHost('acme.com')).toBeNull()
        expect(await db.domains.findByHost('acme.io')).toBeNull()
        expect(await db.jobs.get(crawl!.jobId)).toBeNull()
        expect((await db.companies.list()).map((c) => c.name)).toEqual(['Other'])
        for (const table of tables) {
          expect(await countRows(table), table).toBeGreaterThan(0)
        }

        await deleteCompany(db, { id: kept.company.id, confirm: 'Other' })
        for (const table of tables) expect(await countRows(table), table).toBe(0)
        expect(await deleteCompany(db, { id: 'missing', confirm: 'x' })).toEqual({
          ok: false,
          reason: 'not-found',
        })
      })

      it('deletes a company that has no domains', async () => {
        const site = await populated('acme.com', 'Acme')
        const target = await company('Empty', 'empty.com')
        await db.domains.delete(target.domain.id)
        expect(await deleteCompany(db, { id: target.company.id, confirm: 'Empty' })).toEqual({
          ok: true,
        })
        expect((await db.companies.list()).map((c) => c.name)).toEqual(['Acme'])
        expect(await db.domains.get(site.domainId)).not.toBeNull()
      })
    })

    describe('renaming a company', () => {
      it('normalizes the name and refuses an empty, long or unknown one', async () => {
        const { company: acme } = await company('Acme', 'acme.com')
        expect(await renameCompany(db, { id: acme.id, name: '  New   name ' })).toMatchObject({
          ok: true,
          company: { id: acme.id, name: 'New name' },
        })
        expect((await db.companies.get(acme.id))?.name).toBe('New name')
        expect(await renameCompany(db, { id: acme.id, name: '   ' })).toEqual({
          ok: false,
          reason: 'invalid-name',
        })
        expect(await renameCompany(db, { id: acme.id, name: 'x'.repeat(101) })).toEqual({
          ok: false,
          reason: 'invalid-name',
        })
        expect(await renameCompany(db, { id: 'missing', name: 'Name' })).toEqual({
          ok: false,
          reason: 'company-not-found',
        })
        expect((await db.companies.get(acme.id))?.name).toBe('New name')
      })
    })

    describe('moving a domain', () => {
      it('changes only the company: the id and every result stay', async () => {
        const tables = domainTables()
        const site = await populated('acme.com', 'Acme')
        const target = await company('Beta', 'beta.com')
        const before = await rowCounts(tables)
        const analysisBefore = await db.crawls.issuesOf(site.crawlId, [crawlUrlHash(site.url)])

        const moved = await moveDomain(db, {
          domainId: site.domainId,
          companyId: target.company.id,
        })
        expect(moved).toMatchObject({
          ok: true,
          domain: { id: site.domainId, host: 'acme.com', companyId: target.company.id },
        })

        expect(await rowCounts(tables)).toEqual(before)
        expect((await db.domains.findByHost('acme.com'))?.company.id).toBe(target.company.id)
        expect((await db.crawls.latestWithResults(site.domainId, 'full'))?.id).toBe(site.crawlId)
        expect(await db.crawls.issuesOf(site.crawlId, [crawlUrlHash(site.url)])).toEqual(
          analysisBefore,
        )
        expect(await db.crawlSchedules.list(site.domainId)).toHaveLength(1)
        const list = await db.companies.list()
        expect(list.find((c) => c.name === 'Beta')?.domains.map((d) => d.host)).toEqual([
          'acme.com',
          'beta.com',
        ])
        // The company it left stays, empty.
        expect(list.find((c) => c.name === 'Acme')?.domains).toEqual([])
      })

      it('refuses the same company, an unknown company or an unknown domain', async () => {
        const site = await populated('acme.com', 'Acme')
        expect(
          await moveDomain(db, { domainId: site.domainId, companyId: site.company.id }),
        ).toEqual({ ok: false, reason: 'same-company' })
        expect(await moveDomain(db, { domainId: site.domainId, companyId: 'missing' })).toEqual({
          ok: false,
          reason: 'company-not-found',
        })
        expect(await moveDomain(db, { domainId: 'missing', companyId: site.company.id })).toEqual({
          ok: false,
          reason: 'domain-not-found',
        })
        expect((await db.domains.get(site.domainId))?.companyId).toBe(site.company.id)
      })

      it('moves an archived domain without unarchiving it', async () => {
        const site = await populated('acme.com', 'Acme')
        const target = await company('Beta', 'beta.com')
        const archived = await db.domains.archive(site.domainId)
        await moveDomain(db, { domainId: site.domainId, companyId: target.company.id })
        expect((await db.domains.get(site.domainId))?.archivedAt).toEqual(archived?.archivedAt)
      })
    })

    describe('what deleting would remove', () => {
      it('counts what each domain holds, zero for an empty one', async () => {
        const site = await populated('acme.com')
        const empty = await company('Empty', 'empty.com')

        const usage = await db.domains.usage()
        // The crawl and an older one pruned to its compact history.
        expect(usage.get(site.domainId)).toEqual({
          crawls: 2,
          urls: 2,
          rules: 1,
          rechecks: 1,
          schedules: 1,
          priorityUrls: 1,
          crawlFiles: 1,
        })
        expect(usage.get(empty.domain.id)).toEqual({
          crawls: 0,
          urls: 0,
          rules: 0,
          rechecks: 0,
          schedules: 0,
          priorityUrls: 0,
          crawlFiles: 0,
        })
        expect(usage.size).toBe(2)
      })
    })
  })
}
