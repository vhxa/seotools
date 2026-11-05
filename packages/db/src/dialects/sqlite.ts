import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import BetterSqlite3 from 'better-sqlite3'
import {
  and,
  asc,
  countDistinct,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { sqlitePathFromUrl } from '../dialect'
import {
  CREDENTIAL_PROVIDER,
  EMPTY_COUNTS,
  byUrl,
  changeCondition,
  chunk,
  compareViewEither,
  compareViewOf,
  comparePlan,
  compareWhere,
  foldTraces,
  HISTORY_BATCH,
  sqliteDiffers,
  sumOf,
  toUrlComparison,
  type FindingDifferences,
  crawlJobValues,
  crawlResultColumns,
  crawlRobotsColumn,
  crawlAcceptedRows,
  crawlIssueRows,
  crawlAnalysisColumns,
  crawlAuditRows,
  crawlAuditWhere,
  foldRuleCounts,
  supersedes,
  toCrawlUrlAudit,
  sitemapHreflangRow,
  toCrawlUrlAcceptedIssue,
  toCrawlUrlIssue,
  crawlUrlOrder,
  crawlUrlWhere,
  crawlLinkJoin,
  crawlLinkOrder,
  crawlLinkWhere,
  toCrawlLinkRow,
  crawlFileColumns,
  crawlFileRow,
  crawlSettingsColumns,
  assertVerificationUrls,
  enabledFilesByDomain,
  expiredVerifications,
  faviconRow,
  foldCrawlCounts,
  foldViewCounts,
  groupDomains,
  newCrawlLinkRow,
  newCrawlUrlRow,
  newestPerUrl,
  newestVerifiedPerUrl,
  newVerificationUrlRows,
  priorityUrlRow,
  toCrawl,
  toCrawlSchedule,
  toCrawlUrl,
  toCrawlFile,
  toCrawlFileCheck,
  toCrawlSettings,
  toDomainFavicon,
  toJob,
  toVerification,
  toVerifiedUrl,
  truncateError,
  verificationAnswerColumns,
  verificationJobValues,
  verificationOutcomeColumn,
} from '../mapping'
import {
  AUDIT_SEMANTICS,
  DEFAULT_CRAWL_SETTINGS,
  JOB_TYPES,
  type CrawlLinkKind,
} from '@seotools/core'
import {
  AUDIT_SEMANTICS_SETTING,
  UPGRADED_DIMENSIONS,
  inApplyOrder,
  languageColumns,
  languagesOf,
  mutationResult,
  planChanges,
  planDeleteRule,
  planDeleteMany,
  planLanguages,
  planUpgradeSemantics,
  planSaveRule,
  planSaveRuleSet,
  planSetEnabled,
  planSetEnabledMany,
  planUrlConfig,
  readAuditConfig,
  recomputeJobValues,
  recomputePayload,
  toAuditRule,
  type AuditPlan,
  type AuditRuleRow,
  type PlanContext,
} from '../audit'
import * as schema from '../schema/sqlite'
import type {
  CrawlLink,
  CrawlUrlAudit,
  CrawlUrlBrief,
  CrawlUrlAcceptedIssue,
  CrawlUrlIssue,
  Database,
  NewCrawlUrl,
  NewVerificationUrl,
  SitemapHreflang,
  VerifiedUrl,
} from '../types'

const {
  jobs,
  workerHeartbeats,
  settings,
  user,
  account,
  companies,
  domains,
  domainFavicons,
  crawlFileChecks,
  crawlFiles,
  crawlSettings,
  crawlSchedules,
  crawls,
  crawlUrls,
  crawlUrlAcceptedIssues,
  crawlUrlIssues,
  crawlUrlAudit,
  crawlSitemapHreflang,
  crawlLinks,
  priorityUrls,
  auditRules,
  domainAuditConfig,
  urlVerifications,
  urlVerificationUrls,
} = schema

/** `limit` when a list is not capped. */
const MAX_LIMIT = 2_147_483_647

const urlColumns = {
  crawlId: crawlUrls.crawlId,
  scope: crawlUrls.scope,
  kind: crawlUrls.kind,
  urlHash: crawlUrls.urlHash,
  url: crawlUrls.url,
  title: crawlUrls.title,
  status: crawlUrls.statusCode,
  depth: crawlUrls.depth,
  responseTime: crawlUrls.responseTimeMs,
  bytes: crawlUrls.bytes,
}

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

  /** The hashes of the URLs of a crawl that have an issue, and of those a filter on the audit keeps. */
  const subqueries = (crawlId: string) => ({
    withIssue: (issue: string) =>
      db
        .select({ urlHash: crawlUrlIssues.urlHash })
        .from(crawlUrlIssues)
        .where(and(eq(crawlUrlIssues.crawlId, crawlId), eq(crawlUrlIssues.issue, issue))),
    withAccepted: (issue: string | null) =>
      db
        .select({ urlHash: crawlUrlAcceptedIssues.urlHash })
        .from(crawlUrlAcceptedIssues)
        .where(
          and(
            eq(crawlUrlAcceptedIssues.crawlId, crawlId),
            issue === null ? undefined : eq(crawlUrlAcceptedIssues.issue, issue),
          ),
        ),
    withAudit: (filter: Parameters<typeof crawlAuditWhere>[2]) =>
      db
        .select({ urlHash: crawlUrlAudit.urlHash })
        .from(crawlUrlAudit)
        .where(crawlAuditWhere(crawlUrlAudit, crawlId, filter)),
  })

  /** The same URL as the other side of a comparison, and the issues of each crawl being compared. */
  const otherUrls = alias(crawlUrls, 'other_urls')
  const baseIssues = alias(crawlUrlIssues, 'base_issues')
  const targetIssues = alias(crawlUrlIssues, 'target_issues')

  /**
   * Whether a URL of the later crawl has an issue the earlier crawl does not report for it, and the
   * other way round. The outer row is the URL in `crawl_urls`: callers list the later crawl.
   */
  const findingDifferences = (baseId: string, targetId: string): FindingDifferences => ({
    gained: (issue) =>
      exists(
        db
          .select({ one: sql`1` })
          .from(targetIssues)
          .where(
            and(
              eq(targetIssues.crawlId, targetId),
              eq(targetIssues.urlHash, crawlUrls.urlHash),
              issue ? eq(targetIssues.issue, issue) : undefined,
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(baseIssues)
                  .where(
                    and(
                      eq(baseIssues.crawlId, baseId),
                      eq(baseIssues.urlHash, targetIssues.urlHash),
                      eq(baseIssues.issue, targetIssues.issue),
                    ),
                  ),
              ),
            ),
          ),
      ),
    lost: (issue) =>
      exists(
        db
          .select({ one: sql`1` })
          .from(baseIssues)
          .where(
            and(
              eq(baseIssues.crawlId, baseId),
              eq(baseIssues.urlHash, crawlUrls.urlHash),
              issue ? eq(baseIssues.issue, issue) : undefined,
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(targetIssues)
                  .where(
                    and(
                      eq(targetIssues.crawlId, targetId),
                      eq(targetIssues.urlHash, baseIssues.urlHash),
                      eq(targetIssues.issue, baseIssues.issue),
                    ),
                  ),
              ),
            ),
          ),
      ),
  })

  /** What a comparison selects of a URL: its columns in either the crawl or its other side. */
  const snapshotOf = (t: typeof crawlUrls | typeof otherUrls) => ({
    state: t.state,
    kind: t.kind,
    statusCode: t.statusCode,
    redirectTo: t.redirectTo,
    title: t.title,
    canonical: t.canonical,
    metaRobots: t.metaRobots,
    xRobotsTag: t.xRobotsTag,
    error: t.error,
    depth: t.depth,
  })

  /** Two different full crawls of the domain that finished with results and still have them. */
  const comparablePair = async (domainId: string, baseId: string, targetId: string) => {
    if (baseId === targetId) return false
    const rows = db
      .select({ pruned: crawls.pruned })
      .from(crawls)
      .where(
        and(
          eq(crawls.domainId, domainId),
          eq(crawls.type, 'full'),
          inArray(crawls.status, ['completed', 'incomplete']),
          inArray(crawls.id, [baseId, targetId]),
        ),
      )
      .all()
    return rows.length === 2 && rows.every((row) => !row.pruned)
  }

  /** Asks for the latest full crawl to be analysed again, unless there is none or it is already asked. */
  const requestRecompute = (
    tx: Pick<typeof db, 'select' | 'insert'>,
    domainId: string,
    now: Date,
  ) => {
    const usable = tx
      .select({ id: crawls.id })
      .from(crawls)
      .where(
        and(
          eq(crawls.domainId, domainId),
          eq(crawls.type, 'full'),
          inArray(crawls.status, ['completed', 'incomplete']),
          eq(crawls.pruned, false),
        ),
      )
      .limit(1)
      .get()
    if (!usable) return
    const waiting = tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, JOB_TYPES.auditRecompute),
          eq(jobs.status, 'pending'),
          eq(jobs.payload, recomputePayload(domainId)),
        ),
      )
      .limit(1)
      .get()
    if (waiting) return
    tx.insert(jobs)
      .values(recomputeJobValues(domainId, randomUUID(), now))
      .run()
  }

  /** Runs a change to the rules of a domain: see `AuditRepository`. */
  const changeRules = (
    domainId: string,
    plan: (rows: AuditRuleRow[], context: PlanContext) => AuditPlan,
  ) =>
    db.transaction(
      (tx) => {
        const now = new Date()
        tx.insert(domainAuditConfig)
          .values({ domainId, version: 0, updatedAt: now })
          .onConflictDoNothing()
          .run()
        const config = tx
          .select()
          .from(domainAuditConfig)
          .where(eq(domainAuditConfig.domainId, domainId))
          .get()
        let version = config?.version ?? 0
        const rows = tx.select().from(auditRules).where(eq(auditRules.domainId, domainId)).all()
        const decided = plan(rows, { now, newId: randomUUID, languages: languagesOf(config) })
        if (decided.ok && planChanges(decided)) {
          for (const change of inApplyOrder(decided.changes)) {
            if (change.op === 'delete')
              tx.delete(auditRules).where(eq(auditRules.id, change.id)).run()
            else if (change.op === 'update') {
              tx.update(auditRules).set(change.patch).where(eq(auditRules.id, change.id)).run()
            } else tx.insert(auditRules).values(change.row).run()
          }
          version += 1
          tx.update(domainAuditConfig)
            .set({
              version,
              recomputeError: null,
              recomputeErrorVersion: null,
              updatedAt: now,
              ...(decided.languages ? languageColumns(decided.languages) : {}),
            })
            .where(eq(domainAuditConfig.domainId, domainId))
            .run()
          requestRecompute(tx, domainId, now)
        }
        return mutationResult(decided, version, (id) => {
          const row = tx.select().from(auditRules).where(eq(auditRules.id, id)).get()
          return row ? toAuditRule(row) : null
        })
      },
      { behavior: 'immediate' },
    )

  /**
   * Brings the rules of every domain to the current meaning of a configuration, once (see
   * `AuditRepository.upgradeSemantics`). The rules of a domain that has none, and no crawl to
   * analyse again, have nothing to change: what a new domain is expected to be is the default.
   */
  const upgradeAuditSemantics = async () => {
    const done = db.select().from(settings).where(eq(settings.key, AUDIT_SEMANTICS_SETTING)).get()
    if (done?.value === String(AUDIT_SEMANTICS)) return
    // What the rules mean now. Nothing recorded: they predate the setting, which is the first meaning.
    const from = Number(done?.value) || 1
    const withRules = db
      .selectDistinct({ id: auditRules.domainId })
      .from(auditRules)
      .where(from < 2 ? undefined : inArray(auditRules.dimension, UPGRADED_DIMENSIONS))
      .all()
    // From the first meaning every domain with a crawl moves too: its latest crawl is analysed again.
    const withCrawls =
      from < 2
        ? db
            .selectDistinct({ id: crawls.domainId })
            .from(crawls)
            .where(
              and(
                eq(crawls.type, 'full'),
                inArray(crawls.status, ['completed', 'incomplete']),
                eq(crawls.pruned, false),
              ),
            )
            .all()
        : []
    for (const domainId of new Set([...withRules, ...withCrawls].map((row) => row.id))) {
      await changeRules(domainId, (rows, context) => planUpgradeSemantics(rows, context, from))
    }
    const value = String(AUDIT_SEMANTICS)
    const updatedAt = new Date()
    db.insert(settings)
      .values({ key: AUDIT_SEMANTICS_SETTING, value, encrypted: false, updatedAt })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
      .run()
  }

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
      await upgradeAuditSemantics()
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

      async release({ id, workerId, runAt }) {
        db.update(jobs)
          .set({
            status: 'pending',
            attempts: sql`${jobs.attempts} - 1`,
            ...(runAt ? { runAt } : {}),
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
        return toCrawlSettings(row)
      },

      async enabledFiles() {
        return enabledFilesByDomain(db.select().from(crawlSettings).all())
      },

      async saveSettings(domainId, input) {
        const values = crawlSettingsColumns(input)
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

      async getInDomain(domainId, id) {
        const row = db
          .select()
          .from(crawls)
          .where(and(eq(crawls.id, id), eq(crawls.domainId, domainId)))
          .get()
        return row ? toCrawl(row) : null
      },

      async active(domainId) {
        const row = db.select().from(crawls).where(eq(crawls.activeKey, domainId)).get()
        return row ? toCrawl(row) : null
      },

      async list(domainId, { limit = 20, type } = {}) {
        const rows = db
          .select()
          .from(crawls)
          .where(and(eq(crawls.domainId, domainId), type ? eq(crawls.type, type) : undefined))
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

      async outdatedAnalyses(catalog, limit) {
        const rows = db
          .select()
          .from(crawls)
          .where(
            and(
              isNotNull(crawls.pagesWorstIssueCount),
              inArray(crawls.status, ['completed', 'incomplete']),
              eq(crawls.pruned, false),
              or(isNull(crawls.issueCatalog), ne(crawls.issueCatalog, catalog)),
            ),
          )
          .orderBy(asc(crawls.createdAt))
          .limit(limit)
          .all()
        return rows.map(toCrawl)
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
          tx.delete(crawlUrlIssues).where(inArray(crawlUrlIssues.crawlId, expired)).run()
          tx.delete(crawlUrlAcceptedIssues)
            .where(inArray(crawlUrlAcceptedIssues.crawlId, expired))
            .run()
          tx.delete(crawlUrlAudit).where(inArray(crawlUrlAudit.crawlId, expired)).run()
          tx.delete(crawlSitemapHreflang)
            .where(inArray(crawlSitemapHreflang.crawlId, expired))
            .run()
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

      async viewCounts(crawlId) {
        const rows = db
          .select({
            scope: crawlUrls.scope,
            kind: crawlUrls.kind,
            count: sql<number>`count(*)`,
          })
          .from(crawlUrls)
          .where(eq(crawlUrls.crawlId, crawlId))
          .groupBy(crawlUrls.scope, crawlUrls.kind)
          .all()
        return foldViewCounts(rows)
      },

      async listUrls({ limit, offset, sort, direction, ...query }) {
        const rows = db
          .select()
          .from(crawlUrls)
          .where(crawlUrlWhere(urlColumns, query, subqueries(query.crawlId)))
          .orderBy(...crawlUrlOrder(urlColumns, sort, direction))
          .limit(limit)
          .offset(offset)
          .all()
        return rows.map(toCrawlUrl)
      },

      async countListed(query) {
        const row = db
          .select({ count: sql<number>`count(*)` })
          .from(crawlUrls)
          .where(crawlUrlWhere(urlColumns, query, subqueries(query.crawlId)))
          .get()
        return Number(row?.count ?? 0)
      },

      async getUrl(crawlId, urlHash) {
        const row = db
          .select()
          .from(crawlUrls)
          .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.urlHash, urlHash)))
          .get()
        return row ? toCrawlUrl(row) : null
      },

      async linkSources(crawlId, targetHash, { limit = MAX_LIMIT } = {}) {
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
          .orderBy(asc(crawlUrls.url), asc(crawlLinks.kind))
          .limit(limit)
          .all()
        return rows as { url: string; kind: CrawlLinkKind }[]
      },

      async linkTargets(crawlId, sourceHash, { limit = MAX_LIMIT } = {}) {
        const rows = db
          .select({ url: crawlUrls.url, kind: crawlLinks.kind })
          .from(crawlLinks)
          .innerJoin(
            crawlUrls,
            and(
              eq(crawlUrls.crawlId, crawlLinks.crawlId),
              eq(crawlUrls.urlHash, crawlLinks.targetHash),
            ),
          )
          .where(and(eq(crawlLinks.crawlId, crawlId), eq(crawlLinks.sourceHash, sourceHash)))
          .orderBy(asc(crawlUrls.url), asc(crawlLinks.kind))
          .limit(limit)
          .all()
        return rows as { url: string; kind: CrawlLinkKind }[]
      },

      async listLinks({ limit, offset, ...query }) {
        if (query.kinds?.length === 0) return []
        const rows = db
          .select({
            url: crawlUrls.url,
            urlHash: crawlUrls.urlHash,
            kind: crawlLinks.kind,
            scope: crawlUrls.scope,
            urlKind: crawlUrls.kind,
            state: crawlUrls.state,
            statusCode: crawlUrls.statusCode,
            error: crawlUrls.error,
          })
          .from(crawlLinks)
          .innerJoin(crawlUrls, crawlLinkJoin(crawlLinks, crawlUrls, query.direction))
          .where(crawlLinkWhere(crawlLinks, crawlUrls.url, query))
          .orderBy(...crawlLinkOrder(crawlUrls.url, crawlUrls.urlHash, crawlLinks.kind))
          .limit(limit)
          .offset(offset)
          .all()
        return rows.map(toCrawlLinkRow)
      },

      async countLinks(query) {
        if (query.kinds?.length === 0) return 0
        const row = db
          .select({ count: sql<number>`count(*)` })
          .from(crawlLinks)
          .innerJoin(crawlUrls, crawlLinkJoin(crawlLinks, crawlUrls, query.direction))
          .where(crawlLinkWhere(crawlLinks, crawlUrls.url, query))
          .get()
        return Number(row?.count ?? 0)
      },

      async linkKindCounts(crawlId, urlHash, direction) {
        const rows = db
          .select({ kind: crawlLinks.kind, count: sql<number>`count(*)` })
          .from(crawlLinks)
          .innerJoin(crawlUrls, crawlLinkJoin(crawlLinks, crawlUrls, direction))
          .where(crawlLinkWhere(crawlLinks, crawlUrls.url, { crawlId, urlHash, direction }))
          .groupBy(crawlLinks.kind)
          .all()
        return rows.map((row) => ({ kind: row.kind as CrawlLinkKind, count: Number(row.count) }))
      },

      async linksFrom(crawlId, sourceHashes) {
        const found: CrawlLink[] = []
        for (const batch of chunk(sourceHashes)) {
          const rows = db
            .select({
              sourceHash: crawlLinks.sourceHash,
              targetHash: crawlLinks.targetHash,
              kind: crawlLinks.kind,
            })
            .from(crawlLinks)
            .where(and(eq(crawlLinks.crawlId, crawlId), inArray(crawlLinks.sourceHash, batch)))
            .all()
          found.push(...(rows as CrawlLink[]))
        }
        return found
      },

      async addSitemapHreflang(crawlId, entries) {
        for (const batch of chunk(entries)) {
          db.insert(crawlSitemapHreflang)
            .values(batch.map((entry) => sitemapHreflangRow(crawlId, entry)))
            .onConflictDoNothing()
            .run()
        }
      },

      async sitemapHreflangOf(crawlId, pageHashes) {
        const found: SitemapHreflang[] = []
        for (const batch of chunk(pageHashes)) {
          found.push(
            ...db
              .select({
                pageHash: crawlSitemapHreflang.pageHash,
                lang: crawlSitemapHreflang.lang,
                url: crawlSitemapHreflang.url,
              })
              .from(crawlSitemapHreflang)
              .where(
                and(
                  eq(crawlSitemapHreflang.crawlId, crawlId),
                  inArray(crawlSitemapHreflang.pageHash, batch),
                ),
              )
              .all(),
          )
        }
        return found
      },

      async pendingExternalLinks(crawlId, limit) {
        const rows = db
          .select({
            url: crawlUrls.url,
            urlHash: crawlUrls.urlHash,
            scope: crawlUrls.scope,
            source: crawlUrls.source,
            depth: crawlUrls.depth,
          })
          .from(crawlUrls)
          .where(
            and(
              eq(crawlUrls.crawlId, crawlId),
              eq(crawlUrls.scope, 'external'),
              eq(crawlUrls.state, 'skipped'),
              inArray(
                crawlUrls.urlHash,
                db
                  .select({ urlHash: crawlLinks.targetHash })
                  .from(crawlLinks)
                  .where(
                    and(
                      eq(crawlLinks.crawlId, crawlId),
                      inArray(crawlLinks.kind, ['anchor', 'anchor-nofollow']),
                    ),
                  ),
              ),
            ),
          )
          .orderBy(asc(crawlUrls.urlHash))
          .limit(limit)
          .all()
        return rows as NewCrawlUrl[]
      },

      async saveAnalysis({ crawlId, issues, accepted = [], pages, withType, catalog, audit }) {
        const issueRows = crawlIssueRows(crawlId, issues)
        const acceptedRows = crawlAcceptedRows(crawlId, accepted)
        const auditRows = crawlAuditRows(crawlId, audit.urls)
        return db.transaction(
          (tx) => {
            const current = tx
              .select({ version: crawls.auditVersion, pruned: crawls.pruned })
              .from(crawls)
              .where(eq(crawls.id, crawlId))
              .get()
            if (!current || current.pruned || supersedes(current.version, audit.snapshot.version)) {
              return false
            }
            tx.delete(crawlUrlIssues).where(eq(crawlUrlIssues.crawlId, crawlId)).run()
            for (const batch of chunk(issueRows)) tx.insert(crawlUrlIssues).values(batch).run()
            tx.delete(crawlUrlAcceptedIssues)
              .where(eq(crawlUrlAcceptedIssues.crawlId, crawlId))
              .run()
            for (const batch of chunk(acceptedRows)) {
              tx.insert(crawlUrlAcceptedIssues).values(batch).run()
            }
            tx.delete(crawlUrlAudit).where(eq(crawlUrlAudit.crawlId, crawlId)).run()
            for (const batch of chunk(auditRows)) tx.insert(crawlUrlAudit).values(batch).run()
            tx.update(crawls)
              .set(
                crawlAnalysisColumns({
                  pages,
                  withType,
                  catalog,
                  snapshot: audit.snapshot,
                  audit: audit.pages,
                }),
              )
              .where(eq(crawls.id, crawlId))
              .run()
            return true
          },
          { behavior: 'immediate' },
        )
      },

      async issueCounts(crawlId) {
        const rows = db
          .select({ issue: crawlUrlIssues.issue, pages: sql<number>`count(*)` })
          .from(crawlUrlIssues)
          .where(eq(crawlUrlIssues.crawlId, crawlId))
          .groupBy(crawlUrlIssues.issue)
          .all()
        return rows.map(({ issue, pages }) => ({ issue, pages: Number(pages) }))
      },

      async issuesOf(crawlId, urlHashes) {
        const found: CrawlUrlIssue[] = []
        for (const batch of chunk(urlHashes)) {
          const rows = db
            .select({
              urlHash: crawlUrlIssues.urlHash,
              issue: crawlUrlIssues.issue,
              details: crawlUrlIssues.details,
            })
            .from(crawlUrlIssues)
            .where(and(eq(crawlUrlIssues.crawlId, crawlId), inArray(crawlUrlIssues.urlHash, batch)))
            .all()
          found.push(...rows.map(toCrawlUrlIssue))
        }
        return found
      },

      async acceptedCounts(crawlId) {
        const rows = await db
          .select({
            issue: crawlUrlAcceptedIssues.issue,
            pages: countDistinct(crawlUrlAcceptedIssues.urlHash),
          })
          .from(crawlUrlAcceptedIssues)
          .where(eq(crawlUrlAcceptedIssues.crawlId, crawlId))
          .groupBy(crawlUrlAcceptedIssues.issue)
        return rows.map(({ issue, pages }) => ({ issue, pages: Number(pages) }))
      },

      async acceptedOf(crawlId, urlHashes) {
        const found: CrawlUrlAcceptedIssue[] = []
        for (const batch of chunk(urlHashes)) {
          const rows = await db
            .select()
            .from(crawlUrlAcceptedIssues)
            .where(
              and(
                eq(crawlUrlAcceptedIssues.crawlId, crawlId),
                inArray(crawlUrlAcceptedIssues.urlHash, batch),
              ),
            )
          for (const row of rows) {
            const finding = toCrawlUrlAcceptedIssue(row)
            if (finding) found.push(finding)
          }
        }
        return found
      },

      async acceptedBecauseOf(crawlId, urlHash, { limit }) {
        const where = and(
          eq(crawlUrlAcceptedIssues.crawlId, crawlId),
          eq(crawlUrlAcceptedIssues.acceptedBy, urlHash),
          ne(crawlUrlAcceptedIssues.urlHash, urlHash),
        )
        const [counted] = await db
          .select({ total: sql<number>`count(*)` })
          .from(crawlUrlAcceptedIssues)
          .where(where)
        const findings = await db
          .select({
            urlHash: crawlUrlAcceptedIssues.urlHash,
            url: crawlUrls.url,
            issue: crawlUrlAcceptedIssues.issue,
          })
          .from(crawlUrlAcceptedIssues)
          .innerJoin(
            crawlUrls,
            and(
              eq(crawlUrls.crawlId, crawlUrlAcceptedIssues.crawlId),
              eq(crawlUrls.urlHash, crawlUrlAcceptedIssues.urlHash),
            ),
          )
          .where(where)
          .orderBy(asc(crawlUrls.url), asc(crawlUrlAcceptedIssues.issue))
          .limit(limit)
        return { total: Number(counted?.total ?? 0), findings }
      },

      async auditOf(crawlId, urlHashes) {
        const found: CrawlUrlAudit[] = []
        for (const batch of chunk(urlHashes)) {
          const rows = db
            .select()
            .from(crawlUrlAudit)
            .where(and(eq(crawlUrlAudit.crawlId, crawlId), inArray(crawlUrlAudit.urlHash, batch)))
            .all()
          found.push(...rows.map(toCrawlUrlAudit))
        }
        return found
      },

      async auditRuleCounts(crawlId) {
        const count = sql<number>`count(*)`
        const byDimension = [
          crawlUrlAudit.participationRule,
          crawlUrlAudit.intentRule,
          crawlUrlAudit.noindexRule,
          crawlUrlAudit.nofollowRule,
          crawlUrlAudit.robotsRule,
          crawlUrlAudit.sitemapRule,
        ].map((column) =>
          db
            .select({ rule: column, count })
            .from(crawlUrlAudit)
            .where(and(eq(crawlUrlAudit.crawlId, crawlId), isNotNull(column)))
            .groupBy(column)
            .all(),
        )
        return foldRuleCounts(byDimension.flat())
      },

      async urlBriefs(crawlId, { limit, offset }) {
        const rows = db
          .select({
            urlHash: crawlUrls.urlHash,
            url: crawlUrls.url,
            kind: crawlUrls.kind,
            state: crawlUrls.state,
          })
          .from(crawlUrls)
          .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.scope, 'internal')))
          .orderBy(asc(crawlUrls.urlHash))
          .limit(limit)
          .offset(offset)
          .all()
        return rows as CrawlUrlBrief[]
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

      async compareCounts({ domainId, baseId, targetId, view }) {
        if (!(await comparablePair(domainId, baseId, targetId))) return null
        const differences = findingDifferences(baseId, targetId)
        const count = sql<number>`count(*)`
        const join = (otherId: string) =>
          and(eq(otherUrls.crawlId, otherId), eq(otherUrls.urlHash, crawlUrls.urlHash))
        const only = async (mainId: string, otherId: string) =>
          db
            .select({ count })
            .from(crawlUrls)
            .leftJoin(otherUrls, join(otherId))
            .where(
              and(
                eq(crawlUrls.crawlId, mainId),
                eq(crawlUrls.scope, 'internal'),
                compareViewOf(crawlUrls.kind, view),
                isNull(otherUrls.urlHash),
              ),
            )
            .get()
        const inBoth = and(
          eq(crawlUrls.crawlId, targetId),
          eq(crawlUrls.scope, 'internal'),
          eq(otherUrls.scope, 'internal'),
        )
        const sides = { target: crawlUrls, base: otherUrls }
        const changed = (change: Parameters<typeof changeCondition>[0]) =>
          sql<number>`sum(case when ${changeCondition(change, sides, sqliteDiffers, differences)} then 1 else 0 end)`
        const [added, missing, unrequested, compared] = await Promise.all([
          only(targetId, baseId),
          only(baseId, targetId),

          db
            .select({ count })
            .from(crawlUrls)
            .innerJoin(otherUrls, join(baseId))
            .where(and(inBoth, or(ne(crawlUrls.state, 'done'), ne(otherUrls.state, 'done'))))
            .get(),

          db
            .select({
              count,
              status: changed('status'),
              title: changed('title'),
              canonical: changed('canonical'),
              robots: changed('robots'),
              gained: changed('gained'),
              lost: changed('lost'),
            })
            .from(crawlUrls)
            .innerJoin(otherUrls, join(baseId))
            .where(
              and(
                inBoth,
                eq(crawlUrls.state, 'done'),
                eq(otherUrls.state, 'done'),
                compareViewEither(crawlUrls.kind, otherUrls.kind, view),
              ),
            )
            .get(),
        ])
        return {
          added: sumOf(added?.count),
          missing: sumOf(missing?.count),
          unrequested: sumOf(unrequested?.count),
          compared: sumOf(compared?.count),
          status: sumOf(compared?.status),
          title: sumOf(compared?.title),
          canonical: sumOf(compared?.canonical),
          robots: sumOf(compared?.robots),
          gained: sumOf(compared?.gained),
          lost: sumOf(compared?.lost),
        }
      },

      async compareUrls({ limit, offset, ...query }) {
        if (!(await comparablePair(query.domainId, query.baseId, query.targetId))) return []
        const plan = comparePlan(query)
        const rows = db
          .select({
            urlHash: crawlUrls.urlHash,
            url: crawlUrls.url,
            main: snapshotOf(crawlUrls),
            other: snapshotOf(otherUrls),
          })
          .from(crawlUrls)
          .leftJoin(
            otherUrls,
            and(eq(otherUrls.crawlId, plan.otherCrawlId), eq(otherUrls.urlHash, crawlUrls.urlHash)),
          )
          .where(
            compareWhere(
              query,
              crawlUrls,
              otherUrls,
              sqliteDiffers,
              findingDifferences(query.baseId, query.targetId),
            ),
          )
          .orderBy(asc(crawlUrls.url), asc(crawlUrls.urlHash))
          .limit(limit)
          .offset(offset)
          .all()
        return rows.map((row) => toUrlComparison(query.change, row))
      },

      async countCompared(query) {
        if (!(await comparablePair(query.domainId, query.baseId, query.targetId))) return 0
        const plan = comparePlan(query)
        const row = db
          .select({ count: sql<number>`count(*)` })
          .from(crawlUrls)
          .leftJoin(
            otherUrls,
            and(eq(otherUrls.crawlId, plan.otherCrawlId), eq(otherUrls.urlHash, crawlUrls.urlHash)),
          )
          .where(
            compareWhere(
              query,
              crawlUrls,
              otherUrls,
              sqliteDiffers,
              findingDifferences(query.baseId, query.targetId),
            ),
          )
          .get()
        return sumOf(row?.count)
      },

      async urlHistory({ domainId, crawlIds, urlHashes }) {
        if (crawlIds.length === 0 || urlHashes.length === 0) return []
        const owned: string[] = []
        for (const batch of chunk(crawlIds, HISTORY_BATCH)) {
          const rows = db
            .select({ id: crawls.id })
            .from(crawls)
            .where(
              and(
                eq(crawls.domainId, domainId),
                eq(crawls.type, 'full'),
                eq(crawls.pruned, false),
                inArray(crawls.id, batch),
              ),
            )
            .all()
          owned.push(...rows.map((row) => row.id))
        }
        const urls: Parameters<typeof foldTraces>[0] = []
        const issues: Parameters<typeof foldTraces>[1] = []
        const audits: Parameters<typeof foldTraces>[2] = []
        const accepted: NonNullable<Parameters<typeof foldTraces>[3]> = []
        for (const ids of chunk(owned, HISTORY_BATCH)) {
          for (const hashes of chunk(urlHashes, HISTORY_BATCH)) {
            urls.push(
              ...db
                .select({
                  crawlId: crawlUrls.crawlId,
                  urlHash: crawlUrls.urlHash,
                  url: crawlUrls.url,
                  ...snapshotOf(crawlUrls),
                })
                .from(crawlUrls)
                .where(
                  and(
                    inArray(crawlUrls.crawlId, ids),
                    eq(crawlUrls.scope, 'internal'),
                    inArray(crawlUrls.urlHash, hashes),
                  ),
                )
                .all(),
            )
            issues.push(
              ...db
                .select({
                  crawlId: crawlUrlIssues.crawlId,
                  urlHash: crawlUrlIssues.urlHash,
                  issue: crawlUrlIssues.issue,
                  details: crawlUrlIssues.details,
                })
                .from(crawlUrlIssues)
                .where(
                  and(
                    inArray(crawlUrlIssues.crawlId, ids),
                    inArray(crawlUrlIssues.urlHash, hashes),
                  ),
                )
                .all()
                .map((row) => ({ crawlId: row.crawlId, ...toCrawlUrlIssue(row) })),
            )
            accepted.push(
              ...db
                .select({
                  crawlId: crawlUrlAcceptedIssues.crawlId,
                  urlHash: crawlUrlAcceptedIssues.urlHash,
                  issue: crawlUrlAcceptedIssues.issue,
                })
                .from(crawlUrlAcceptedIssues)
                .where(
                  and(
                    inArray(crawlUrlAcceptedIssues.crawlId, ids),
                    inArray(crawlUrlAcceptedIssues.urlHash, hashes),
                  ),
                )
                .all(),
            )
            audits.push(
              ...db
                .select()
                .from(crawlUrlAudit)
                .where(
                  and(inArray(crawlUrlAudit.crawlId, ids), inArray(crawlUrlAudit.urlHash, hashes)),
                )
                .all()
                .map((row) => ({ crawlId: row.crawlId, ...toCrawlUrlAudit(row) })),
            )
          }
        }
        return foldTraces(urls, issues, audits, accepted)
      },
    },

    audit: {
      async config(domainId) {
        return readAuditConfig({
          state: async () =>
            db
              .select()
              .from(domainAuditConfig)
              .where(eq(domainAuditConfig.domainId, domainId))
              .get(),
          rules: async () =>
            db
              .select()
              .from(auditRules)
              .where(eq(auditRules.domainId, domainId))
              .orderBy(asc(auditRules.createdAt), asc(auditRules.id))
              .all(),
        })
      },

      async saveRule({ domainId, id, rule }) {
        return changeRules(domainId, (rows, context) =>
          planSaveRule(rows, { domainId, ...(id === undefined ? {} : { id }), rule }, context),
        )
      },

      async setRuleEnabled({ domainId, id, enabled }) {
        return changeRules(domainId, (rows, context) =>
          planSetEnabled(rows, { id, enabled }, context),
        )
      },

      async deleteRule({ domainId, id }) {
        return changeRules(domainId, (rows) => planDeleteRule(rows, { id }))
      },

      async setUrlConfig({ domainId, ...input }) {
        return changeRules(domainId, (rows, context) =>
          planUrlConfig(rows, { domainId, ...input }, context),
        )
      },

      async saveRuleSet({ domainId, ...input }) {
        return changeRules(domainId, (rows, context) =>
          planSaveRuleSet(rows, { domainId, ...input }, context),
        )
      },

      async setRulesEnabled({ domainId, ids, enabled }) {
        return changeRules(domainId, (rows, context) =>
          planSetEnabledMany(rows, { ids, enabled }, context),
        )
      },

      async deleteRules({ domainId, ids }) {
        return changeRules(domainId, (rows) => planDeleteMany(rows, { ids }))
      },

      async setLanguages({ domainId, languages }) {
        return changeRules(domainId, (_rows, context) => planLanguages(languages, context))
      },

      upgradeSemantics: upgradeAuditSemantics,

      async retryRecompute(domainId) {
        db.transaction(
          (tx) => {
            tx.update(domainAuditConfig)
              .set({ recomputeError: null, recomputeErrorVersion: null })
              .where(eq(domainAuditConfig.domainId, domainId))
              .run()
            requestRecompute(tx, domainId, new Date())
          },
          { behavior: 'immediate' },
        )
      },

      async failRecompute({ domainId, version, error }) {
        db.update(domainAuditConfig)
          .set({ recomputeError: truncateError(error), recomputeErrorVersion: version })
          .where(
            and(eq(domainAuditConfig.domainId, domainId), eq(domainAuditConfig.version, version)),
          )
          .run()
      },

      async clearRecomputeFailure({ domainId, version }) {
        db.update(domainAuditConfig)
          .set({ recomputeError: null, recomputeErrorVersion: null })
          .where(
            and(
              eq(domainAuditConfig.domainId, domainId),
              lte(domainAuditConfig.recomputeErrorVersion, version),
            ),
          )
          .run()
      },
    },

    verifications: {
      async start({ domainId, baseCrawlId, urls }) {
        assertVerificationUrls(urls)
        const now = new Date()
        const id = randomUUID()
        const jobId = randomUUID()
        try {
          db.transaction((tx) => {
            tx.insert(jobs)
              .values(verificationJobValues(id, jobId, now))
              .run()
            tx.insert(urlVerifications)
              .values({
                id,
                domainId,
                jobId,
                baseCrawlId,
                activeKey: domainId,
                urlsCount: urls.length,
                createdAt: now,
              })
              .run()
            tx.insert(urlVerificationUrls).values(newVerificationUrlRows(id, urls)).run()
          })
        } catch (error) {
          // Lost the race on the unique `active_key`: some other recheck of this domain is active.
          if (await this.active(domainId)) return null
          throw error
        }
        return this.get(id)
      },

      async get(id) {
        const row = db.select().from(urlVerifications).where(eq(urlVerifications.id, id)).get()
        return row ? toVerification(row) : null
      },

      async active(domainId) {
        const row = db
          .select()
          .from(urlVerifications)
          .where(eq(urlVerifications.activeKey, domainId))
          .get()
        return row ? toVerification(row) : null
      },

      async list(domainId, { limit = 20 } = {}) {
        return db
          .select()
          .from(urlVerifications)
          .where(eq(urlVerifications.domainId, domainId))
          .orderBy(desc(urlVerifications.createdAt), desc(urlVerifications.id))
          .limit(limit)
          .all()
          .map(toVerification)
      },

      async markRunning(id) {
        const active = and(eq(urlVerifications.id, id), isNotNull(urlVerifications.activeKey))
        db.update(urlVerifications)
          .set({ status: 'running', startedAt: new Date() })
          .where(and(active, isNull(urlVerifications.startedAt)))
          .run()
        db.update(urlVerifications).set({ status: 'running' }).where(active).run()
        const verification = await this.get(id)
        return verification && verification.status === 'running' ? verification : null
      },

      async queued(verificationId, limit) {
        return db
          .select({
            url: urlVerificationUrls.url,
            urlHash: urlVerificationUrls.urlHash,
            source: urlVerificationUrls.source,
          })
          .from(urlVerificationUrls)
          .where(
            and(
              eq(urlVerificationUrls.verificationId, verificationId),
              eq(urlVerificationUrls.state, 'queued'),
            ),
          )
          .orderBy(asc(urlVerificationUrls.url))
          .limit(limit)
          .all() as NewVerificationUrl[]
      },

      async recordResult({ verificationId, urlHash, answer, auditVersion, outcome }) {
        return db.transaction(
          (tx) => {
            const active = tx
              .select({ id: urlVerifications.id })
              .from(urlVerifications)
              .where(
                and(eq(urlVerifications.id, verificationId), isNotNull(urlVerifications.activeKey)),
              )
              .get()
            if (!active) return false
            const written = tx
              .update(urlVerificationUrls)
              .set({
                ...verificationAnswerColumns(answer, new Date()),
                auditVersion,
                outcome: verificationOutcomeColumn(outcome),
              })
              .where(
                and(
                  eq(urlVerificationUrls.verificationId, verificationId),
                  eq(urlVerificationUrls.urlHash, urlHash),
                ),
              )
              .run()
            if (written.changes === 0) return false
            const done = tx
              .select({ count: sql<number>`count(*)` })
              .from(urlVerificationUrls)
              .where(
                and(
                  eq(urlVerificationUrls.verificationId, verificationId),
                  eq(urlVerificationUrls.state, 'done'),
                ),
              )
              .get()
            tx.update(urlVerifications)
              .set({ urlsDoneCount: Number(done?.count ?? 0) })
              .where(eq(urlVerifications.id, verificationId))
              .run()
            return true
          },
          { behavior: 'immediate' },
        )
      },

      async urlsOf(verificationId) {
        return db
          .select()
          .from(urlVerificationUrls)
          .where(eq(urlVerificationUrls.verificationId, verificationId))
          .orderBy(asc(urlVerificationUrls.url))
          .all()
          .map(toVerifiedUrl)
      },

      async finish(id, { status, error }) {
        const done = db
          .select({ count: sql<number>`count(*)` })
          .from(urlVerificationUrls)
          .where(
            and(eq(urlVerificationUrls.verificationId, id), eq(urlVerificationUrls.state, 'done')),
          )
          .get()
        const result = db
          .update(urlVerifications)
          .set({
            urlsDoneCount: Number(done?.count ?? 0),
            status,
            error: error === undefined ? null : truncateError(error),
            activeKey: null,
            finishedAt: new Date(),
          })
          .where(and(eq(urlVerifications.id, id), isNotNull(urlVerifications.activeKey)))
          .run()
        return result.changes > 0
      },

      async cancel(id) {
        const result = db
          .update(urlVerifications)
          .set({ status: 'cancelled', activeKey: null, finishedAt: new Date() })
          .where(and(eq(urlVerifications.id, id), isNotNull(urlVerifications.activeKey)))
          .run()
        return result.changes > 0
      },

      async failOrphaned() {
        const orphans = db
          .select({ id: urlVerifications.id, jobError: jobs.lastError })
          .from(urlVerifications)
          .innerJoin(jobs, eq(urlVerifications.jobId, jobs.id))
          .where(
            and(
              isNotNull(urlVerifications.activeKey),
              inArray(jobs.status, ['failed', 'completed']),
            ),
          )
          .all()
        let failed = 0
        for (const orphan of orphans) {
          const ended = await this.finish(orphan.id, {
            status: 'failed',
            error: orphan.jobError ?? 'The recheck job ended unexpectedly',
          })
          if (ended) failed++
        }
        return failed
      },

      async latestFor(domainId, urlHashes) {
        const found: VerifiedUrl[] = []
        for (const batch of chunk(urlHashes)) {
          const rows = db
            .select({ row: urlVerificationUrls })
            .from(urlVerificationUrls)
            .innerJoin(
              urlVerifications,
              eq(urlVerifications.id, urlVerificationUrls.verificationId),
            )
            .where(
              and(
                eq(urlVerifications.domainId, domainId),
                inArray(urlVerificationUrls.urlHash, batch),
                eq(urlVerificationUrls.state, 'done'),
              ),
            )
            .all()
          found.push(...rows.map(({ row }) => toVerifiedUrl(row)))
        }
        return newestVerifiedPerUrl(found)
      },

      async prune({ domainId, keep }) {
        const ended = db
          .select({ id: urlVerifications.id })
          .from(urlVerifications)
          .where(and(eq(urlVerifications.domainId, domainId), isNull(urlVerifications.activeKey)))
          .orderBy(desc(urlVerifications.createdAt), desc(urlVerifications.id))
          .all()
        const expired = expiredVerifications(ended, keep)
        if (expired.length === 0) return 0
        db.transaction((tx) => {
          for (const batch of chunk(expired)) {
            tx.delete(urlVerificationUrls)
              .where(inArray(urlVerificationUrls.verificationId, batch))
              .run()
            tx.delete(urlVerifications).where(inArray(urlVerifications.id, batch)).run()
          }
        })
        return expired.length
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

    crawlFiles: {
      async list(domainId, kinds) {
        const rows = db
          .select()
          .from(crawlFiles)
          .where(
            and(
              eq(crawlFiles.domainId, domainId),
              kinds ? inArray(crawlFiles.kind, [...kinds]) : undefined,
            ),
          )
          .all()
        return rows.map(toCrawlFile).sort(byUrl)
      },
      async save(domainId, files) {
        for (const file of files) {
          db.insert(crawlFiles)
            .values(crawlFileRow(domainId, file))
            .onConflictDoUpdate({
              target: [crawlFiles.domainId, crawlFiles.urlHash],
              set: crawlFileColumns(file),
            })
            .run()
        }
      },
      async prune({ domainId, before, keepKinds }) {
        const result = db
          .delete(crawlFiles)
          .where(
            and(
              eq(crawlFiles.domainId, domainId),
              lt(crawlFiles.fetchedAt, before),
              keepKinds?.length ? notInArray(crawlFiles.kind, [...keepKinds]) : undefined,
            ),
          )
          .run()
        return result.changes
      },
      async getCheck(domainId) {
        const row = db
          .select()
          .from(crawlFileChecks)
          .where(eq(crawlFileChecks.domainId, domainId))
          .get()
        return row ? toCrawlFileCheck(row) : null
      },
      async requestCheck({ domainId, now }) {
        const values = { nextCheckAt: now, requestedAt: now }
        db.insert(crawlFileChecks)
          .values({ domainId, ...values })
          .onConflictDoUpdate({ target: crawlFileChecks.domainId, set: values })
          .run()
      },
      async dueChecks({ now, limit }) {
        return db
          .select({ id: domains.id, host: domains.host })
          .from(domains)
          .leftJoin(crawlFileChecks, eq(crawlFileChecks.domainId, domains.id))
          .where(or(isNull(crawlFileChecks.domainId), lte(crawlFileChecks.nextCheckAt, now)))
          .orderBy(asc(domains.createdAt), asc(domains.id))
          .limit(limit)
          .all()
      },
      async claimCheck({ domainId, now, retryAt }) {
        // A domain never checked has no row yet: its first check is due as of now.
        db.insert(crawlFileChecks)
          .values({ domainId, nextCheckAt: now })
          .onConflictDoNothing()
          .run()
        const result = db
          .update(crawlFileChecks)
          .set({ nextCheckAt: retryAt })
          .where(and(eq(crawlFileChecks.domainId, domainId), lte(crawlFileChecks.nextCheckAt, now)))
          .run()
        return result.changes > 0
      },
      async finishCheck({ domainId, outcome, checkedAt, nextCheckAt }) {
        const values = { outcome, checkedAt, nextCheckAt, requestedAt: null }
        db.insert(crawlFileChecks)
          .values({ domainId, ...values })
          .onConflictDoUpdate({ target: crawlFileChecks.domainId, set: values })
          .run()
      },
      async deferCheck({ domainId, nextCheckAt }) {
        db.update(crawlFileChecks)
          .set({ nextCheckAt, requestedAt: null })
          .where(eq(crawlFileChecks.domainId, domainId))
          .run()
      },
    },

    favicons: {
      async get(domainId) {
        const row = db
          .select()
          .from(domainFavicons)
          .where(eq(domainFavicons.domainId, domainId))
          .get()
        return row ? toDomainFavicon(row) : null
      },
      async versions() {
        const rows = db
          .select({ domainId: domainFavicons.domainId, hash: domainFavicons.hash })
          .from(domainFavicons)
          .where(isNotNull(domainFavicons.hash))
          .all()
        return new Map(rows.flatMap((row) => (row.hash ? [[row.domainId, row.hash] as const] : [])))
      },
      async due({ now, limit }) {
        return db
          .select({ id: domains.id, host: domains.host })
          .from(domains)
          .leftJoin(domainFavicons, eq(domainFavicons.domainId, domains.id))
          .where(or(isNull(domainFavicons.domainId), lte(domainFavicons.nextCheckAt, now)))
          .orderBy(asc(domains.createdAt), asc(domains.id))
          .limit(limit)
          .all()
      },
      async save({ domainId, icon, nextCheckAt }) {
        const { domainId: _domainId, ...values } = faviconRow(domainId, icon, nextCheckAt)
        db.insert(domainFavicons)
          .values({ domainId, ...values })
          .onConflictDoUpdate({ target: domainFavicons.domainId, set: values })
          .run()
      },
      async defer({ domainId, nextCheckAt }) {
        db.insert(domainFavicons)
          .values({ domainId, nextCheckAt })
          .onConflictDoUpdate({ target: domainFavicons.domainId, set: { nextCheckAt } })
          .run()
      },
    },
  }
}
