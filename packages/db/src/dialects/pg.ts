import { randomUUID } from 'node:crypto'
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
  or,
  sql,
} from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import {
  CREDENTIAL_PROVIDER,
  EMPTY_COUNTS,
  byUrl,
  chunk,
  crawlJobValues,
  crawlResultColumns,
  crawlRobotsColumn,
  crawlIssueRows,
  crawlAnalysisColumns,
  crawlAuditRows,
  crawlAuditWhere,
  foldRuleCounts,
  supersedes,
  toCrawlUrlAudit,
  sitemapHreflangRow,
  toCrawlUrlIssue,
  crawlUrlOrder,
  crawlUrlWhere,
  crawlFileColumns,
  crawlFileRow,
  crawlSettingsColumns,
  assertVerificationUrls,
  enabledFilesByDomain,
  expiredVerifications,
  faviconRow,
  foldCrawlCounts,
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
  inApplyOrder,
  languageColumns,
  languagesOf,
  mutationResult,
  planChanges,
  planDeleteRule,
  planLanguages,
  planUpgradeSemantics,
  planSaveRule,
  planSetEnabled,
  planUrlConfig,
  readAuditConfig,
  recomputeJobValues,
  recomputePayload,
  toAuditRule,
  type AuditPlan,
  type AuditRuleRow,
  type PlanContext,
} from '../audit'
import * as schema from '../schema/pg'
import type {
  CrawlLink,
  CrawlUrlAudit,
  CrawlUrlBrief,
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

export function createPgDatabase(options: {
  url: string
  defaultMigrationsDir: () => string
}): Database {
  const client = postgres(options.url, { max: 10, onnotice: () => {} })
  const db = drizzle(client, { schema })

  /** The hashes of the URLs of a crawl that have an issue, and of those a filter on the audit keeps. */
  const subqueries = (crawlId: string) => ({
    withIssue: (issue: string) =>
      db
        .select({ urlHash: crawlUrlIssues.urlHash })
        .from(crawlUrlIssues)
        .where(and(eq(crawlUrlIssues.crawlId, crawlId), eq(crawlUrlIssues.issue, issue))),
    withAudit: (filter: Parameters<typeof crawlAuditWhere>[2]) =>
      db
        .select({ urlHash: crawlUrlAudit.urlHash })
        .from(crawlUrlAudit)
        .where(crawlAuditWhere(crawlUrlAudit, crawlId, filter)),
  })

  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

  /**
   * The row that versions a domain's rules and serializes the changes to them. Created apart from
   * the transaction that locks it, so that concurrent first changes cannot deadlock creating it.
   */
  const ensureAuditConfig = async (domainId: string) => {
    await db
      .insert(domainAuditConfig)
      .values({ domainId, version: 0, updatedAt: new Date() })
      .onConflictDoNothing()
  }

  /** Asks for the latest full crawl to be analysed again, unless there is none or it is already asked. */
  const requestRecompute = async (tx: Tx, domainId: string, now: Date) => {
    const usable = (
      await tx
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
    )[0]
    if (!usable) return
    const waiting = (
      await tx
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
    )[0]
    if (waiting) return
    await tx.insert(jobs).values(recomputeJobValues(domainId, randomUUID(), now))
  }

  /**
   * Runs a change to the rules of a domain: see `AuditRepository`. The row of the domain's version
   * is locked first, so changes to one domain take turns and each plans from the rules the one
   * before left.
   */
  const changeRules = (
    domainId: string,
    plan: (rows: AuditRuleRow[], context: PlanContext) => AuditPlan,
  ) =>
    ensureAuditConfig(domainId).then(() =>
      db.transaction(async (tx) => {
        const now = new Date()
        const config = (
          await tx
            .select()
            .from(domainAuditConfig)
            .where(eq(domainAuditConfig.domainId, domainId))
            .for('update')
        )[0]
        let version = config?.version ?? 0
        const rows = await tx.select().from(auditRules).where(eq(auditRules.domainId, domainId))
        const decided = plan(rows, { now, newId: randomUUID, languages: languagesOf(config) })
        if (decided.ok && planChanges(decided)) {
          for (const change of inApplyOrder(decided.changes)) {
            if (change.op === 'delete')
              await tx.delete(auditRules).where(eq(auditRules.id, change.id))
            else if (change.op === 'update') {
              await tx.update(auditRules).set(change.patch).where(eq(auditRules.id, change.id))
            } else await tx.insert(auditRules).values(change.row)
          }
          version += 1
          await tx
            .update(domainAuditConfig)
            .set({
              version,
              recomputeError: null,
              recomputeErrorVersion: null,
              updatedAt: now,
              ...(decided.languages ? languageColumns(decided.languages) : {}),
            })
            .where(eq(domainAuditConfig.domainId, domainId))
          await requestRecompute(tx, domainId, now)
        }
        const saved =
          decided.ok && decided.result
            ? (await tx.select().from(auditRules).where(eq(auditRules.id, decided.result)))[0]
            : undefined
        return mutationResult(decided, version, () => (saved ? toAuditRule(saved) : null))
      }),
    )

  /**
   * Brings the rules of every domain to the current meaning of a configuration, once (see
   * `AuditRepository.upgradeSemantics`). The rules of a domain that has none, and no crawl to
   * analyse again, have nothing to change: what a new domain is expected to be is the default.
   */
  const upgradeAuditSemantics = async () => {
    const done = (
      await db.select().from(settings).where(eq(settings.key, AUDIT_SEMANTICS_SETTING))
    )[0]
    if (done?.value === String(AUDIT_SEMANTICS)) return
    const withRules = await db.selectDistinct({ id: auditRules.domainId }).from(auditRules)
    const withCrawls = await db
      .selectDistinct({ id: crawls.domainId })
      .from(crawls)
      .where(
        and(
          eq(crawls.type, 'full'),
          inArray(crawls.status, ['completed', 'incomplete']),
          eq(crawls.pruned, false),
        ),
      )
    for (const domainId of new Set([...withRules, ...withCrawls].map((row) => row.id))) {
      await changeRules(domainId, (rows) => planUpgradeSemantics(rows))
    }
    const value = String(AUDIT_SEMANTICS)
    const updatedAt = new Date()
    await db
      .insert(settings)
      .values({ key: AUDIT_SEMANTICS_SETTING, value, encrypted: false, updatedAt })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
  }

  return {
    dialect: 'pg',
    orm: {
      db,
      schema: { user, session: schema.session, account, verification: schema.verification },
    },

    async ping() {
      await db.execute(sql`select 1`)
    },

    async migrate(dir) {
      await migrate(db, { migrationsFolder: dir ?? options.defaultMigrationsDir() })
      await upgradeAuditSemantics()
    },

    async close() {
      await client.end({ timeout: 5 })
    },

    jobs: {
      async enqueue(input) {
        const now = new Date()
        const [row] = await db
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
        return toJob(row!)
      },

      async get(id) {
        const [row] = await db.select().from(jobs).where(eq(jobs.id, id))
        return row ? toJob(row) : null
      },

      async list({ limit = 20, status } = {}) {
        const rows = await db
          .select()
          .from(jobs)
          .where(status ? eq(jobs.status, status) : undefined)
          .orderBy(desc(jobs.createdAt))
          .limit(limit)
        return rows.map(toJob)
      },

      async countByStatus() {
        const rows = await db
          .select({ status: jobs.status, count: sql<number>`count(*)` })
          .from(jobs)
          .groupBy(jobs.status)
        const counts = { ...EMPTY_COUNTS }
        for (const r of rows) counts[r.status] = Number(r.count)
        return counts
      },

      async claim({ workerId, limit, now = new Date(), types, excludeTypes }) {
        // FOR UPDATE SKIP LOCKED: concurrent workers each get a disjoint set of rows.
        const claimed = await db.transaction(async (tx) => {
          const due = await tx
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
            .for('update', { skipLocked: true })
          const out = []
          for (const row of due) {
            const patch = {
              status: 'running' as const,
              attempts: row.attempts + 1,
              lockedAt: now,
              lockedBy: workerId,
              updatedAt: now,
            }
            await tx.update(jobs).set(patch).where(eq(jobs.id, row.id))
            out.push({ ...row, ...patch })
          }
          return out
        })
        return claimed.map(toJob)
      },

      async complete({ id, workerId, result }) {
        await db
          .update(jobs)
          .set({
            status: 'completed',
            result: result === undefined ? null : JSON.stringify(result),
            lastError: null,
            lockedAt: null,
            lockedBy: null,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
      },

      async fail({ id, workerId, error, retryAt }) {
        await db
          .update(jobs)
          .set({
            status: retryAt ? 'pending' : 'failed',
            ...(retryAt ? { runAt: retryAt } : {}),
            lastError: truncateError(error),
            lockedAt: null,
            lockedBy: null,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
      },

      async renewLock({ id, workerId, now = new Date() }) {
        await db
          .update(jobs)
          .set({ lockedAt: now, updatedAt: now })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
      },

      async release({ id, workerId, runAt }) {
        await db
          .update(jobs)
          .set({
            status: 'pending',
            attempts: sql`${jobs.attempts} - 1`,
            ...(runAt ? { runAt } : {}),
            lockedAt: null,
            lockedBy: null,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
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
        return db.transaction(async (tx) => {
          const failed = await tx
            .update(jobs)
            .set({ ...reset, status: 'failed' })
            .where(and(stale, gte(jobs.attempts, jobs.maxAttempts)))
            .returning({ id: jobs.id })
          const requeued = await tx
            .update(jobs)
            .set({ ...reset, status: 'pending', runAt: now })
            .where(stale)
            .returning({ id: jobs.id })
          return failed.length + requeued.length
        })
      },
    },

    heartbeats: {
      async beat({ workerId, startedAt, now = new Date() }) {
        await db
          .insert(workerHeartbeats)
          .values({ workerId, startedAt, lastSeenAt: now })
          .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { lastSeenAt: now } })
        await db
          .delete(workerHeartbeats)
          .where(lt(workerHeartbeats.lastSeenAt, new Date(now.getTime() - 24 * 3600_000)))
      },
      async latest() {
        const [row] = await db
          .select()
          .from(workerHeartbeats)
          .orderBy(desc(workerHeartbeats.lastSeenAt))
          .limit(1)
        return row ?? null
      },
    },

    settings: {
      async get(key) {
        const [row] = await db.select().from(settings).where(eq(settings.key, key))
        return row ? { value: row.value, encrypted: row.encrypted } : null
      },
      async set(key, value, encrypted) {
        const updatedAt = new Date()
        await db
          .insert(settings)
          .values({ key, value, encrypted, updatedAt })
          .onConflictDoUpdate({ target: settings.key, set: { value, encrypted, updatedAt } })
      },
      async delete(key) {
        await db.delete(settings).where(eq(settings.key, key))
      },
    },

    admin: {
      async findByEmail(email) {
        const [found] = await db.select().from(user).where(eq(user.email, email))
        if (!found) return null
        const [cred] = await db
          .select({ password: account.password })
          .from(account)
          .where(and(eq(account.userId, found.id), eq(account.providerId, CREDENTIAL_PROVIDER)))
        return { id: found.id, email: found.email, passwordHash: cred?.password ?? null }
      },
      async create({ id, email, name, passwordHash }) {
        await db.transaction(async (tx) => {
          await tx.insert(user).values({ id, email, name, emailVerified: true })
          await tx.insert(account).values({
            id: randomUUID(),
            accountId: id,
            providerId: CREDENTIAL_PROVIDER,
            userId: id,
            password: passwordHash,
          })
        })
      },
      async exists() {
        const rows = await db.select({ id: user.id }).from(user).limit(1)
        return rows.length > 0
      },
    },

    companies: {
      async list() {
        // Domains first: every domain read has its company, so the second read can't miss one.
        const domainRows = await db.select().from(domains)
        const companyRows = await db.select().from(companies)
        return groupDomains(companyRows, domainRows)
      },
      async get(id) {
        const [row] = await db.select().from(companies).where(eq(companies.id, id))
        return row ?? null
      },
      async create({ name, host }) {
        const now = new Date()
        const company = { id: randomUUID(), name, createdAt: now }
        const domain = { id: randomUUID(), companyId: company.id, host, createdAt: now }
        await db.transaction(async (tx) => {
          await tx.insert(companies).values(company)
          await tx.insert(domains).values(domain)
        })
        return { company, domain }
      },
    },

    domains: {
      async get(id) {
        const [row] = await db.select().from(domains).where(eq(domains.id, id))
        return row ?? null
      },
      async findByHost(host) {
        const [row] = await db
          .select({ domain: domains, company: companies })
          .from(domains)
          .innerJoin(companies, eq(domains.companyId, companies.id))
          .where(eq(domains.host, host))
        return row ? { ...row.domain, company: row.company } : null
      },
      async add({ companyId, host }) {
        const domain = { id: randomUUID(), companyId, host, createdAt: new Date() }
        await db.insert(domains).values(domain)
        return domain
      },
    },

    crawls: {
      async settings(domainId) {
        const row = (
          await db.select().from(crawlSettings).where(eq(crawlSettings.domainId, domainId))
        )[0]
        if (!row) return { ...DEFAULT_CRAWL_SETTINGS }
        return toCrawlSettings(row)
      },

      async enabledFiles() {
        return enabledFilesByDomain(await db.select().from(crawlSettings))
      },

      async saveSettings(domainId, input) {
        const values = crawlSettingsColumns(input)
        const updatedAt = new Date()
        await db
          .insert(crawlSettings)
          .values({ domainId, ...values, updatedAt })
          .onConflictDoUpdate({ target: crawlSettings.domainId, set: { ...values, updatedAt } })
      },

      async start({ domainId, type, trigger }) {
        const now = new Date()
        const id = randomUUID()
        const jobId = randomUUID()
        try {
          await db.transaction(async (tx) => {
            await tx.insert(jobs).values(crawlJobValues(id, jobId, now))
            await tx
              .insert(crawls)
              .values({ id, domainId, type, trigger, jobId, activeKey: domainId, createdAt: now })
          })
        } catch (error) {
          // Lost the race on the unique `active_key`: some other crawl of this domain is active.
          if (await this.active(domainId)) return null
          throw error
        }
        return this.get(id)
      },

      async get(id) {
        const row = (await db.select().from(crawls).where(eq(crawls.id, id)))[0]
        return row ? toCrawl(row) : null
      },

      async active(domainId) {
        const row = (await db.select().from(crawls).where(eq(crawls.activeKey, domainId)))[0]
        return row ? toCrawl(row) : null
      },

      async list(domainId, { limit = 20, type } = {}) {
        const rows = await db
          .select()
          .from(crawls)
          .where(and(eq(crawls.domainId, domainId), type ? eq(crawls.type, type) : undefined))
          .orderBy(desc(crawls.createdAt))
          .limit(limit)
        return rows.map(toCrawl)
      },

      async latestWithResults(domainId, type) {
        const row = (
          await db
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
        )[0]
        return row ? toCrawl(row) : null
      },

      async outdatedAnalyses(catalog, limit) {
        const rows = await db
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
        return rows.map(toCrawl)
      },

      async markRunning(id) {
        const startedAt = new Date()
        await db
          .update(crawls)
          .set({ status: 'running', startedAt })
          .where(and(eq(crawls.id, id), isNotNull(crawls.activeKey), isNull(crawls.startedAt)))
        await db
          .update(crawls)
          .set({ status: 'running' })
          .where(and(eq(crawls.id, id), isNotNull(crawls.activeKey)))
        const crawl = await this.get(id)
        return crawl && crawl.status === 'running' ? crawl : null
      },

      async updateCounts(id, counts) {
        await db
          .update(crawls)
          .set(counts)
          .where(and(eq(crawls.id, id), isNotNull(crawls.activeKey)))
      },

      async saveRobots(id, robots) {
        await db
          .update(crawls)
          .set({ robots: crawlRobotsColumn(robots) })
          .where(eq(crawls.id, id))
      },

      async finish(id, { status, error }) {
        const counts = await this.countUrls(id)
        const result = await db
          .update(crawls)
          .set({
            ...counts,
            status,
            error: error === undefined ? null : truncateError(error),
            activeKey: null,
            finishedAt: new Date(),
          })
          .where(and(eq(crawls.id, id), isNotNull(crawls.activeKey)))
        return result.count > 0
      },

      async cancel(id) {
        const result = await db
          .update(crawls)
          .set({ status: 'cancelled', activeKey: null, finishedAt: new Date() })
          .where(and(eq(crawls.id, id), isNotNull(crawls.activeKey)))
        return result.count > 0
      },

      async failOrphaned() {
        const orphans = await db
          .select({ id: crawls.id, jobError: jobs.lastError })
          .from(crawls)
          .innerJoin(jobs, eq(crawls.jobId, jobs.id))
          .where(and(isNotNull(crawls.activeKey), inArray(jobs.status, ['failed', 'completed'])))
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
        const candidates = await db
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
        let usable = 0
        const expired = candidates
          .filter((crawl) => {
            if (crawl.status !== 'completed' && crawl.status !== 'incomplete') return true
            usable++
            return keep !== null && usable > keep
          })
          .map((crawl) => crawl.id)
        if (expired.length === 0) return 0
        await db.transaction(async (tx) => {
          await tx.delete(crawlLinks).where(inArray(crawlLinks.crawlId, expired))
          await tx.delete(crawlUrlIssues).where(inArray(crawlUrlIssues.crawlId, expired))
          await tx.delete(crawlUrlAudit).where(inArray(crawlUrlAudit.crawlId, expired))
          await tx
            .delete(crawlSitemapHreflang)
            .where(inArray(crawlSitemapHreflang.crawlId, expired))
          await tx.delete(crawlUrls).where(inArray(crawlUrls.crawlId, expired))
          await tx.update(crawls).set({ pruned: true }).where(inArray(crawls.id, expired))
        })
        return expired.length
      },

      async addUrls(crawlId, urls) {
        for (const batch of chunk(urls)) {
          await db
            .insert(crawlUrls)
            .values(batch.map((url) => newCrawlUrlRow(crawlId, url)))
            .onConflictDoNothing()
        }
      },

      async nextQueued(crawlId, limit) {
        const rows = await db
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
        return rows as NewCrawlUrl[]
      },

      async knownUrls(crawlId) {
        return await db
          .select({ urlHash: crawlUrls.urlHash, scope: crawlUrls.scope })
          .from(crawlUrls)
          .where(eq(crawlUrls.crawlId, crawlId))
      },

      async recordResult({ crawlId, urlHash, result, urls = [], links = [] }) {
        const columns = crawlResultColumns(result, new Date())
        await db.transaction(async (tx) => {
          for (const batch of chunk(urls)) {
            await tx
              .insert(crawlUrls)
              .values(batch.map((url) => newCrawlUrlRow(crawlId, url)))
              .onConflictDoNothing()
          }
          for (const batch of chunk(links)) {
            await tx
              .insert(crawlLinks)
              .values(batch.map((link) => newCrawlLinkRow(crawlId, link)))
              .onConflictDoNothing()
          }
          await tx
            .update(crawlUrls)
            .set(columns)
            .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.urlHash, urlHash)))
        })
      },

      async countUrls(crawlId) {
        const rows = await db
          .select({
            scope: crawlUrls.scope,
            kind: crawlUrls.kind,
            state: crawlUrls.state,
            count: sql<number>`count(*)`,
          })
          .from(crawlUrls)
          .where(eq(crawlUrls.crawlId, crawlId))
          .groupBy(crawlUrls.scope, crawlUrls.kind, crawlUrls.state)
        return foldCrawlCounts(rows)
      },

      async listUrls({ limit, offset, sort, direction, ...query }) {
        const rows = await db
          .select()
          .from(crawlUrls)
          .where(crawlUrlWhere(urlColumns, query, subqueries(query.crawlId)))
          .orderBy(...crawlUrlOrder(urlColumns, sort, direction))
          .limit(limit)
          .offset(offset)
        return rows.map(toCrawlUrl)
      },

      async countListed(query) {
        const row = (
          await db
            .select({ count: sql<number>`count(*)` })
            .from(crawlUrls)
            .where(crawlUrlWhere(urlColumns, query, subqueries(query.crawlId)))
        )[0]
        return Number(row?.count ?? 0)
      },

      async getUrl(crawlId, urlHash) {
        const row = (
          await db
            .select()
            .from(crawlUrls)
            .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.urlHash, urlHash)))
        )[0]
        return row ? toCrawlUrl(row) : null
      },

      async linkSources(crawlId, targetHash, { limit = MAX_LIMIT } = {}) {
        const rows = await db
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
        return rows as { url: string; kind: CrawlLinkKind }[]
      },

      async linkTargets(crawlId, sourceHash, { limit = MAX_LIMIT } = {}) {
        const rows = await db
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
        return rows as { url: string; kind: CrawlLinkKind }[]
      },

      async linksFrom(crawlId, sourceHashes) {
        const found: CrawlLink[] = []
        for (const batch of chunk(sourceHashes)) {
          const rows = await db
            .select({
              sourceHash: crawlLinks.sourceHash,
              targetHash: crawlLinks.targetHash,
              kind: crawlLinks.kind,
            })
            .from(crawlLinks)
            .where(and(eq(crawlLinks.crawlId, crawlId), inArray(crawlLinks.sourceHash, batch)))
          found.push(...(rows as CrawlLink[]))
        }
        return found
      },

      async addSitemapHreflang(crawlId, entries) {
        for (const batch of chunk(entries)) {
          await db
            .insert(crawlSitemapHreflang)
            .values(batch.map((entry) => sitemapHreflangRow(crawlId, entry)))
            .onConflictDoNothing()
        }
      },

      async sitemapHreflangOf(crawlId, pageHashes) {
        const found: SitemapHreflang[] = []
        for (const batch of chunk(pageHashes)) {
          found.push(
            ...(await db
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
              )),
          )
        }
        return found
      },

      async pendingExternalLinks(crawlId, limit) {
        const rows = await db
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
        return rows as NewCrawlUrl[]
      },

      async saveAnalysis({ crawlId, issues, pages, withType, catalog, audit }) {
        const issueRows = crawlIssueRows(crawlId, issues)
        const auditRows = crawlAuditRows(crawlId, audit.urls)
        return db.transaction(async (tx) => {
          // Locked: of two analyses of one crawl at once, the second reads what the first saved.
          const current = (
            await tx
              .select({ version: crawls.auditVersion, pruned: crawls.pruned })
              .from(crawls)
              .where(eq(crawls.id, crawlId))
              .for('update')
          )[0]
          if (!current || current.pruned || supersedes(current.version, audit.snapshot.version)) {
            return false
          }
          await tx.delete(crawlUrlIssues).where(eq(crawlUrlIssues.crawlId, crawlId))
          for (const batch of chunk(issueRows)) await tx.insert(crawlUrlIssues).values(batch)
          await tx.delete(crawlUrlAudit).where(eq(crawlUrlAudit.crawlId, crawlId))
          for (const batch of chunk(auditRows)) await tx.insert(crawlUrlAudit).values(batch)
          await tx
            .update(crawls)
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
          return true
        })
      },

      async issueCounts(crawlId) {
        const rows = await db
          .select({ issue: crawlUrlIssues.issue, pages: sql<number>`count(*)` })
          .from(crawlUrlIssues)
          .where(eq(crawlUrlIssues.crawlId, crawlId))
          .groupBy(crawlUrlIssues.issue)
        return rows.map(({ issue, pages }) => ({ issue, pages: Number(pages) }))
      },

      async issuesOf(crawlId, urlHashes) {
        const found: CrawlUrlIssue[] = []
        for (const batch of chunk(urlHashes)) {
          const rows = await db
            .select({
              urlHash: crawlUrlIssues.urlHash,
              issue: crawlUrlIssues.issue,
              details: crawlUrlIssues.details,
            })
            .from(crawlUrlIssues)
            .where(and(eq(crawlUrlIssues.crawlId, crawlId), inArray(crawlUrlIssues.urlHash, batch)))
          found.push(...rows.map(toCrawlUrlIssue))
        }
        return found
      },

      async auditOf(crawlId, urlHashes) {
        const found: CrawlUrlAudit[] = []
        for (const batch of chunk(urlHashes)) {
          const rows = await db
            .select()
            .from(crawlUrlAudit)
            .where(and(eq(crawlUrlAudit.crawlId, crawlId), inArray(crawlUrlAudit.urlHash, batch)))
          found.push(...rows.map(toCrawlUrlAudit))
        }
        return found
      },

      async auditRuleCounts(crawlId) {
        const count = sql<number>`count(*)`
        const byDimension = await Promise.all(
          [crawlUrlAudit.participationRule, crawlUrlAudit.intentRule].map((column) =>
            db
              .select({ rule: column, count })
              .from(crawlUrlAudit)
              .where(and(eq(crawlUrlAudit.crawlId, crawlId), isNotNull(column)))
              .groupBy(column),
          ),
        )
        return foldRuleCounts(byDimension.flat())
      },

      async urlBriefs(crawlId, { limit, offset }) {
        const rows = await db
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
        return rows as CrawlUrlBrief[]
      },

      async latestResults(domainId, urlHashes) {
        if (urlHashes.length === 0) return []
        const rows = await db
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
        return newestPerUrl(rows.map(({ row }) => toCrawlUrl(row)))
      },
    },

    audit: {
      async config(domainId) {
        return readAuditConfig({
          state: async () =>
            (
              await db
                .select()
                .from(domainAuditConfig)
                .where(eq(domainAuditConfig.domainId, domainId))
            )[0],
          rules: async () =>
            db
              .select()
              .from(auditRules)
              .where(eq(auditRules.domainId, domainId))
              .orderBy(asc(auditRules.createdAt), asc(auditRules.id)),
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

      async setLanguages({ domainId, languages }) {
        return changeRules(domainId, (_rows, context) => planLanguages(languages, context))
      },

      upgradeSemantics: upgradeAuditSemantics,

      async retryRecompute(domainId) {
        await db.transaction(async (tx) => {
          await tx
            .update(domainAuditConfig)
            .set({ recomputeError: null, recomputeErrorVersion: null })
            .where(eq(domainAuditConfig.domainId, domainId))
          await requestRecompute(tx, domainId, new Date())
        })
      },

      async failRecompute({ domainId, version, error }) {
        await db
          .update(domainAuditConfig)
          .set({ recomputeError: truncateError(error), recomputeErrorVersion: version })
          .where(
            and(eq(domainAuditConfig.domainId, domainId), eq(domainAuditConfig.version, version)),
          )
      },

      async clearRecomputeFailure({ domainId, version }) {
        await db
          .update(domainAuditConfig)
          .set({ recomputeError: null, recomputeErrorVersion: null })
          .where(
            and(
              eq(domainAuditConfig.domainId, domainId),
              lte(domainAuditConfig.recomputeErrorVersion, version),
            ),
          )
      },
    },

    verifications: {
      async start({ domainId, baseCrawlId, urls }) {
        assertVerificationUrls(urls)
        const now = new Date()
        const id = randomUUID()
        const jobId = randomUUID()
        try {
          await db.transaction(async (tx) => {
            await tx.insert(jobs).values(verificationJobValues(id, jobId, now))
            await tx.insert(urlVerifications).values({
              id,
              domainId,
              jobId,
              baseCrawlId,
              activeKey: domainId,
              urlsCount: urls.length,
              createdAt: now,
            })
            await tx.insert(urlVerificationUrls).values(newVerificationUrlRows(id, urls))
          })
        } catch (error) {
          // Lost the race on the unique `active_key`: some other recheck of this domain is active.
          if (await this.active(domainId)) return null
          throw error
        }
        return this.get(id)
      },

      async get(id) {
        const row = (await db.select().from(urlVerifications).where(eq(urlVerifications.id, id)))[0]
        return row ? toVerification(row) : null
      },

      async active(domainId) {
        const row = (
          await db.select().from(urlVerifications).where(eq(urlVerifications.activeKey, domainId))
        )[0]
        return row ? toVerification(row) : null
      },

      async list(domainId, { limit = 20 } = {}) {
        const rows = await db
          .select()
          .from(urlVerifications)
          .where(eq(urlVerifications.domainId, domainId))
          .orderBy(desc(urlVerifications.createdAt), desc(urlVerifications.id))
          .limit(limit)
        return rows.map(toVerification)
      },

      async markRunning(id) {
        const active = and(eq(urlVerifications.id, id), isNotNull(urlVerifications.activeKey))
        await db
          .update(urlVerifications)
          .set({ status: 'running', startedAt: new Date() })
          .where(and(active, isNull(urlVerifications.startedAt)))
        await db.update(urlVerifications).set({ status: 'running' }).where(active)
        const verification = await this.get(id)
        return verification && verification.status === 'running' ? verification : null
      },

      async queued(verificationId, limit) {
        const rows = await db
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
        return rows as NewVerificationUrl[]
      },

      async recordResult({ verificationId, urlHash, answer, auditVersion, outcome }) {
        return db.transaction(async (tx) => {
          // Locked: a cancellation, or the end of the recheck, waits for this write or precedes it.
          const active = (
            await tx
              .select({ id: urlVerifications.id })
              .from(urlVerifications)
              .where(
                and(eq(urlVerifications.id, verificationId), isNotNull(urlVerifications.activeKey)),
              )
              .for('update')
          )[0]
          if (!active) return false
          const written = await tx
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
            .returning({ urlHash: urlVerificationUrls.urlHash })
          if (written.length === 0) return false
          const done = (
            await tx
              .select({ count: sql<number>`count(*)` })
              .from(urlVerificationUrls)
              .where(
                and(
                  eq(urlVerificationUrls.verificationId, verificationId),
                  eq(urlVerificationUrls.state, 'done'),
                ),
              )
          )[0]
          await tx
            .update(urlVerifications)
            .set({ urlsDoneCount: Number(done?.count ?? 0) })
            .where(eq(urlVerifications.id, verificationId))
          return true
        })
      },

      async urlsOf(verificationId) {
        const rows = await db
          .select()
          .from(urlVerificationUrls)
          .where(eq(urlVerificationUrls.verificationId, verificationId))
          .orderBy(asc(urlVerificationUrls.url))
        return rows.map(toVerifiedUrl)
      },

      async finish(id, { status, error }) {
        const done = (
          await db
            .select({ count: sql<number>`count(*)` })
            .from(urlVerificationUrls)
            .where(
              and(
                eq(urlVerificationUrls.verificationId, id),
                eq(urlVerificationUrls.state, 'done'),
              ),
            )
        )[0]
        const result = await db
          .update(urlVerifications)
          .set({
            urlsDoneCount: Number(done?.count ?? 0),
            status,
            error: error === undefined ? null : truncateError(error),
            activeKey: null,
            finishedAt: new Date(),
          })
          .where(and(eq(urlVerifications.id, id), isNotNull(urlVerifications.activeKey)))
        return result.count > 0
      },

      async cancel(id) {
        const result = await db
          .update(urlVerifications)
          .set({ status: 'cancelled', activeKey: null, finishedAt: new Date() })
          .where(and(eq(urlVerifications.id, id), isNotNull(urlVerifications.activeKey)))
        return result.count > 0
      },

      async failOrphaned() {
        const orphans = await db
          .select({ id: urlVerifications.id, jobError: jobs.lastError })
          .from(urlVerifications)
          .innerJoin(jobs, eq(urlVerifications.jobId, jobs.id))
          .where(
            and(
              isNotNull(urlVerifications.activeKey),
              inArray(jobs.status, ['failed', 'completed']),
            ),
          )
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
          const rows = await db
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
          found.push(...rows.map(({ row }) => toVerifiedUrl(row)))
        }
        return newestVerifiedPerUrl(found)
      },

      async prune({ domainId, keep }) {
        const ended = await db
          .select({ id: urlVerifications.id })
          .from(urlVerifications)
          .where(and(eq(urlVerifications.domainId, domainId), isNull(urlVerifications.activeKey)))
          .orderBy(desc(urlVerifications.createdAt), desc(urlVerifications.id))
        const expired = expiredVerifications(ended, keep)
        if (expired.length === 0) return 0
        await db.transaction(async (tx) => {
          for (const batch of chunk(expired)) {
            await tx
              .delete(urlVerificationUrls)
              .where(inArray(urlVerificationUrls.verificationId, batch))
            await tx.delete(urlVerifications).where(inArray(urlVerifications.id, batch))
          }
        })
        return expired.length
      },
    },

    priorityUrls: {
      async list(domainId) {
        return await db
          .select()
          .from(priorityUrls)
          .where(eq(priorityUrls.domainId, domainId))
          .orderBy(asc(priorityUrls.createdAt), asc(priorityUrls.urlHash))
      },
      async add({ domainId, url }) {
        await db
          .insert(priorityUrls)
          .values(priorityUrlRow(domainId, url, new Date()))
          .onConflictDoNothing()
      },
      async remove({ domainId, urlHash }) {
        await db
          .delete(priorityUrls)
          .where(and(eq(priorityUrls.domainId, domainId), eq(priorityUrls.urlHash, urlHash)))
      },
    },

    crawlSchedules: {
      async list(domainId) {
        const rows = await db
          .select()
          .from(crawlSchedules)
          .where(eq(crawlSchedules.domainId, domainId))
        return rows.map(toCrawlSchedule)
      },
      async save({ domainId, type, ...values }) {
        const updatedAt = new Date()
        await db
          .insert(crawlSchedules)
          .values({ id: randomUUID(), domainId, type, ...values, updatedAt })
          .onConflictDoUpdate({
            target: [crawlSchedules.domainId, crawlSchedules.type],
            set: { ...values, updatedAt },
          })
      },
      async due({ now, limit }) {
        const rows = await db
          .select()
          .from(crawlSchedules)
          .where(and(eq(crawlSchedules.enabled, true), lte(crawlSchedules.nextRunAt, now)))
          .orderBy(asc(crawlSchedules.nextRunAt))
          .limit(limit)
        return rows.map(toCrawlSchedule)
      },
      async advance({ id, expectedNextRunAt, nextRunAt, now }) {
        const result = await db
          .update(crawlSchedules)
          .set({ nextRunAt, lastRunAt: now })
          .where(and(eq(crawlSchedules.id, id), eq(crawlSchedules.nextRunAt, expectedNextRunAt)))
        return result.count > 0
      },
      async recordOutcome({ id, outcome }) {
        await db
          .update(crawlSchedules)
          .set({ lastOutcome: outcome })
          .where(eq(crawlSchedules.id, id))
      },
    },

    crawlFiles: {
      async list(domainId, kinds) {
        const rows = await db
          .select()
          .from(crawlFiles)
          .where(
            and(
              eq(crawlFiles.domainId, domainId),
              kinds ? inArray(crawlFiles.kind, [...kinds]) : undefined,
            ),
          )
        return rows.map(toCrawlFile).sort(byUrl)
      },
      async save(domainId, files) {
        for (const file of files) {
          await db
            .insert(crawlFiles)
            .values(crawlFileRow(domainId, file))
            .onConflictDoUpdate({
              target: [crawlFiles.domainId, crawlFiles.urlHash],
              set: crawlFileColumns(file),
            })
        }
      },
      async prune({ domainId, before, keepKinds }) {
        const result = await db
          .delete(crawlFiles)
          .where(
            and(
              eq(crawlFiles.domainId, domainId),
              lt(crawlFiles.fetchedAt, before),
              keepKinds?.length ? notInArray(crawlFiles.kind, [...keepKinds]) : undefined,
            ),
          )
        return result.count
      },
      async getCheck(domainId) {
        const [row] = await db
          .select()
          .from(crawlFileChecks)
          .where(eq(crawlFileChecks.domainId, domainId))
        return row ? toCrawlFileCheck(row) : null
      },
      async requestCheck({ domainId, now }) {
        const values = { nextCheckAt: now, requestedAt: now }
        await db
          .insert(crawlFileChecks)
          .values({ domainId, ...values })
          .onConflictDoUpdate({ target: crawlFileChecks.domainId, set: values })
      },
      async dueChecks({ now, limit }) {
        return await db
          .select({ id: domains.id, host: domains.host })
          .from(domains)
          .leftJoin(crawlFileChecks, eq(crawlFileChecks.domainId, domains.id))
          .where(or(isNull(crawlFileChecks.domainId), lte(crawlFileChecks.nextCheckAt, now)))
          .orderBy(asc(domains.createdAt), asc(domains.id))
          .limit(limit)
      },
      async claimCheck({ domainId, now, retryAt }) {
        // A domain never checked has no row yet: its first check is due as of now.
        await db
          .insert(crawlFileChecks)
          .values({ domainId, nextCheckAt: now })
          .onConflictDoNothing()
        const result = await db
          .update(crawlFileChecks)
          .set({ nextCheckAt: retryAt })
          .where(and(eq(crawlFileChecks.domainId, domainId), lte(crawlFileChecks.nextCheckAt, now)))
        return result.count > 0
      },
      async finishCheck({ domainId, outcome, checkedAt, nextCheckAt }) {
        const values = { outcome, checkedAt, nextCheckAt, requestedAt: null }
        await db
          .insert(crawlFileChecks)
          .values({ domainId, ...values })
          .onConflictDoUpdate({ target: crawlFileChecks.domainId, set: values })
      },
      async deferCheck({ domainId, nextCheckAt }) {
        await db
          .update(crawlFileChecks)
          .set({ nextCheckAt, requestedAt: null })
          .where(eq(crawlFileChecks.domainId, domainId))
      },
    },

    favicons: {
      async get(domainId) {
        const [row] = await db
          .select()
          .from(domainFavicons)
          .where(eq(domainFavicons.domainId, domainId))
        return row ? toDomainFavicon(row) : null
      },
      async versions() {
        const rows = await db
          .select({ domainId: domainFavicons.domainId, hash: domainFavicons.hash })
          .from(domainFavicons)
          .where(isNotNull(domainFavicons.hash))
        return new Map(rows.flatMap((row) => (row.hash ? [[row.domainId, row.hash] as const] : [])))
      },
      async due({ now, limit }) {
        return await db
          .select({ id: domains.id, host: domains.host })
          .from(domains)
          .leftJoin(domainFavicons, eq(domainFavicons.domainId, domains.id))
          .where(or(isNull(domainFavicons.domainId), lte(domainFavicons.nextCheckAt, now)))
          .orderBy(asc(domains.createdAt), asc(domains.id))
          .limit(limit)
      },
      async save({ domainId, icon, nextCheckAt }) {
        const { domainId: _domainId, ...values } = faviconRow(domainId, icon, nextCheckAt)
        await db
          .insert(domainFavicons)
          .values({ domainId, ...values })
          .onConflictDoUpdate({ target: domainFavicons.domainId, set: values })
      },
      async defer({ domainId, nextCheckAt }) {
        await db
          .insert(domainFavicons)
          .values({ domainId, nextCheckAt })
          .onConflictDoUpdate({ target: domainFavicons.domainId, set: { nextCheckAt } })
      },
    },
  }
}
