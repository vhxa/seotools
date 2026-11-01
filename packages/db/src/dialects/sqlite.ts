import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import BetterSqlite3 from 'better-sqlite3'
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  sql,
} from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { sqlitePathFromUrl } from '../dialect'
import {
  CREDENTIAL_PROVIDER,
  EMPTY_COUNTS,
  chunk,
  crawlJobValues,
  crawlResultColumns,
  crawlRobotsColumn,
  crawlViewScope,
  foldCrawlCounts,
  groupDomains,
  newCrawlLinkRow,
  newCrawlUrlRow,
  newestPerUrl,
  priorityUrlRow,
  toCrawl,
  toCrawlSchedule,
  toCrawlUrl,
  toJob,
  truncateError,
} from '../mapping'
import { DEFAULT_CRAWL_SETTINGS, type CrawlLinkKind } from '@seotools/core'
import * as schema from '../schema/sqlite'
import type { Database, NewCrawlUrl } from '../types'

const {
  jobs,
  workerHeartbeats,
  settings,
  user,
  account,
  companies,
  domains,
  crawlSettings,
  crawlSchedules,
  crawls,
  crawlUrls,
  crawlLinks,
  priorityUrls,
} = schema

export function createSqliteDatabase(options: {
  url: string
  defaultMigrationsDir: () => string
}): Database {
  const path = sqlitePathFromUrl(options.url)
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true })

  const sqlite = new BetterSqlite3(path)
  // WAL lets the web app read while the worker writes; busy_timeout absorbs short write contention.
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('synchronous = NORMAL')

  const db = drizzle(sqlite, { schema })

  return {
    dialect: 'sqlite',
    orm: {
      db,
      schema: { user, session: schema.session, account, verification: schema.verification },
    },

    async ping() {
      sqlite.prepare('select 1').get()
    },

    async migrate(dir) {
      migrate(db, { migrationsFolder: dir ?? options.defaultMigrationsDir() })
    },

    async close() {
      sqlite.close()
    },

    jobs: {
      async enqueue(input) {
        const now = new Date()
        const [row] = db
          .insert(jobs)
          .values({
            id: randomUUID(),
            type: input.type,
            payload: JSON.stringify(input.payload ?? {}),
            runAt: input.runAt ?? now,
            ...(input.maxAttempts ? { maxAttempts: input.maxAttempts } : {}),
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .all()
        return toJob(row!)
      },

      async get(id) {
        const row = db.select().from(jobs).where(eq(jobs.id, id)).get()
        return row ? toJob(row) : null
      },

      async list({ limit = 20, status } = {}) {
        const rows = db
          .select()
          .from(jobs)
          .where(status ? eq(jobs.status, status) : undefined)
          .orderBy(desc(jobs.createdAt))
          .limit(limit)
          .all()
        return rows.map(toJob)
      },

      async countByStatus() {
        const rows = db
          .select({ status: jobs.status, count: sql<number>`count(*)` })
          .from(jobs)
          .groupBy(jobs.status)
          .all()
        const counts = { ...EMPTY_COUNTS }
        for (const r of rows) counts[r.status] = Number(r.count)
        return counts
      },

      async claim({ workerId, limit, now = new Date(), types, excludeTypes }) {
        // IMMEDIATE takes the write lock up front, so two workers can never claim the same row.
        const claimed = db.transaction(
          (tx) => {
            const due = tx
              .select()
              .from(jobs)
              .where(
                and(
                  eq(jobs.status, 'pending'),
                  lte(jobs.runAt, now),
                  types ? inArray(jobs.type, [...types]) : undefined,
                  excludeTypes ? notInArray(jobs.type, [...excludeTypes]) : undefined,
                ),
              )
              .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
              .limit(limit)
              .all()
            return due.map((row) => {
              const patch = {
                status: 'running' as const,
                attempts: row.attempts + 1,
                lockedAt: now,
                lockedBy: workerId,
                updatedAt: now,
              }
              tx.update(jobs).set(patch).where(eq(jobs.id, row.id)).run()
              return { ...row, ...patch }
            })
          },
          { behavior: 'immediate' },
        )
        return claimed.map(toJob)
      },

      async complete({ id, workerId, result }) {
        const now = new Date()
        db.update(jobs)
          .set({
            status: 'completed',
            result: result === undefined ? null : JSON.stringify(result),
            lastError: null,
            lockedAt: null,
            lockedBy: null,
            updatedAt: now,
          })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
          .run()
      },

      async fail({ id, workerId, error, retryAt }) {
        db.update(jobs)
          .set({
            status: retryAt ? 'pending' : 'failed',
            ...(retryAt ? { runAt: retryAt } : {}),
            lastError: truncateError(error),
            lockedAt: null,
            lockedBy: null,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
          .run()
      },

      async renewLock({ id, workerId, now = new Date() }) {
        db.update(jobs)
          .set({ lockedAt: now, updatedAt: now })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
          .run()
      },

      async release({ id, workerId }) {
        db.update(jobs)
          .set({
            status: 'pending',
            attempts: sql`${jobs.attempts} - 1`,
            lockedAt: null,
            lockedBy: null,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
          .run()
      },

      async requeueStale({ lockedBefore }) {
        const now = new Date()
        const stale = and(eq(jobs.status, 'running'), lt(jobs.lockedAt, lockedBefore))
        const reset = {
          lockedAt: null,
          lockedBy: null,
          lastError: 'Worker lock expired',
          updatedAt: now,
        }
        return db.transaction((tx) => {
          const failed = tx
            .update(jobs)
            .set({ ...reset, status: 'failed' })
            .where(and(stale, gte(jobs.attempts, jobs.maxAttempts)))
            .run().changes
          const requeued = tx
            .update(jobs)
            .set({ ...reset, status: 'pending', runAt: now })
            .where(stale)
            .run().changes
          return failed + requeued
        })
      },
    },

    heartbeats: {
      async beat({ workerId, startedAt, now = new Date() }) {
        db.insert(workerHeartbeats)
          .values({ workerId, startedAt, lastSeenAt: now })
          .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { lastSeenAt: now } })
          .run()
        db.delete(workerHeartbeats)
          .where(lt(workerHeartbeats.lastSeenAt, new Date(now.getTime() - 24 * 3600_000)))
          .run()
      },
      async latest() {
        const row = db
          .select()
          .from(workerHeartbeats)
          .orderBy(desc(workerHeartbeats.lastSeenAt))
          .limit(1)
          .get()
        return row ?? null
      },
    },

    settings: {
      async get(key) {
        const row = db.select().from(settings).where(eq(settings.key, key)).get()
        return row ? { value: row.value, encrypted: row.encrypted } : null
      },
      async set(key, value, encrypted) {
        const updatedAt = new Date()
        db.insert(settings)
          .values({ key, value, encrypted, updatedAt })
          .onConflictDoUpdate({ target: settings.key, set: { value, encrypted, updatedAt } })
          .run()
      },
      async delete(key) {
        db.delete(settings).where(eq(settings.key, key)).run()
      },
    },

    admin: {
      async findByEmail(email) {
        const found = db.select().from(user).where(eq(user.email, email)).get()
        if (!found) return null
        const cred = db
          .select({ password: account.password })
          .from(account)
          .where(and(eq(account.userId, found.id), eq(account.providerId, CREDENTIAL_PROVIDER)))
          .get()
        return { id: found.id, email: found.email, passwordHash: cred?.password ?? null }
      },
      async create({ id, email, name, passwordHash }) {
        db.transaction((tx) => {
          tx.insert(user).values({ id, email, name, emailVerified: true }).run()
          tx.insert(account)
            .values({
              id: randomUUID(),
              accountId: id,
              providerId: CREDENTIAL_PROVIDER,
              userId: id,
              password: passwordHash,
            })
            .run()
        })
      },
      async exists() {
        return db.select({ id: user.id }).from(user).limit(1).get() !== undefined
      },
    },

    companies: {
      async list() {
        // Domains first: every domain read has its company, so the second read can't miss one.
        const domainRows = db.select().from(domains).all()
        const companyRows = db.select().from(companies).all()
        return groupDomains(companyRows, domainRows)
      },
      async get(id) {
        return db.select().from(companies).where(eq(companies.id, id)).get() ?? null
      },
      async create({ name, host }) {
        const now = new Date()
        const company = { id: randomUUID(), name, createdAt: now }
        const domain = { id: randomUUID(), companyId: company.id, host, createdAt: now }
        db.transaction((tx) => {
          tx.insert(companies).values(company).run()
          tx.insert(domains).values(domain).run()
        })
        return { company, domain }
      },
    },

    domains: {
      async get(id) {
        return db.select().from(domains).where(eq(domains.id, id)).get() ?? null
      },
      async findByHost(host) {
        const row = db
          .select({ domain: domains, company: companies })
          .from(domains)
          .innerJoin(companies, eq(domains.companyId, companies.id))
          .where(eq(domains.host, host))
          .get()
        return row ? { ...row.domain, company: row.company } : null
      },
      async add({ companyId, host }) {
        const domain = { id: randomUUID(), companyId, host, createdAt: new Date() }
        db.insert(domains).values(domain).run()
        return domain
      },
    },

    crawls: {
      async settings(domainId) {
        const row = db
          .select()
          .from(crawlSettings)
          .where(eq(crawlSettings.domainId, domainId))
          .get()
        if (!row) return { ...DEFAULT_CRAWL_SETTINGS }
        const { domainId: _domainId, updatedAt: _updatedAt, ...settings } = row
        return settings
      },

      async saveSettings(domainId, values) {
        const updatedAt = new Date()
        db.insert(crawlSettings)
          .values({ domainId, ...values, updatedAt })
          .onConflictDoUpdate({ target: crawlSettings.domainId, set: { ...values, updatedAt } })
          .run()
      },

      async start({ domainId, type, trigger }) {
        const now = new Date()
        const id = randomUUID()
        const jobId = randomUUID()
        try {
          db.transaction((tx) => {
            tx.insert(jobs)
              .values(crawlJobValues(id, jobId, now))
              .run()
            tx.insert(crawls)
              .values({ id, domainId, type, trigger, jobId, activeKey: domainId, createdAt: now })
              .run()
          })
        } catch (error) {
          // Lost the race on the unique `active_key`: some other crawl of this domain is active.
          if (await this.active(domainId)) return null
          throw error
        }
        return this.get(id)
      },

      async get(id) {
        const row = db.select().from(crawls).where(eq(crawls.id, id)).get()
        return row ? toCrawl(row) : null
      },

      async active(domainId) {
        const row = db.select().from(crawls).where(eq(crawls.activeKey, domainId)).get()
        return row ? toCrawl(row) : null
      },

      async list(domainId, { limit = 20 } = {}) {
        const rows = db
          .select()
          .from(crawls)
          .where(eq(crawls.domainId, domainId))
          .orderBy(desc(crawls.createdAt))
          .limit(limit)
          .all()
        return rows.map(toCrawl)
      },

      async latestWithResults(domainId, type) {
        const row = db
          .select()
          .from(crawls)
          .where(
            and(
              eq(crawls.domainId, domainId),
              eq(crawls.type, type),
              inArray(crawls.status, ['completed', 'incomplete']),
              eq(crawls.pruned, false),
            ),
          )
          .orderBy(desc(crawls.createdAt))
          .limit(1)
          .get()
        return row ? toCrawl(row) : null
      },

      async markRunning(id) {
        const startedAt = new Date()
        db.update(crawls)
          .set({ status: 'running', startedAt })
          .where(and(eq(crawls.id, id), isNotNull(crawls.activeKey), isNull(crawls.startedAt)))
          .run()
        db.update(crawls)
          .set({ status: 'running' })
          .where(and(eq(crawls.id, id), isNotNull(crawls.activeKey)))
          .run()
        const crawl = await this.get(id)
        return crawl && crawl.status === 'running' ? crawl : null
      },

      async updateCounts(id, counts) {
        db.update(crawls)
          .set(counts)
          .where(and(eq(crawls.id, id), isNotNull(crawls.activeKey)))
          .run()
      },

      async saveRobots(id, robots) {
        db.update(crawls)
          .set({ robots: crawlRobotsColumn(robots) })
          .where(eq(crawls.id, id))
          .run()
      },

      async finish(id, { status, error }) {
        const counts = await this.countUrls(id)
        const result = db
          .update(crawls)
          .set({
            ...counts,
            status,
            error: error === undefined ? null : truncateError(error),
            activeKey: null,
            finishedAt: new Date(),
          })
          .where(and(eq(crawls.id, id), isNotNull(crawls.activeKey)))
          .run()
        return result.changes > 0
      },

      async cancel(id) {
        const result = db
          .update(crawls)
          .set({ status: 'cancelled', activeKey: null, finishedAt: new Date() })
          .where(and(eq(crawls.id, id), isNotNull(crawls.activeKey)))
          .run()
        return result.changes > 0
      },

      async failOrphaned() {
        const orphans = db
          .select({ id: crawls.id, jobError: jobs.lastError })
          .from(crawls)
          .innerJoin(jobs, eq(crawls.jobId, jobs.id))
          .where(and(isNotNull(crawls.activeKey), inArray(jobs.status, ['failed', 'completed'])))
          .all()
        let failed = 0
        for (const orphan of orphans) {
          const ended = await this.finish(orphan.id, {
            status: 'failed',
            error: orphan.jobError ?? 'The crawl job ended unexpectedly',
          })
          if (ended) failed++
        }
        return failed
      },

      async prune({ domainId, type, keep }) {
        const candidates = db
          .select({ id: crawls.id, status: crawls.status })
          .from(crawls)
          .where(
            and(
              eq(crawls.domainId, domainId),
              eq(crawls.type, type),
              isNull(crawls.activeKey),
              eq(crawls.pruned, false),
            ),
          )
          .orderBy(desc(crawls.createdAt))
          .all()
        let usable = 0
        const expired = candidates
          .filter((crawl) => {
            if (crawl.status !== 'completed' && crawl.status !== 'incomplete') return true
            usable++
            return keep !== null && usable > keep
          })
          .map((crawl) => crawl.id)
        if (expired.length === 0) return 0
        db.transaction((tx) => {
          tx.delete(crawlLinks).where(inArray(crawlLinks.crawlId, expired)).run()
          tx.delete(crawlUrls).where(inArray(crawlUrls.crawlId, expired)).run()
          tx.update(crawls).set({ pruned: true }).where(inArray(crawls.id, expired)).run()
        })
        return expired.length
      },

      async addUrls(crawlId, urls) {
        for (const batch of chunk(urls)) {
          db.insert(crawlUrls)
            .values(batch.map((url) => newCrawlUrlRow(crawlId, url)))
            .onConflictDoNothing()
            .run()
        }
      },

      async nextQueued(crawlId, limit) {
        const rows = db
          .select({
            url: crawlUrls.url,
            urlHash: crawlUrls.urlHash,
            scope: crawlUrls.scope,
            source: crawlUrls.source,
            depth: crawlUrls.depth,
          })
          .from(crawlUrls)
          .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.state, 'queued')))
          .orderBy(asc(crawlUrls.depth))
          .limit(limit)
          .all()
        return rows as NewCrawlUrl[]
      },

      async knownUrls(crawlId) {
        return db
          .select({ urlHash: crawlUrls.urlHash, scope: crawlUrls.scope })
          .from(crawlUrls)
          .where(eq(crawlUrls.crawlId, crawlId))
          .all()
      },

      async recordResult({ crawlId, urlHash, result, urls = [], links = [] }) {
        const columns = crawlResultColumns(result, new Date())
        db.transaction((tx) => {
          for (const batch of chunk(urls)) {
            tx.insert(crawlUrls)
              .values(batch.map((url) => newCrawlUrlRow(crawlId, url)))
              .onConflictDoNothing()
              .run()
          }
          for (const batch of chunk(links)) {
            tx.insert(crawlLinks)
              .values(batch.map((link) => newCrawlLinkRow(crawlId, link)))
              .onConflictDoNothing()
              .run()
          }
          tx.update(crawlUrls)
            .set(columns)
            .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.urlHash, urlHash)))
            .run()
        })
      },

      async countUrls(crawlId) {
        const rows = db
          .select({
            scope: crawlUrls.scope,
            kind: crawlUrls.kind,
            state: crawlUrls.state,
            count: sql<number>`count(*)`,
          })
          .from(crawlUrls)
          .where(eq(crawlUrls.crawlId, crawlId))
          .groupBy(crawlUrls.scope, crawlUrls.kind, crawlUrls.state)
          .all()
        return foldCrawlCounts(rows)
      },

      async listUrls({ crawlId, view, limit, offset }) {
        const kind =
          view === 'pages'
            ? eq(crawlUrls.kind, 'page')
            : view === 'other'
              ? ne(crawlUrls.kind, 'page')
              : undefined
        const rows = db
          .select()
          .from(crawlUrls)
          .where(
            and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.scope, crawlViewScope(view)), kind),
          )
          .orderBy(asc(crawlUrls.depth), asc(crawlUrls.url))
          .limit(limit)
          .offset(offset)
          .all()
        return rows.map(toCrawlUrl)
      },

      async linkSources(crawlId, targetHash) {
        const rows = db
          .select({ url: crawlUrls.url, kind: crawlLinks.kind })
          .from(crawlLinks)
          .innerJoin(
            crawlUrls,
            and(
              eq(crawlUrls.crawlId, crawlLinks.crawlId),
              eq(crawlUrls.urlHash, crawlLinks.sourceHash),
            ),
          )
          .where(and(eq(crawlLinks.crawlId, crawlId), eq(crawlLinks.targetHash, targetHash)))
          .all()
        return rows as { url: string; kind: CrawlLinkKind }[]
      },

      async latestResults(domainId, urlHashes) {
        if (urlHashes.length === 0) return []
        const rows = db
          .select({ row: crawlUrls })
          .from(crawlUrls)
          .innerJoin(crawls, eq(crawls.id, crawlUrls.crawlId))
          .where(
            and(
              eq(crawls.domainId, domainId),
              inArray(crawlUrls.urlHash, urlHashes),
              eq(crawlUrls.state, 'done'),
            ),
          )
          .all()
        return newestPerUrl(rows.map(({ row }) => toCrawlUrl(row)))
      },
    },

    priorityUrls: {
      async list(domainId) {
        return db
          .select()
          .from(priorityUrls)
          .where(eq(priorityUrls.domainId, domainId))
          .orderBy(asc(priorityUrls.createdAt), asc(priorityUrls.urlHash))
          .all()
      },
      async add({ domainId, url }) {
        db.insert(priorityUrls)
          .values(priorityUrlRow(domainId, url, new Date()))
          .onConflictDoNothing()
          .run()
      },
      async remove({ domainId, urlHash }) {
        db.delete(priorityUrls)
          .where(and(eq(priorityUrls.domainId, domainId), eq(priorityUrls.urlHash, urlHash)))
          .run()
      },
    },

    crawlSchedules: {
      async list(domainId) {
        const rows = db
          .select()
          .from(crawlSchedules)
          .where(eq(crawlSchedules.domainId, domainId))
          .all()
        return rows.map(toCrawlSchedule)
      },
      async save({ domainId, type, ...values }) {
        const updatedAt = new Date()
        db.insert(crawlSchedules)
          .values({ id: randomUUID(), domainId, type, ...values, updatedAt })
          .onConflictDoUpdate({
            target: [crawlSchedules.domainId, crawlSchedules.type],
            set: { ...values, updatedAt },
          })
          .run()
      },
      async due({ now, limit }) {
        const rows = db
          .select()
          .from(crawlSchedules)
          .where(and(eq(crawlSchedules.enabled, true), lte(crawlSchedules.nextRunAt, now)))
          .orderBy(asc(crawlSchedules.nextRunAt))
          .limit(limit)
          .all()
        return rows.map(toCrawlSchedule)
      },
      async advance({ id, expectedNextRunAt, nextRunAt, now }) {
        const result = db
          .update(crawlSchedules)
          .set({ nextRunAt, lastRunAt: now })
          .where(and(eq(crawlSchedules.id, id), eq(crawlSchedules.nextRunAt, expectedNextRunAt)))
          .run()
        return result.changes > 0
      },
      async recordOutcome({ id, outcome }) {
        db.update(crawlSchedules)
          .set({ lastOutcome: outcome })
          .where(eq(crawlSchedules.id, id))
          .run()
      },
    },
  }
}
