import type { FindingStateRecord } from '../types'
import type { BotTestResult } from '../types'
import { detectIncidents, INCIDENT_STAGES } from '@seotools/core/incidents'
import { incidentAlertJobId, vitalsAlertJobId } from '../mapping'
import type { SiteIncident, NewCrawlFile } from '../types'
import { referenceGroup } from '@seotools/core/crawl/links'
import { CRAWL_LINK_KINDS } from '@seotools/core'
import { randomUUID } from 'node:crypto'
import {
  GOOGLE_VITALS_KEY,
  AUDIT_SEMANTICS,
  DEFAULT_CRAWL_SETTINGS,
  JOB_TYPES,
  nextScheduledRun,
  type CrawlLinkKind,
} from '@seotools/core'
import type { AlertKind } from '@seotools/core'
import {
  and,
  asc,
  countDistinct,
  desc,
  eq,
  exists,
  getTableColumns,
  gt,
  gte,
  inArray,
  max,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { DomainArchivedError } from '../archive'
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
  planFindingStates,
  planThresholds,
  thresholdColumns,
  thresholdsOf,
  type AuditStateRow,
} from '../audit'
import {
  CREDENTIAL_PROVIDER,
  accessRows,
  foldGrants,
  removesLastAdmin,
  toUserRecord,
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
  pgDiffers,
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
  foldUsage,
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
  crawlHistoryRow,
  groupAcceptedIssues,
  groupIssues,
  historyExpired,
  historyTrace,
  type LinkScope,
  foldIssueCounts,
  toLinkContext,
  foldPortfolio,
} from '../mapping'
import {
  alertColumns,
  alertJobId,
  vitalsJobId,
  vitalsJobValues,
  alertJobValues,
  knownAlertKinds,
  mailDeliveryRow,
  toAlertSubscription,
  toMailDelivery,
} from '../mapping'
import { assertKnownMigrations } from '../migration-guard'
import * as schema from '../schema/pg'
import type {
  CrawlLink,
  CrawlUrlRender,
  CrawlUrlAudit,
  CrawlUrlBrief,
  CrawlUrlAcceptedIssue,
  CrawlUrlIssue,
  UserTokenKind,
  Database,
  NewCrawlUrl,
  NewVerificationUrl,
  SitemapHreflang,
  VerifiedUrl,
  CrawlUrlTrace,
  DiscoveryStep,
  CrawlUrl,
  StructureUrl,
} from '../types'

const {
  jobs,
  mailDeliveries,
  alertSubscriptions,
  alertNotices,
  workerHeartbeats,
  settings,
  user,
  account,
  userAccess,
  userTokens,
  companies,
  domains,
  domainFavicons,
  crawlFileChecks,
  crawlFiles,
  crawlSettings,
  crawlVitals,
  crawlUrlVitals,
  crawlUrlRenders,
  crawlSchedules,
  crawls,
  crawlUrls,
  crawlUrlAcceptedIssues,
  crawlUrlIssues,
  crawlUrlAudit,
  crawlSitemapHreflang,
  crawlUrlHistory,
  crawlUrlLinks,
  priorityUrls,
  findingStates,
  auditRules,
  domainAuditConfig,
  botTestRuns,
  botTestResults,
  urlVerifications,
  urlVerificationUrls,
  siteIncidents,
  incidentNotices,
} = schema

/** `limit` when a list is not capped. */
const MAX_LIMIT = 2_147_483_647
/** Steps of a discovery path read at most: crawls are not deeper than this in practice. */
const MAX_DISCOVERY_STEPS = 200

const urlColumns = {
  state: crawlUrls.state,
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

  async function checkMigrations(dir = options.defaultMigrationsDir()) {
    const [table] = await client`select to_regclass('drizzle.__drizzle_migrations') as name`
    const rows = table?.name
      ? await client<
          { hash: string; created_at: string }[]
        >`select hash, created_at from drizzle.__drizzle_migrations`
      : []
    assertKnownMigrations(dir, rows)
  }

  /** Who can administer the instance right now, locked so that two changes cannot both pass. */
  const lockActiveAdmins = async (tx: Pick<typeof db, 'select'>) =>
    (
      await tx
        .select({ id: user.id })
        .from(user)
        .innerJoin(account, eq(account.userId, user.id))
        .where(
          and(
            eq(user.role, 'admin'),
            isNull(user.disabledAt),
            eq(account.providerId, CREDENTIAL_PROVIDER),
          ),
        )
        .for('update')
    ).map(({ id }) => id)

  /** The hashes of the URLs of a crawl that have an issue, and of those a filter on the audit keeps. */
  const subqueries = (crawlId: string) => ({
    withIssue: (issue: string) =>
      db
        .select({ urlHash: crawlUrlIssues.urlHash })
        .from(crawlUrlIssues)
        .where(and(eq(crawlUrlIssues.crawlId, crawlId), eq(crawlUrlIssues.issue, issue))),
    withAccepted: (issue: string | null, kind?: 'rule' | 'dismissal') =>
      db
        .select({ urlHash: crawlUrlAcceptedIssues.urlHash })
        .from(crawlUrlAcceptedIssues)
        .where(
          and(
            eq(crawlUrlAcceptedIssues.crawlId, crawlId),
            issue === null ? undefined : eq(crawlUrlAcceptedIssues.issue, issue),
            kind === 'dismissal'
              ? like(crawlUrlAcceptedIssues.details, '%"kind":"dismissal"%')
              : kind === 'rule'
                ? not(like(crawlUrlAcceptedIssues.details, '%"kind":"dismissal"%'))
                : undefined,
          ),
        ),
    withState: (state: string, issue?: string) => {
      if (state === 'dismissed')
        return db
          .select({ urlHash: crawlUrlAcceptedIssues.urlHash })
          .from(crawlUrlAcceptedIssues)
          .where(
            and(
              eq(crawlUrlAcceptedIssues.crawlId, crawlId),
              issue ? eq(crawlUrlAcceptedIssues.issue, issue) : undefined,
              like(crawlUrlAcceptedIssues.details, '%"kind":"dismissal"%'),
            ),
          )
      const specific = alias(findingStates, 'specific_finding_state')
      const progress = exists(
        db
          .select({ id: findingStates.id })
          .from(findingStates)
          .innerJoin(crawls, eq(crawls.domainId, findingStates.domainId))
          .where(
            and(
              eq(crawls.id, crawlId),
              eq(findingStates.issue, crawlUrlIssues.issue),
              eq(findingStates.state, 'in-progress'),
              or(
                eq(findingStates.urlHash, crawlUrlIssues.urlHash),
                and(
                  isNull(findingStates.urlHash),
                  notExists(
                    db
                      .select({ id: specific.id })
                      .from(specific)
                      .where(
                        and(
                          eq(specific.domainId, findingStates.domainId),
                          eq(specific.issue, findingStates.issue),
                          eq(specific.urlHash, crawlUrlIssues.urlHash),
                        ),
                      ),
                  ),
                ),
              ),
            ),
          ),
      )
      return db
        .select({ urlHash: crawlUrlIssues.urlHash })
        .from(crawlUrlIssues)
        .where(
          and(
            eq(crawlUrlIssues.crawlId, crawlId),
            issue ? eq(crawlUrlIssues.issue, issue) : undefined,
            state === 'in-progress' ? progress : not(progress),
          ),
        )
    },
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
    const rows = await db
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
    return rows.length === 2 && rows.every((row) => !row.pruned)
  }

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
    plan: (
      rows: AuditRuleRow[],
      context: PlanContext,
      config: AuditStateRow | undefined,
      states: FindingStateRecord[],
    ) => AuditPlan,
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
        const rows = await tx
          .select()
          .from(auditRules)
          .where(eq(auditRules.domainId, domainId))
          .orderBy(asc(auditRules.createdAt), asc(auditRules.id))
        const stateRows = await tx
          .select()
          .from(findingStates)
          .where(eq(findingStates.domainId, domainId))
        const decided = plan(
          rows,
          { now, newId: randomUUID, languages: languagesOf(config) },
          config,
          stateRows,
        )
        if (decided.ok && decided.states) {
          const kept = new Set(decided.states.map((r) => r.id))
          for (const row of stateRows)
            if (!kept.has(row.id))
              await tx.delete(findingStates).where(eq(findingStates.id, row.id))
          for (const row of decided.states) {
            const before = stateRows.find((r) => r.id === row.id)
            if (!before) await tx.insert(findingStates).values(row)
            else if (before !== row)
              await tx.update(findingStates).set(row).where(eq(findingStates.id, row.id))
          }
        }
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
              ...(decided.thresholds ? thresholdColumns(decided.thresholds) : {}),
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
    // What the rules mean now. Nothing recorded: they predate the setting, which is the first meaning.
    const from = Number(done?.value) || 1
    const withRules = await db
      .selectDistinct({ id: auditRules.domainId })
      .from(auditRules)
      .where(from < 2 ? undefined : inArray(auditRules.dimension, UPGRADED_DIMENSIONS))
    // From the first meaning every domain with a crawl moves too: its latest crawl is analysed again.
    const withCrawls =
      from < 2
        ? await db
            .selectDistinct({ id: crawls.domainId })
            .from(crawls)
            .where(
              and(
                eq(crawls.type, 'full'),
                inArray(crawls.status, ['completed', 'incomplete']),
                eq(crawls.pruned, false),
              ),
            )
        : []
    for (const domainId of new Set([...withRules, ...withCrawls].map((row) => row.id))) {
      await changeRules(domainId, (rows, context) => planUpgradeSemantics(rows, context, from))
    }
    const value = String(AUDIT_SEMANTICS)
    const updatedAt = new Date()
    await db
      .insert(settings)
      .values({ key: AUDIT_SEMANTICS_SETTING, value, encrypted: false, updatedAt })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
  }

  /** Refuses, inside the transaction that would create something, a domain that is archived. */
  /** The `ref` of a crawl, which its rows of links carry. `null`: no such crawl. */
  const refOf = async (crawlId: string) =>
    (await db.select({ ref: crawls.ref }).from(crawls).where(eq(crawls.id, crawlId)))[0]?.ref ??
    null

  /** Where the links of a URL of a crawl are (`ref` and `seq`), or `null` when it has none. */
  const linkScope = async (crawlId: string, urlHash: string): Promise<LinkScope | null> => {
    const [row] = await db
      .select({ ref: crawls.ref, seq: crawlUrls.seq })
      .from(crawlUrls)
      .innerJoin(crawls, eq(crawls.id, crawlUrls.crawlId))
      .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.urlHash, urlHash)))
    return row && row.ref !== null && row.seq !== null ? { ref: row.ref, seq: row.seq } : null
  }

  /** The `seq` of each of these URLs of a crawl that it has. */
  const seqsOf = async (tx: Pick<typeof db, 'select'>, crawlId: string, hashes: string[]) => {
    const seqs = new Map<string, number>()
    for (const batch of chunk([...new Set(hashes)])) {
      for (const row of await tx
        .select({ urlHash: crawlUrls.urlHash, seq: crawlUrls.seq })
        .from(crawlUrls)
        .where(and(eq(crawlUrls.crawlId, crawlId), inArray(crawlUrls.urlHash, batch)))) {
        if (row.seq !== null) seqs.set(row.urlHash, row.seq)
      }
    }
    return seqs
  }

  /** Writes the compact history of a crawl (`crawl_url_history`) from its results per URL. */
  const writeHistory = async (tx: Pick<typeof db, 'select' | 'insert'>, crawlId: string) => {
    let after = ''
    for (;;) {
      const urls = await tx
        .select({ urlHash: crawlUrls.urlHash, url: crawlUrls.url, ...snapshotOf(crawlUrls) })
        .from(crawlUrls)
        .where(
          and(
            eq(crawlUrls.crawlId, crawlId),
            eq(crawlUrls.scope, 'internal'),
            gt(crawlUrls.urlHash, after),
          ),
        )
        .orderBy(asc(crawlUrls.urlHash))
        .limit(HISTORY_BATCH)
      if (urls.length === 0) return
      after = urls[urls.length - 1]!.urlHash
      const hashes = urls.map((url) => url.urlHash)
      const issues = groupIssues(
        await tx
          .select({ urlHash: crawlUrlIssues.urlHash, issue: crawlUrlIssues.issue })
          .from(crawlUrlIssues)
          .where(and(eq(crawlUrlIssues.crawlId, crawlId), inArray(crawlUrlIssues.urlHash, hashes))),
      )
      const accepted = groupAcceptedIssues(
        await tx
          .select({
            urlHash: crawlUrlAcceptedIssues.urlHash,
            issue: crawlUrlAcceptedIssues.issue,
            details: crawlUrlAcceptedIssues.details,
          })
          .from(crawlUrlAcceptedIssues)
          .where(
            and(
              eq(crawlUrlAcceptedIssues.crawlId, crawlId),
              inArray(crawlUrlAcceptedIssues.urlHash, hashes),
            ),
          ),
      )
      const audits = new Map(
        (
          await tx
            .select()
            .from(crawlUrlAudit)
            .where(and(eq(crawlUrlAudit.crawlId, crawlId), inArray(crawlUrlAudit.urlHash, hashes)))
        ).map(({ crawlId: _crawl, ...row }) => [row.urlHash, row]),
      )
      await tx
        .insert(crawlUrlHistory)
        .values(
          urls.map((url) =>
            crawlHistoryRow(
              crawlId,
              url,
              issues.get(url.urlHash) ?? [],
              accepted.get(url.urlHash) ?? [],
              audits.get(url.urlHash) ?? null,
            ),
          ),
        )
        .onConflictDoNothing()
    }
  }

  const assertNotArchived = async (tx: Pick<typeof db, 'select'>, domainId: string) => {
    // Shared lock: archiving a domain waits for a start in flight, and a start sees it archived.
    const [row] = await tx
      .select({ archivedAt: domains.archivedAt })
      .from(domains)
      .where(eq(domains.id, domainId))
      .for('share')
    if (row?.archivedAt) throw new DomainArchivedError(domainId)
  }

  /**
   * Removes the jobs that work on these domains: their crawls' and rechecks'. The domain's rows
   * go by cascade, and a job that finds its crawl gone has nothing left to do; deleting the job
   * too means a running one is not retried, and a queued one never starts.
   */
  const recordFiles = async (
    tx: Pick<typeof db, 'select' | 'insert' | 'update'>,
    domainId: string,
    files: NewCrawlFile[],
    check?: { outcome: 'ok' | 'unreachable' | 'tls-error'; checkedAt: Date; nextCheckAt: Date },
  ) => {
    const [domain] = await tx.select().from(domains).where(eq(domains.id, domainId)).for('update')
    if (!domain || domain.archivedAt) return
    const previous = (await tx.select().from(crawlFiles).where(eq(crawlFiles.domainId, domainId)))
      .filter((row) => row.incidentObserved)
      .map(toCrawlFile)
    const [previousCheck] = await tx
      .select()
      .from(crawlFileChecks)
      .where(eq(crawlFileChecks.domainId, domainId))
    const active = (await tx
      .select()
      .from(siteIncidents)
      .where(
        and(eq(siteIncidents.domainId, domainId), isNull(siteIncidents.resolvedAt)),
      )) as SiteIncident[]
    const now = check?.checkedAt ?? files[files.length - 1]?.fetchedAt ?? new Date()
    if (
      check?.outcome === 'unreachable' &&
      files.some(
        (file) => file.error && /CERT_|TLS_|SSL_|SELF_SIGNED|UNABLE_TO_VERIFY/.test(file.error),
      )
    )
      check = { ...check, outcome: 'tls-error' }
    const changes = detectIncidents({
      origin: `https://${domain.host}/`,
      previous,
      files,
      previousCheck: previousCheck ? toCrawlFileCheck(previousCheck) : null,
      ...(check ? { check } : {}),
      active,
      now,
    })
    for (const file of check && check.outcome !== 'ok' ? [] : files) {
      await tx
        .insert(crawlFiles)
        .values({ ...crawlFileRow(domainId, file), incidentObserved: true })
        .onConflictDoUpdate({
          target: [crawlFiles.domainId, crawlFiles.urlHash],
          set: { ...crawlFileColumns(file), incidentObserved: true },
        })
    }
    if (check) {
      const values = { ...check, requestedAt: null }
      await tx
        .insert(crawlFileChecks)
        .values({ domainId, ...values })
        .onConflictDoUpdate({ target: crawlFileChecks.domainId, set: values })
    }
    const queue = async (id: string, stage: string, details: string) => {
      await tx
        .insert(jobs)
        .values({
          id: incidentAlertJobId(id, stage),
          type: 'incident.alerts',
          payload: JSON.stringify({
            incidentId: id,
            stage,
            observedAt: now.toISOString(),
            details,
          }),
          runAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
    }
    for (const incident of changes.open) {
      const id = randomUUID(),
        event = incident.stage === 'changed'
      await tx.insert(siteIncidents).values({
        ...incident,
        id,
        domainId,
        activeKey: event ? null : `${incident.kind} ${incident.subject}`,
        openedAt: now,
        lastSeenAt: now,
        resolvedAt: event ? now : null,
      })
      await queue(id, incident.stage, incident.details)
    }
    for (const incident of changes.escalate) {
      const old = active.find((i) => i.id === incident.id)!
      await tx
        .update(siteIncidents)
        .set({ stage: incident.stage, details: incident.details, lastSeenAt: now })
        .where(eq(siteIncidents.id, incident.id))
      if (old.stage !== incident.stage) await queue(incident.id, incident.stage, incident.details)
    }
    for (const incident of changes.resolve) {
      await tx
        .update(siteIncidents)
        .set({ activeKey: null, resolvedAt: now, lastSeenAt: now })
        .where(eq(siteIncidents.id, incident.id))
      await queue(incident.id, 'resolved', incident.details)
    }
  }

  const removeJobsOf = async (tx: Pick<typeof db, 'select' | 'delete'>, domainIds: string[]) => {
    if (domainIds.length === 0) return
    const ids = [
      ...(
        await tx
          .select({ id: crawls.jobId, crawlId: crawls.id })
          .from(crawls)
          .where(inArray(crawls.domainId, domainIds))
      ).flatMap((row) => [
        row.id,
        alertJobId(row.crawlId),
        vitalsJobId(row.crawlId),
        vitalsAlertJobId(row.crawlId),
      ]),
      ...(
        await tx
          .select({ id: urlVerifications.jobId })
          .from(urlVerifications)
          .where(inArray(urlVerifications.domainId, domainIds))
      ).map((row) => row.id),
    ]
    ids.push(
      ...(
        await tx
          .select({ id: botTestRuns.jobId })
          .from(botTestRuns)
          .where(inArray(botTestRuns.domainId, domainIds))
      ).map((row) => row.id),
    )
    const incidentIds = await tx
      .select({ id: siteIncidents.id })
      .from(siteIncidents)
      .where(inArray(siteIncidents.domainId, domainIds))
    ids.push(
      ...incidentIds.flatMap((row) =>
        INCIDENT_STAGES.map((stage) => incidentAlertJobId(row.id, stage)),
      ),
    )
    for (const batch of chunk(ids)) await tx.delete(jobs).where(inArray(jobs.id, batch))
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

    checkMigrations,
    async compact() {
      return null
    },

    async migrate(dir) {
      await checkMigrations(dir)
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

      async prune({ finishedBefore, failedBefore }) {
        // `updated_at` is when the job last changed: for a finished job, when it ended.
        const old = or(
          and(eq(jobs.status, 'completed'), lt(jobs.updatedAt, finishedBefore)),
          and(eq(jobs.status, 'failed'), lt(jobs.updatedAt, failedBefore)),
        )
        const notInUse = and(
          notInArray(
            jobs.id,
            db
              .select({ id: botTestRuns.jobId })
              .from(botTestRuns)
              .where(isNotNull(botTestRuns.activeKey)),
          ),
          notInArray(
            jobs.id,
            db.select({ id: crawls.jobId }).from(crawls).where(isNotNull(crawls.activeKey)),
          ),
          notInArray(
            jobs.id,
            db
              .select({ id: urlVerifications.jobId })
              .from(urlVerifications)
              .where(isNotNull(urlVerifications.activeKey)),
          ),
        )
        return (await db.delete(jobs).where(and(old, notInUse)).returning({ id: jobs.id })).length
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

    vitals: {
      async queueAlerts(crawlId) {
        await db
          .insert(jobs)
          .values({
            id: vitalsAlertJobId(crawlId),
            type: 'vitals.alerts',
            payload: JSON.stringify({ crawlId }),
            runAt: new Date(),
          })
          .onConflictDoNothing()
      },
      async latestCrawl(domainId, before) {
        const [row] = await db
          .select()
          .from(crawls)
          .where(
            and(
              eq(crawls.domainId, domainId),
              eq(crawls.type, 'full'),
              before ? lt(crawls.createdAt, before) : undefined,
              inArray(crawls.status, ['completed', 'incomplete']),
              exists(
                db
                  .select()
                  .from(crawlVitals)
                  .where(
                    and(
                      eq(crawlVitals.crawlId, crawls.id),
                      before ? eq(crawlVitals.status, 'collected') : undefined,
                    ),
                  ),
              ),
            ),
          )
          .orderBy(desc(crawls.createdAt), desc(crawls.id))
          .limit(1)
        return row ? toCrawl(row) : null
      },
      async origins(crawlId) {
        return db.select().from(crawlVitals).where(eq(crawlVitals.crawlId, crawlId))
      },
      async urls(crawlId) {
        return db.select().from(crawlUrlVitals).where(eq(crawlUrlVitals.crawlId, crawlId))
      },
      async saveOrigin(row) {
        await db
          .insert(crawlVitals)
          .values(row)
          .onConflictDoUpdate({ target: [crawlVitals.crawlId, crawlVitals.formFactor], set: row })
      },
      async saveUrl(row) {
        await db
          .insert(crawlUrlVitals)
          .values(row)
          .onConflictDoUpdate({
            target: [
              crawlUrlVitals.crawlId,
              crawlUrlVitals.formFactor,
              crawlUrlVitals.urlHash,
              crawlUrlVitals.source,
            ],
            set: row,
          })
      },
    },
    userPreferences: {
      async favouriteDomainId(userId) {
        const [row] = await db
          .select()
          .from(schema.userPreferences)
          .where(eq(schema.userPreferences.userId, userId))
        return row?.favouriteDomainId ?? null
      },
      async setFavouriteDomain(userId, domainId) {
        await db
          .insert(schema.userPreferences)
          .values({ userId, favouriteDomainId: domainId })
          .onConflictDoUpdate({
            target: schema.userPreferences.userId,
            set: { favouriteDomainId: domainId },
          })
      },
      async locale(userId) {
        const [row] = await db
          .select()
          .from(schema.userPreferences)
          .where(eq(schema.userPreferences.userId, userId))
        return row?.locale ?? null
      },
      async setLocale(userId, locale) {
        await db
          .insert(schema.userPreferences)
          .values({ userId, locale })
          .onConflictDoUpdate({ target: schema.userPreferences.userId, set: { locale } })
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
          await tx.insert(user).values({ id, email, name, role: 'admin', emailVerified: true })
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

    users: {
      async list() {
        const [rows, withPassword] = await Promise.all([
          db.select().from(user).orderBy(asc(user.name), asc(user.email)),
          db
            .select({ userId: account.userId })
            .from(account)
            .where(eq(account.providerId, CREDENTIAL_PROVIDER)),
        ])
        const known = new Set(withPassword.map(({ userId }) => userId))
        return rows.map((row) => toUserRecord(row, known.has(row.id)))
      },
      async get(id) {
        const [row] = await db.select().from(user).where(eq(user.id, id))
        if (!row) return null
        const [cred] = await db
          .select({ id: account.id })
          .from(account)
          .where(and(eq(account.userId, id), eq(account.providerId, CREDENTIAL_PROVIDER)))
        return toUserRecord(row, cred !== undefined)
      },
      async findByEmail(email) {
        const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
        return row ? this.get(row.id) : null
      },
      async create({ email, name, role }) {
        const id = randomUUID()
        await db.insert(user).values({ id, email, name, role, emailVerified: false })
        const created = await this.get(id)
        if (!created) throw new Error(`User ${id} not found after creating it`)
        return created
      },
      async setRole(id, role) {
        return db.transaction(async (tx) => {
          const admins = await lockActiveAdmins(tx)
          const [found] = await tx.select({ id: user.id }).from(user).where(eq(user.id, id))
          if (!found) return 'not-found'
          if (role !== 'admin' && removesLastAdmin(admins, id)) return 'last-admin'
          await tx.update(user).set({ role }).where(eq(user.id, id))
          return 'ok'
        })
      },
      async setDisabled(id, disabled) {
        return db.transaction(async (tx) => {
          const admins = await lockActiveAdmins(tx)
          const [found] = await tx.select({ id: user.id }).from(user).where(eq(user.id, id))
          if (!found) return 'not-found'
          if (disabled && removesLastAdmin(admins, id)) return 'last-admin'
          await tx
            .update(user)
            .set({ disabledAt: disabled ? new Date() : null })
            .where(eq(user.id, id))
          if (disabled) {
            await tx.delete(schema.session).where(eq(schema.session.userId, id))
            await tx.delete(userTokens).where(eq(userTokens.userId, id))
          }
          return 'ok'
        })
      },
      async grantsOf(userId) {
        const rows = await db.select().from(userAccess).where(eq(userAccess.userId, userId))
        return foldGrants(rows).get(userId) ?? []
      },
      async allGrants() {
        return foldGrants(await db.select().from(userAccess))
      },
      async setGrants(userId, grants) {
        return db.transaction(async (tx) => {
          const [found] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId))
          if (!found) return false
          for (const { companyId, domainId } of grants) {
            const [target] = companyId
              ? await tx
                  .select({ id: companies.id })
                  .from(companies)
                  .where(eq(companies.id, companyId))
              : await tx.select({ id: domains.id }).from(domains).where(eq(domains.id, domainId!))
            if (!target) return false
          }
          await tx.delete(userAccess).where(eq(userAccess.userId, userId))
          for (const batch of chunk(accessRows(userId, grants))) {
            await tx.insert(userAccess).values(batch)
          }
          return true
        })
      },
      async addToken(input) {
        await db.insert(userTokens).values(input)
      },
      async findToken(tokenHash, now) {
        const [row] = await db
          .select({ kind: userTokens.kind, userId: userTokens.userId })
          .from(userTokens)
          .innerJoin(user, eq(user.id, userTokens.userId))
          .where(
            and(
              eq(userTokens.tokenHash, tokenHash),
              gt(userTokens.expiresAt, now),
              isNull(user.disabledAt),
            ),
          )
        if (!row) return null
        const found = await this.get(row.userId)
        return found ? { kind: row.kind as UserTokenKind, user: found } : null
      },
      async redeemToken({ tokenHash, passwordHash, now }) {
        return db.transaction(async (tx) => {
          // Locked: of two uses of one link at once, the second finds it gone.
          const [token] = await tx
            .select({ userId: userTokens.userId })
            .from(userTokens)
            .innerJoin(user, eq(user.id, userTokens.userId))
            .where(
              and(
                eq(userTokens.tokenHash, tokenHash),
                gt(userTokens.expiresAt, now),
                isNull(user.disabledAt),
              ),
            )
            .for('update')
          if (!token) return false
          const { userId } = token
          const credential = and(
            eq(account.userId, userId),
            eq(account.providerId, CREDENTIAL_PROVIDER),
          )
          const [existing] = await tx.select({ id: account.id }).from(account).where(credential)
          if (existing) {
            await tx.update(account).set({ password: passwordHash }).where(credential)
          } else {
            await tx.insert(account).values({
              id: randomUUID(),
              accountId: userId,
              providerId: CREDENTIAL_PROVIDER,
              userId,
              password: passwordHash,
            })
          }
          await tx.update(user).set({ emailVerified: true }).where(eq(user.id, userId))
          await tx.delete(userTokens).where(eq(userTokens.userId, userId))
          await tx.delete(schema.session).where(eq(schema.session.userId, userId))
          return true
        })
      },
      async markResetRequested(id, at) {
        await db.update(user).set({ resetRequestedAt: at }).where(eq(user.id, id))
      },
    },

    mail: {
      async record(input) {
        await db.insert(mailDeliveries).values(mailDeliveryRow(input))
      },
      async recent({ limit, outcome }) {
        const rows = await db
          .select()
          .from(mailDeliveries)
          .where(
            outcome === 'sent'
              ? eq(mailDeliveries.status, 'sent')
              : outcome === 'problems'
                ? ne(mailDeliveries.status, 'sent')
                : undefined,
          )
          .orderBy(desc(mailDeliveries.createdAt))
          .limit(limit)
        return rows.map(toMailDelivery)
      },
      async prune({ before, keep }) {
        let removed = (
          await db
            .delete(mailDeliveries)
            .where(lt(mailDeliveries.createdAt, before))
            .returning({ id: mailDeliveries.id })
        ).length
        const edge = (
          await db
            .select({ createdAt: mailDeliveries.createdAt })
            .from(mailDeliveries)
            .orderBy(desc(mailDeliveries.createdAt))
            .limit(1)
            .offset(Math.max(1, keep) - 1)
        )[0]
        if (edge) {
          removed += (
            await db
              .delete(mailDeliveries)
              .where(lt(mailDeliveries.createdAt, edge.createdAt))
              .returning({ id: mailDeliveries.id })
          ).length
        }
        return removed
      },
    },

    alerts: {
      async forUser(userId) {
        const rows = await db
          .select()
          .from(alertSubscriptions)
          .where(eq(alertSubscriptions.userId, userId))
          .orderBy(asc(alertSubscriptions.domainId))
        return rows.map(toAlertSubscription)
      },
      async forDomain(domainId) {
        const rows = await db
          .select()
          .from(alertSubscriptions)
          .where(eq(alertSubscriptions.domainId, domainId))
          .orderBy(asc(alertSubscriptions.userId))
        return rows.map(toAlertSubscription)
      },
      async save({ userId, locale, domains: entries }) {
        await db.transaction(async (tx) => {
          for (const { domainId, kinds } of entries) {
            const known = knownAlertKinds(kinds)
            if (known.length === 0) {
              await tx
                .delete(alertSubscriptions)
                .where(
                  and(
                    eq(alertSubscriptions.userId, userId),
                    eq(alertSubscriptions.domainId, domainId),
                  ),
                )
              continue
            }
            const columns = alertColumns(known, locale)
            await tx
              .insert(alertSubscriptions)
              .values({ userId, domainId, ...columns })
              .onConflictDoUpdate({
                target: [alertSubscriptions.userId, alertSubscriptions.domainId],
                set: columns,
              })
          }
          await tx
            .update(alertSubscriptions)
            .set({ locale })
            .where(eq(alertSubscriptions.userId, userId))
        })
      },
      async claim({ crawlId, userId, kinds }) {
        const taken: AlertKind[] = []
        for (const kind of knownAlertKinds(kinds)) {
          const inserted = await db
            .insert(alertNotices)
            .values({ crawlId, userId, kind })
            .onConflictDoNothing()
            .returning({ kind: alertNotices.kind })
          if (inserted.length > 0) taken.push(kind)
        }
        return taken
      },
      async release({ crawlId, userId, kinds }) {
        await db
          .delete(alertNotices)
          .where(
            and(
              eq(alertNotices.crawlId, crawlId),
              eq(alertNotices.userId, userId),
              inArray(alertNotices.kind, knownAlertKinds(kinds)),
            ),
          )
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
      async create({ name, host, crawlSettings: initialSettings }) {
        const now = new Date()
        const company = { id: randomUUID(), name, createdAt: now }
        const domain = {
          id: randomUUID(),
          companyId: company.id,
          host,
          createdAt: now,
          archivedAt: null,
        }
        await db.transaction(async (tx) => {
          await tx.insert(companies).values(company)
          await tx.insert(domains).values(domain)
          await tx.insert(crawlSettings).values({
            domainId: domain.id,
            ...crawlSettingsColumns(initialSettings ?? DEFAULT_CRAWL_SETTINGS),
          })
        })
        return { company, domain }
      },
      async rename(id, name) {
        await db.update(companies).set({ name }).where(eq(companies.id, id))
        const [row] = await db.select().from(companies).where(eq(companies.id, id))
        return row ?? null
      },
      async delete(id) {
        return db.transaction(async (tx) => {
          const [company] = await tx.select().from(companies).where(eq(companies.id, id))
          if (!company) return false
          const ids = (
            await tx.select({ id: domains.id }).from(domains).where(eq(domains.companyId, id))
          ).map((row) => row.id)
          await removeJobsOf(tx, ids)
          await tx.delete(companies).where(eq(companies.id, id))
          return true
        })
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
      async add({ companyId, host, crawlSettings: initialSettings }) {
        const domain = {
          id: randomUUID(),
          companyId,
          host,
          createdAt: new Date(),
          archivedAt: null,
        }
        await db.transaction(async (tx) => {
          await tx.insert(domains).values(domain)
          await tx.insert(crawlSettings).values({
            domainId: domain.id,
            ...crawlSettingsColumns(initialSettings ?? DEFAULT_CRAWL_SETTINGS),
          })
        })
        return domain
      },
      async archive(id) {
        return db.transaction(async (tx) => {
          const [found] = await tx.select().from(domains).where(eq(domains.id, id))
          if (!found) return null
          const now = new Date()
          if (!found.archivedAt) {
            await tx.update(domains).set({ archivedAt: now }).where(eq(domains.id, id))
          }
          const activeBotRun = await tx
            .select({ id: botTestRuns.id })
            .from(botTestRuns)
            .where(and(eq(botTestRuns.domainId, id), isNotNull(botTestRuns.activeKey)))
          if (activeBotRun.length) {
            const previous = await tx
              .select({ id: botTestRuns.id, jobId: botTestRuns.jobId })
              .from(botTestRuns)
              .where(and(eq(botTestRuns.domainId, id), isNull(botTestRuns.activeKey)))
            if (previous.length) {
              await tx.delete(jobs).where(
                inArray(
                  jobs.id,
                  previous.map((row) => row.jobId),
                ),
              )
              await tx.delete(botTestRuns).where(
                inArray(
                  botTestRuns.id,
                  previous.map((row) => row.id),
                ),
              )
            }
          }
          await tx
            .update(botTestRuns)
            .set({ status: 'cancelled', activeKey: null, finishedAt: now })
            .where(and(eq(botTestRuns.domainId, id), isNotNull(botTestRuns.activeKey)))
          // The same statements as `crawls.cancel` and `verifications.cancel`: the jobs notice
          // at their next check that the crawl is no longer running, and stop requesting.
          const ended = { status: 'cancelled', activeKey: null, finishedAt: now } as const
          await tx
            .update(crawls)
            .set(ended)
            .where(and(eq(crawls.domainId, id), isNotNull(crawls.activeKey)))
          await tx
            .update(urlVerifications)
            .set(ended)
            .where(and(eq(urlVerifications.domainId, id), isNotNull(urlVerifications.activeKey)))
          const [archived] = await tx.select().from(domains).where(eq(domains.id, id))
          return archived ?? null
        })
      },
      async unarchive(id) {
        return db.transaction(async (tx) => {
          const [found] = await tx.select().from(domains).where(eq(domains.id, id))
          if (!found) return null
          const now = new Date()
          await tx.update(domains).set({ archivedAt: null }).where(eq(domains.id, id))
          const schedules = await tx
            .select()
            .from(crawlSchedules)
            .where(and(eq(crawlSchedules.domainId, id), eq(crawlSchedules.enabled, true)))
          for (const row of schedules) {
            await tx
              .update(crawlSchedules)
              .set({ nextRunAt: nextScheduledRun(toCrawlSchedule(row), now) })
              .where(eq(crawlSchedules.id, row.id))
          }
          const [active] = await tx.select().from(domains).where(eq(domains.id, id))
          return active ?? null
        })
      },
      async move({ id, companyId }) {
        return db.transaction(async (tx) => {
          const [company] = await tx.select().from(companies).where(eq(companies.id, companyId))
          if (!company) return null
          await tx.update(domains).set({ companyId }).where(eq(domains.id, id))
          const [moved] = await tx.select().from(domains).where(eq(domains.id, id))
          return moved ?? null
        })
      },
      async delete(id) {
        return db.transaction(async (tx) => {
          const [found] = await tx.select().from(domains).where(eq(domains.id, id))
          if (!found) return false
          await removeJobsOf(tx, [id])
          await tx.delete(domains).where(eq(domains.id, id))
          return true
        })
      },
      async usage() {
        return foldUsage(await db.select({ id: domains.id }).from(domains), {
          crawls: await db
            .select({ domainId: crawls.domainId, n: sql<number>`count(*)` })
            .from(crawls)
            .groupBy(crawls.domainId),
          urls: await db
            .select({ domainId: crawls.domainId, n: sql<number>`count(*)` })
            .from(crawlUrls)
            .innerJoin(crawls, eq(crawlUrls.crawlId, crawls.id))
            .groupBy(crawls.domainId),
          rules: await db
            .select({ domainId: auditRules.domainId, n: sql<number>`count(*)` })
            .from(auditRules)
            .groupBy(auditRules.domainId),
          rechecks: await db
            .select({ domainId: urlVerifications.domainId, n: sql<number>`count(*)` })
            .from(urlVerifications)
            .groupBy(urlVerifications.domainId),
          schedules: await db
            .select({ domainId: crawlSchedules.domainId, n: sql<number>`count(*)` })
            .from(crawlSchedules)
            .groupBy(crawlSchedules.domainId),
          priorityUrls: await db
            .select({ domainId: priorityUrls.domainId, n: sql<number>`count(*)` })
            .from(priorityUrls)
            .groupBy(priorityUrls.domainId),
          crawlFiles: await db
            .select({ domainId: crawlFiles.domainId, n: sql<number>`count(*)` })
            .from(crawlFiles)
            .groupBy(crawlFiles.domainId),
        })
      },
    },

    crawls: {
      async requestSecrets(domainId) {
        const row = (
          await db.select().from(crawlSettings).where(eq(crawlSettings.domainId, domainId))
        )[0]
        return row?.requestSecrets ?? null
      },
      async saveRequestSecrets(domainId, encrypted) {
        await this.saveSettings(domainId, await this.settings(domainId))
        await db
          .update(crawlSettings)
          .set({ requestSecrets: encrypted })
          .where(eq(crawlSettings.domainId, domainId))
      },
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

      async saveIgnoredParameters(domainId, patterns) {
        const values = { ignoredParameters: JSON.stringify(patterns), updatedAt: new Date() }
        await db
          .insert(crawlSettings)
          .values({ domainId, ...crawlSettingsColumns(DEFAULT_CRAWL_SETTINGS), ...values })
          .onConflictDoUpdate({ target: crawlSettings.domainId, set: values })
      },

      async saveSettings(domainId, input) {
        const values = crawlSettingsColumns(input)
        const updatedAt = new Date()
        await db
          .insert(crawlSettings)
          .values({ domainId, ...values, updatedAt })
          .onConflictDoUpdate({ target: crawlSettings.domainId, set: { ...values, updatedAt } })
      },

      async start({ domainId, type, trigger, seedUrls }) {
        const now = new Date()
        const id = randomUUID()
        const jobId = randomUUID()
        try {
          // Two crawls of different domains can take the same next number at once: the unique
          // `ref` refuses the second, which then takes the one after.
          for (let attempt = 1; ; attempt++) {
            try {
              await db.transaction(async (tx) => {
                await assertNotArchived(tx, domainId)
                const [snapshot] = await tx
                  .select()
                  .from(crawlSettings)
                  .where(eq(crawlSettings.domainId, domainId))
                await tx.insert(jobs).values(crawlJobValues(id, jobId, now))
                const [last] = await tx.select({ ref: max(crawls.ref) }).from(crawls)
                await tx.insert(crawls).values({
                  id,
                  domainId,
                  type,
                  trigger,
                  seedUrls: seedUrls ? JSON.stringify(seedUrls) : null,
                  ignoredParameters: snapshot?.ignoredParameters ?? null,
                  rendering: JSON.stringify({
                    mode: snapshot?.renderingMode === 'headless' ? 'rendered' : 'html',
                    waitMs: snapshot?.renderWaitMs ?? 5000,
                    omittedHosts: snapshot?.renderOmittedHosts
                      ? JSON.parse(snapshot.renderOmittedHosts)
                      : [],
                  }),
                  jobId,
                  activeKey: domainId,
                  ref: (last?.ref ?? 0) + 1,
                  createdAt: now,
                })
              })
              break
            } catch (error) {
              if (error instanceof DomainArchivedError || attempt >= 5) throw error
              if (await this.active(domainId)) throw error
            }
          }
        } catch (error) {
          if (error instanceof DomainArchivedError) throw error
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

      async getInDomain(domainId, id) {
        const row = (
          await db
            .select()
            .from(crawls)
            .where(and(eq(crawls.id, id), eq(crawls.domainId, domainId)))
        )[0]
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

      async portfolio({ recent = 8 } = {}) {
        const ranked = db
          .select({
            id: crawls.id,
            rank: sql<number>`row_number() over (partition by ${crawls.domainId} order by ${crawls.createdAt} desc)`.as(
              'rank',
            ),
          })
          .from(crawls)
          .where(
            and(
              eq(crawls.type, 'full'),
              inArray(crawls.status, ['completed', 'incomplete', 'failed', 'cancelled']),
            ),
          )
          .as('ranked')
        const { robots: _r, seedUrls: _s, auditSnapshot: _a, ...columns } = getTableColumns(crawls)
        const rows = await db
          .select(columns)
          .from(crawls)
          .where(
            inArray(
              crawls.id,
              db.select({ id: ranked.id }).from(ranked).where(lte(ranked.rank, recent)),
            ),
          )
          .orderBy(desc(crawls.createdAt))
        const active = await db
          .select({ domainId: crawls.domainId })
          .from(crawls)
          .where(isNotNull(crawls.activeKey))
        return foldPortfolio(
          rows.map((row) => ({ ...row, robots: null, seedUrls: null, auditSnapshot: null })),
          active,
        )
      },

      async listStructureUrls(crawlId, { after, limit }) {
        const rows = await db
          .select({
            urlHash: crawlUrls.urlHash,
            url: crawlUrls.url,
            kind: crawlUrls.kind,
            statusCode: crawlUrls.statusCode,
            state: crawlUrls.state,
          })
          .from(crawlUrls)
          .where(
            and(
              eq(crawlUrls.crawlId, crawlId),
              eq(crawlUrls.scope, 'internal'),
              after === null ? undefined : gt(crawlUrls.urlHash, after),
            ),
          )
          .orderBy(asc(crawlUrls.urlHash))
          .limit(limit)
        return rows as StructureUrl[]
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
        return db.transaction(async (tx) => {
          const crawl = (
            await tx
              .select({ type: crawls.type, domainId: crawls.domainId })
              .from(crawls)
              .where(eq(crawls.id, id))
          )[0]
          const result = await tx
            .update(crawls)
            .set({
              ...counts,
              status,
              error: error === undefined ? null : truncateError(error),
              activeKey: null,
              finishedAt: new Date(),
            })
            .where(and(eq(crawls.id, id), isNotNull(crawls.activeKey)))
          if (result.count === 0) return false
          // The one place a crawl ends: whoever asked to be told hears of a full crawl from here.
          if (crawl?.type === 'full') {
            await tx.insert(jobs).values(alertJobValues(id, new Date())).onConflictDoNothing()
            const [key] = await tx
              .select()
              .from(settings)
              .where(eq(settings.key, GOOGLE_VITALS_KEY))
            const [config] = await tx
              .select()
              .from(crawlSettings)
              .where(eq(crawlSettings.domainId, crawl.domainId))
            if (key && config?.collectVitals !== false)
              await tx.insert(jobs).values(vitalsJobValues(id, new Date())).onConflictDoNothing()
          }
          return true
        })
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
          .orderBy(desc(crawls.createdAt), desc(crawls.ref))
        let usable = 0
        const expired = candidates
          .filter((crawl) => {
            if (crawl.status !== 'completed' && crawl.status !== 'incomplete') return true
            usable++
            return keep !== null && usable > keep
          })
          .map((crawl) => crawl.id)
        if (expired.length === 0) return 0
        const usableIds = new Set(
          candidates
            .filter((crawl) => crawl.status === 'completed' || crawl.status === 'incomplete')
            .map((crawl) => crawl.id),
        )
        for (const crawlId of expired) {
          // What each URL of a usable full crawl was stays, compact, for the history of a URL.
          const keepHistory = type === 'full' && usableIds.has(crawlId)
          await db.transaction(async (tx) => {
            if (keepHistory) await writeHistory(tx, crawlId)
            const [crawl] = await tx
              .select({ ref: crawls.ref })
              .from(crawls)
              .where(eq(crawls.id, crawlId))
            if (crawl?.ref != null) {
              await tx.delete(crawlUrlLinks).where(eq(crawlUrlLinks.crawlRef, crawl.ref))
            }
            await tx.delete(crawlUrlIssues).where(eq(crawlUrlIssues.crawlId, crawlId))
            await tx
              .delete(crawlUrlAcceptedIssues)
              .where(eq(crawlUrlAcceptedIssues.crawlId, crawlId))
            await tx.delete(crawlUrlAudit).where(eq(crawlUrlAudit.crawlId, crawlId))
            await tx.delete(crawlSitemapHreflang).where(eq(crawlSitemapHreflang.crawlId, crawlId))
            await tx.delete(crawlUrlRenders).where(eq(crawlUrlRenders.crawlId, crawlId))
            await tx.delete(crawlUrlVitals).where(eq(crawlUrlVitals.crawlId, crawlId))
            await tx.delete(crawlUrls).where(eq(crawlUrls.crawlId, crawlId))
            await tx
              .update(crawls)
              .set({ pruned: true, history: keepHistory })
              .where(eq(crawls.id, crawlId))
          })
        }
        return expired.length
      },

      async expireHistory({ now, defaultDays }) {
        const rows = await db
          .select({
            id: crawls.id,
            finishedAt: crawls.finishedAt,
            createdAt: crawls.createdAt,
            saved: crawlSettings.domainId,
            days: crawlSettings.historyDays,
          })
          .from(crawls)
          .innerJoin(domains, eq(domains.id, crawls.domainId))
          .leftJoin(crawlSettings, eq(crawlSettings.domainId, crawls.domainId))
          // An archived domain keeps everything it had, history included.
          .where(and(eq(crawls.history, true), isNull(domains.archivedAt)))
        const expired = rows
          .filter((row) => historyExpired(row, now, defaultDays))
          .map((row) => row.id)
        for (const batch of chunk(expired)) {
          await db.transaction(async (tx) => {
            await tx.delete(crawlUrlHistory).where(inArray(crawlUrlHistory.crawlId, batch))
            await tx.update(crawls).set({ history: false }).where(inArray(crawls.id, batch))
          })
        }
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
            seq: crawlUrls.seq,
            foundFrom: crawlUrls.foundFrom,
            foundKind: crawlUrls.foundKind,
          })
          .from(crawlUrls)
          .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.state, 'queued')))
          .orderBy(asc(crawlUrls.depth))
          .limit(limit)
        return rows as NewCrawlUrl[]
      },

      async knownUrls(crawlId) {
        return await db
          .select({ urlHash: crawlUrls.urlHash, scope: crawlUrls.scope, seq: crawlUrls.seq })
          .from(crawlUrls)
          .where(eq(crawlUrls.crawlId, crawlId))
      },

      async renders(crawlId) {
        const rows = await db
          .select()
          .from(crawlUrlRenders)
          .where(eq(crawlUrlRenders.crawlId, crawlId))
        return rows.map((row) => ({
          ...row,
          data: JSON.parse(row.data) as CrawlUrlRender['data'],
        }))
      },
      async saveBrowserWait(crawlId, milliseconds) {
        await db.update(crawls).set({ browserWaitMs: milliseconds }).where(eq(crawls.id, crawlId))
      },

      async recordResult({ crawlId, urlHash, result, render, urls = [], links = [] }) {
        const columns = crawlResultColumns(result, new Date())
        await db.transaction(async (tx) => {
          for (const batch of chunk(urls)) {
            await tx
              .insert(crawlUrls)
              .values(batch.map((url) => newCrawlUrlRow(crawlId, url)))
              .onConflictDoNothing()
          }
          if (links.length > 0) {
            const [crawl] = await tx
              .select({ ref: crawls.ref })
              .from(crawls)
              .where(eq(crawls.id, crawlId))
            const seqs = await seqsOf(
              tx,
              crawlId,
              links.flatMap((link) => [link.sourceHash, link.targetHash]),
            )
            const rows = links.flatMap((link) => {
              const source = link.sourceSeq ?? seqs.get(link.sourceHash)
              const target = link.targetSeq ?? seqs.get(link.targetHash)
              return crawl?.ref == null || source === undefined || target === undefined
                ? []
                : [newCrawlLinkRow(crawl.ref, source, target, link)]
            })
            for (const batch of chunk(rows)) {
              await tx.insert(crawlUrlLinks).values(batch).onConflictDoNothing()
            }
          }
          if (render) {
            const values = { crawlId, ...render, data: JSON.stringify(render.data) }
            await tx
              .insert(crawlUrlRenders)
              .values(values)
              .onConflictDoUpdate({
                target: [crawlUrlRenders.crawlId, crawlUrlRenders.urlHash],
                set: values,
              })
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
            statusCode: crawlUrls.statusCode,
            count: sql<number>`count(*)`,
          })
          .from(crawlUrls)
          .where(eq(crawlUrls.crawlId, crawlId))
          .groupBy(crawlUrls.scope, crawlUrls.kind, crawlUrls.state, crawlUrls.statusCode)
        return foldCrawlCounts(rows)
      },

      async viewCounts(crawlId) {
        const rows = await db
          .select({
            scope: crawlUrls.scope,
            kind: crawlUrls.kind,
            state: crawlUrls.state,
            statusCode: crawlUrls.statusCode,
            count: sql<number>`count(*)`,
          })
          .from(crawlUrls)
          .where(eq(crawlUrls.crawlId, crawlId))
          .groupBy(crawlUrls.scope, crawlUrls.kind, crawlUrls.state, crawlUrls.statusCode)
        return foldViewCounts(rows)
      },

      async listUrls({ limit, offset, sort, direction, ...query }) {
        const crawl = (
          await db.select({ ref: crawls.ref }).from(crawls).where(eq(crawls.id, query.crawlId))
        )[0]
        const references = sql<number>`(select count(distinct ${crawlUrlLinks.source}) from ${crawlUrlLinks} where ${crawlUrlLinks.crawlRef} = ${crawl?.ref ?? -1} and ${crawlUrlLinks.target} = ${crawlUrls.seq})`
        const rows = await db
          .select()
          .from(crawlUrls)
          .where(crawlUrlWhere(urlColumns, query, subqueries(query.crawlId)))
          .orderBy(
            ...(sort === 'referencedBy'
              ? [
                  (direction === 'desc' ? desc : asc)(references),
                  ...crawlUrlOrder(urlColumns, 'url', 'asc'),
                ]
              : crawlUrlOrder(urlColumns, sort, direction)),
          )
          .limit(limit)
          .offset(offset)
        const seqs = rows.flatMap((row) => (row.seq === null ? [] : [row.seq]))
        if (!seqs.length || crawl?.ref == null) return rows.map(toCrawlUrl)
        const referenceKind = sql<string>`case when ${inArray(
          crawlUrlLinks.kind,
          CRAWL_LINK_KINDS.filter((kind) => referenceGroup(kind) === 'resource'),
        )} then 'resource' when ${inArray(crawlUrlLinks.kind, ['canonical', 'hreflang', 'sitemap'])} then ${crawlUrlLinks.kind} else 'link' end`
        const grouped = await db
          .select({
            target: crawlUrlLinks.target,
            kind: referenceKind,
            count: sql<number>`count(distinct ${crawlUrlLinks.source})`,
          })
          .from(crawlUrlLinks)
          .where(and(eq(crawlUrlLinks.crawlRef, crawl.ref), inArray(crawlUrlLinks.target, seqs)))
          .groupBy(crawlUrlLinks.target, sql`2`)
        const totals = await db
          .select({
            target: crawlUrlLinks.target,
            count: sql<number>`count(distinct ${crawlUrlLinks.source})`,
          })
          .from(crawlUrlLinks)
          .where(and(eq(crawlUrlLinks.crawlRef, crawl.ref), inArray(crawlUrlLinks.target, seqs)))
          .groupBy(crawlUrlLinks.target)
        return rows.map((row) => ({
          ...toCrawlUrl(row),
          referencedBy: {
            total: Number(totals.find((item) => item.target === row.seq)?.count ?? 0),
            kinds: Object.fromEntries(
              grouped
                .filter((item) => item.target === row.seq)
                .map((item) => [item.kind, Number(item.count)]),
            ),
          },
        }))
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

      async urlsOf(crawlId, urlHashes) {
        const found: CrawlUrl[] = []
        for (const batch of chunk([...new Set(urlHashes)])) {
          const rows = await db
            .select()
            .from(crawlUrls)
            .where(and(eq(crawlUrls.crawlId, crawlId), inArray(crawlUrls.urlHash, batch)))
          for (const row of rows) found.push(toCrawlUrl(row))
        }
        return found
      },

      async outlinksOf(crawlId, sourceHash, { after, limit }) {
        const ref = await refOf(crawlId)
        if (ref === null) return { links: [], next: null }
        const source = (
          await db
            .select({ seq: crawlUrls.seq })
            .from(crawlUrls)
            .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.urlHash, sourceHash)))
        )[0]
        if (!source || source.seq === null) return { links: [], next: null }
        const rows = await db
          .select({
            target: crawlUrlLinks.target,
            url: crawlUrls.url,
            urlHash: crawlUrls.urlHash,
            kind: crawlUrlLinks.kind,
            scope: crawlUrls.scope,
            urlKind: crawlUrls.kind,
            state: crawlUrls.state,
            statusCode: crawlUrls.statusCode,
            error: crawlUrls.error,
            text: crawlUrlLinks.text,
            element: crawlUrlLinks.element,
            region: crawlUrlLinks.region,
            snippet: crawlUrlLinks.snippet,
          })
          .from(crawlUrlLinks)
          .innerJoin(
            crawlUrls,
            and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.seq, crawlUrlLinks.target)),
          )
          .where(
            and(
              eq(crawlUrlLinks.crawlRef, ref),
              eq(crawlUrlLinks.source, source.seq),
              after
                ? or(
                    gt(crawlUrlLinks.target, after.target),
                    and(eq(crawlUrlLinks.target, after.target), gt(crawlUrlLinks.kind, after.kind)),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(crawlUrlLinks.target), asc(crawlUrlLinks.kind))
          .limit(limit)
        const last = rows.at(-1)
        return {
          links: rows.map(({ target: _target, ...row }) => ({
            sourceHash,
            ...toCrawlLinkRow(row),
          })),
          next: last && rows.length === limit ? { target: last.target, kind: last.kind } : null,
        }
      },

      async queryUrls(crawlId, { after, limit }) {
        const rows = await db
          .select({ url: crawlUrls.url, canonical: crawlUrls.canonical, seq: crawlUrls.seq })
          .from(crawlUrls)
          .where(
            and(
              eq(crawlUrls.crawlId, crawlId),
              isNotNull(crawlUrls.seq),
              after === null ? undefined : gt(crawlUrls.seq, after),
              eq(crawlUrls.scope, 'internal'),
              like(crawlUrls.url, '%?%'),
            ),
          )
          .orderBy(asc(crawlUrls.seq))
          .limit(limit)
        const last = rows.at(-1)
        return {
          urls: rows.map((row) => row.url),
          observations: rows.map(({ url, canonical }) => ({ url, canonical })),
          next: last && last.seq !== null && rows.length === limit ? last.seq : null,
        }
      },

      async parameterEntries(crawlId, { limit, offset }) {
        const ref = await refOf(crawlId)
        if (ref === null) return { entries: [], total: 0 }
        const sources = alias(crawlUrls, 'entry_sources')
        const where = and(eq(crawlUrlLinks.crawlRef, ref), isNotNull(crawlUrlLinks.snippet))
        const rows = await db
          .select({
            sourceUrl: sources.url,
            sourceHash: sources.urlHash,
            url: crawlUrls.url,
            urlHash: crawlUrls.urlHash,
            kind: crawlUrlLinks.kind,
            text: crawlUrlLinks.text,
            element: crawlUrlLinks.element,
            region: crawlUrlLinks.region,
            snippet: crawlUrlLinks.snippet,
          })
          .from(crawlUrlLinks)
          .innerJoin(
            sources,
            and(eq(sources.crawlId, crawlId), eq(sources.seq, crawlUrlLinks.source)),
          )
          .innerJoin(
            crawlUrls,
            and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.seq, crawlUrlLinks.target)),
          )
          .where(where)
          .orderBy(
            asc(crawlUrls.url),
            asc(crawlUrls.urlHash),
            asc(sources.url),
            asc(sources.urlHash),
            asc(crawlUrlLinks.kind),
          )
          .limit(limit)
          .offset(offset)
        const counted = (
          await db
            .select({ count: sql<number>`count(*)` })
            .from(crawlUrlLinks)
            .where(where)
        )[0]
        return {
          entries: rows.map(({ text, element, region, snippet, ...row }) => ({
            ...row,
            kind: row.kind as CrawlLinkKind,
            context: toLinkContext({ text, element, region, snippet }),
          })),
          total: Number(counted?.count ?? 0),
        }
      },

      async discoveryPath(crawlId, urlHash) {
        const steps: DiscoveryStep[] = []
        const ref = await refOf(crawlId)
        const columns = {
          url: crawlUrls.url,
          urlHash: crawlUrls.urlHash,
          seq: crawlUrls.seq,
          foundFrom: crawlUrls.foundFrom,
          foundKind: crawlUrls.foundKind,
        }
        let row = (
          await db
            .select(columns)
            .from(crawlUrls)
            .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.urlHash, urlHash)))
        )[0]
        const seen = new Set<string>()
        while (row && !seen.has(row.urlHash) && steps.length < MAX_DISCOVERY_STEPS) {
          seen.add(row.urlHash)
          const from = row.foundFrom
          const link =
            from === null || ref === null || row.seq === null
              ? undefined
              : (
                  await db
                    .select({
                      text: crawlUrlLinks.text,
                      element: crawlUrlLinks.element,
                      region: crawlUrlLinks.region,
                      snippet: crawlUrlLinks.snippet,
                    })
                    .from(crawlUrlLinks)
                    .where(
                      and(
                        eq(crawlUrlLinks.crawlRef, ref),
                        eq(crawlUrlLinks.source, from),
                        eq(crawlUrlLinks.target, row.seq),
                        ...(row.foundKind ? [eq(crawlUrlLinks.kind, row.foundKind)] : []),
                      ),
                    )
                    .limit(1)
                )[0]
          steps.unshift({
            url: row.url,
            urlHash: row.urlHash,
            foundKind: from === null ? null : (row.foundKind as CrawlLinkKind | null),
            context: link ? toLinkContext(link) : null,
          })
          if (from === null) break
          row = (
            await db
              .select(columns)
              .from(crawlUrls)
              .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.seq, from)))
          )[0]
        }
        return steps
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
        const scope = await linkScope(crawlId, targetHash)
        if (!scope) return []
        const rows = await db
          .select({ url: crawlUrls.url, kind: crawlUrlLinks.kind })
          .from(crawlUrlLinks)
          .innerJoin(crawlUrls, crawlLinkJoin(crawlUrlLinks, crawlUrls, 'in', crawlId))
          .where(crawlLinkWhere(crawlUrlLinks, crawlUrls.url, { direction: 'in' }, scope))
          .orderBy(asc(crawlUrls.url), asc(crawlUrlLinks.kind))
          .limit(limit)
        return rows as { url: string; kind: CrawlLinkKind }[]
      },

      async linkTargets(crawlId, sourceHash, { limit = MAX_LIMIT } = {}) {
        const scope = await linkScope(crawlId, sourceHash)
        if (!scope) return []
        const rows = await db
          .select({ url: crawlUrls.url, kind: crawlUrlLinks.kind })
          .from(crawlUrlLinks)
          .innerJoin(crawlUrls, crawlLinkJoin(crawlUrlLinks, crawlUrls, 'out', crawlId))
          .where(crawlLinkWhere(crawlUrlLinks, crawlUrls.url, { direction: 'out' }, scope))
          .orderBy(asc(crawlUrls.url), asc(crawlUrlLinks.kind))
          .limit(limit)
        return rows as { url: string; kind: CrawlLinkKind }[]
      },

      async listLinks({ limit, offset, crawlId, urlHash, ...query }) {
        if (query.kinds?.length === 0) return []
        const scope = await linkScope(crawlId, urlHash)
        if (!scope) return []
        const rows = await db
          .select({
            url: crawlUrls.url,
            urlHash: crawlUrls.urlHash,
            kind: crawlUrlLinks.kind,
            scope: crawlUrls.scope,
            urlKind: crawlUrls.kind,
            state: crawlUrls.state,
            statusCode: crawlUrls.statusCode,
            error: crawlUrls.error,
            text: crawlUrlLinks.text,
            element: crawlUrlLinks.element,
            region: crawlUrlLinks.region,
            snippet: crawlUrlLinks.snippet,
          })
          .from(crawlUrlLinks)
          .innerJoin(crawlUrls, crawlLinkJoin(crawlUrlLinks, crawlUrls, query.direction, crawlId))
          .where(crawlLinkWhere(crawlUrlLinks, crawlUrls.url, query, scope))
          .orderBy(...crawlLinkOrder(crawlUrls.url, crawlUrls.urlHash, crawlUrlLinks.kind))
          .limit(limit)
          .offset(offset)
        return rows.map(toCrawlLinkRow)
      },

      async countLinks({ crawlId, urlHash, ...query }) {
        if (query.kinds?.length === 0) return 0
        const scope = await linkScope(crawlId, urlHash)
        if (!scope) return 0
        const [row] = await db
          .select({ count: sql<number>`count(*)` })
          .from(crawlUrlLinks)
          .innerJoin(crawlUrls, crawlLinkJoin(crawlUrlLinks, crawlUrls, query.direction, crawlId))
          .where(crawlLinkWhere(crawlUrlLinks, crawlUrls.url, query, scope))
        return Number(row?.count ?? 0)
      },

      async linkKindCounts(crawlId, urlHash, direction) {
        const scope = await linkScope(crawlId, urlHash)
        if (!scope) return []
        const rows = await db
          .select({ kind: crawlUrlLinks.kind, count: sql<number>`count(*)` })
          .from(crawlUrlLinks)
          .innerJoin(crawlUrls, crawlLinkJoin(crawlUrlLinks, crawlUrls, direction, crawlId))
          .where(crawlLinkWhere(crawlUrlLinks, crawlUrls.url, { direction }, scope))
          .groupBy(crawlUrlLinks.kind)
        return rows.map((row) => ({ kind: row.kind as CrawlLinkKind, count: Number(row.count) }))
      },

      async linksFrom(crawlId, sourceHashes) {
        const ref = await refOf(crawlId)
        if (ref === null) return []
        const sources = alias(crawlUrls, 'sources')
        const targets = alias(crawlUrls, 'targets')
        const found: CrawlLink[] = []
        for (const batch of chunk(sourceHashes)) {
          const rows = await db
            .select({
              sourceHash: sources.urlHash,
              targetHash: targets.urlHash,
              kind: crawlUrlLinks.kind,
              rendered: crawlUrlLinks.rendered,
            })
            .from(crawlUrlLinks)
            .innerJoin(
              sources,
              and(eq(sources.crawlId, crawlId), eq(sources.seq, crawlUrlLinks.source)),
            )
            .innerJoin(
              targets,
              and(eq(targets.crawlId, crawlId), eq(targets.seq, crawlUrlLinks.target)),
            )
            .where(and(eq(crawlUrlLinks.crawlRef, ref), inArray(sources.urlHash, batch)))
          for (const { rendered, ...row } of rows as CrawlLink[])
            found.push({ ...row, ...(rendered ? { rendered } : {}) })
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
        const ref = (await refOf(crawlId)) ?? -1
        const rows = await db
          .select({
            url: crawlUrls.url,
            urlHash: crawlUrls.urlHash,
            scope: crawlUrls.scope,
            source: crawlUrls.source,
            depth: crawlUrls.depth,
            seq: crawlUrls.seq,
          })
          .from(crawlUrls)
          .where(
            and(
              eq(crawlUrls.crawlId, crawlId),
              eq(crawlUrls.scope, 'external'),
              eq(crawlUrls.state, 'skipped'),
              inArray(
                crawlUrls.seq,
                db
                  .select({ seq: crawlUrlLinks.target })
                  .from(crawlUrlLinks)
                  .where(
                    and(
                      eq(crawlUrlLinks.crawlRef, ref),
                      inArray(crawlUrlLinks.kind, ['anchor', 'anchor-nofollow']),
                    ),
                  ),
              ),
            ),
          )
          .orderBy(asc(crawlUrls.urlHash))
          .limit(limit)
        return rows as NewCrawlUrl[]
      },

      async saveAnalysis({ crawlId, issues, accepted = [], pages, withType, catalog, audit }) {
        const issueRows = crawlIssueRows(crawlId, issues)
        const acceptedRows = crawlAcceptedRows(crawlId, accepted)
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
          await tx.delete(crawlUrlAcceptedIssues).where(eq(crawlUrlAcceptedIssues.crawlId, crawlId))
          for (const batch of chunk(acceptedRows)) {
            await tx.insert(crawlUrlAcceptedIssues).values(batch)
          }
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
          .select({
            issue: crawlUrlIssues.issue,
            indexability: crawlUrlAudit.indexability,
            pages: sql<number>`count(*)`,
          })
          .from(crawlUrlIssues)
          .leftJoin(
            crawlUrlAudit,
            and(
              eq(crawlUrlAudit.crawlId, crawlUrlIssues.crawlId),
              eq(crawlUrlAudit.urlHash, crawlUrlIssues.urlHash),
            ),
          )
          .where(eq(crawlUrlIssues.crawlId, crawlId))
          .groupBy(crawlUrlIssues.issue, crawlUrlAudit.indexability)
        return foldIssueCounts(rows)
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
          for (const row of rows) found.push(toCrawlUrlIssue(row))
        }
        return found
      },

      async acceptedCounts(crawlId, kind) {
        const rows = await db
          .select({
            issue: crawlUrlAcceptedIssues.issue,
            pages: countDistinct(crawlUrlAcceptedIssues.urlHash),
          })
          .from(crawlUrlAcceptedIssues)
          .where(
            and(
              eq(crawlUrlAcceptedIssues.crawlId, crawlId),
              kind === 'dismissal'
                ? like(crawlUrlAcceptedIssues.details, '%"kind":"dismissal"%')
                : kind === 'rule'
                  ? not(like(crawlUrlAcceptedIssues.details, '%"kind":"dismissal"%'))
                  : undefined,
            ),
          )
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
          const rows = await db
            .select()
            .from(crawlUrlAudit)
            .where(and(eq(crawlUrlAudit.crawlId, crawlId), inArray(crawlUrlAudit.urlHash, batch)))
          for (const row of rows) found.push(toCrawlUrlAudit(row))
        }
        return found
      },

      async auditRuleCounts(crawlId) {
        const count = sql<number>`count(*)`
        const byDimension = await Promise.all(
          [
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

      async compareCounts({ domainId, baseId, targetId, view }) {
        if (!(await comparablePair(domainId, baseId, targetId))) return null
        const differences = findingDifferences(baseId, targetId)
        const count = sql<number>`count(*)`
        const join = (otherId: string) =>
          and(eq(otherUrls.crawlId, otherId), eq(otherUrls.urlHash, crawlUrls.urlHash))
        const only = async (mainId: string, otherId: string) =>
          (
            await db
              .select({ count })
              .from(crawlUrls)
              .leftJoin(otherUrls, join(otherId))
              .where(
                and(
                  eq(crawlUrls.crawlId, mainId),
                  eq(crawlUrls.scope, 'internal'),
                  compareViewOf(crawlUrls, view),
                  isNull(otherUrls.urlHash),
                ),
              )
          )[0]
        const inBoth = and(
          eq(crawlUrls.crawlId, targetId),
          eq(crawlUrls.scope, 'internal'),
          eq(otherUrls.scope, 'internal'),
        )
        const sides = { target: crawlUrls, base: otherUrls }
        const changed = (change: Parameters<typeof changeCondition>[0]) =>
          sql<number>`sum(case when ${changeCondition(change, sides, pgDiffers, differences)} then 1 else 0 end)`
        const [added, missing, unrequested, compared] = await Promise.all([
          only(targetId, baseId),
          only(baseId, targetId),
          (
            await db
              .select({ count })
              .from(crawlUrls)
              .innerJoin(otherUrls, join(baseId))
              .where(and(inBoth, or(ne(crawlUrls.state, 'done'), ne(otherUrls.state, 'done'))))
          )[0],
          (
            await db
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
                  compareViewEither(crawlUrls, otherUrls, view),
                ),
              )
          )[0],
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
        const rows = await db
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
              pgDiffers,
              findingDifferences(query.baseId, query.targetId),
            ),
          )
          .orderBy(asc(crawlUrls.url), asc(crawlUrls.urlHash))
          .limit(limit)
          .offset(offset)
        return rows.map((row) => toUrlComparison(query.change, row))
      },

      async countCompared(query) {
        if (!(await comparablePair(query.domainId, query.baseId, query.targetId))) return 0
        const plan = comparePlan(query)
        const row = (
          await db
            .select({ count: sql<number>`count(*)` })
            .from(crawlUrls)
            .leftJoin(
              otherUrls,
              and(
                eq(otherUrls.crawlId, plan.otherCrawlId),
                eq(otherUrls.urlHash, crawlUrls.urlHash),
              ),
            )
            .where(
              compareWhere(
                query,
                crawlUrls,
                otherUrls,
                pgDiffers,
                findingDifferences(query.baseId, query.targetId),
              ),
            )
        )[0]
        return sumOf(row?.count)
      },

      async urlHistory({ domainId, crawlIds, urlHashes }) {
        if (crawlIds.length === 0 || urlHashes.length === 0) return []
        const owned: string[] = []
        const compact: string[] = []
        for (const batch of chunk(crawlIds, HISTORY_BATCH)) {
          const rows = await db
            .select({ id: crawls.id, pruned: crawls.pruned })
            .from(crawls)
            .where(
              and(
                eq(crawls.domainId, domainId),
                eq(crawls.type, 'full'),
                or(eq(crawls.pruned, false), eq(crawls.history, true)),
                inArray(crawls.id, batch),
              ),
            )
          for (const row of rows) (row.pruned ? compact : owned).push(row.id)
        }
        const kept: CrawlUrlTrace[] = []
        for (const ids of chunk(compact, HISTORY_BATCH)) {
          for (const hashes of chunk(urlHashes, HISTORY_BATCH)) {
            for (const row of await db
              .select()
              .from(crawlUrlHistory)
              .where(
                and(
                  inArray(crawlUrlHistory.crawlId, ids),
                  inArray(crawlUrlHistory.urlHash, hashes),
                ),
              )) {
              const trace = historyTrace(row)
              if (trace) kept.push(trace)
            }
          }
        }
        const urls: Parameters<typeof foldTraces>[0] = []
        const issues: Parameters<typeof foldTraces>[1] = []
        const audits: Parameters<typeof foldTraces>[2] = []
        const accepted: NonNullable<Parameters<typeof foldTraces>[3]> = []
        for (const ids of chunk(owned, HISTORY_BATCH)) {
          for (const hashes of chunk(urlHashes, HISTORY_BATCH)) {
            urls.push(
              ...(await db
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
                )),
            )
            issues.push(
              ...(
                await db
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
              ).map((row) => ({ crawlId: row.crawlId, ...toCrawlUrlIssue(row) })),
            )
            accepted.push(
              ...(await db
                .select({
                  crawlId: crawlUrlAcceptedIssues.crawlId,
                  urlHash: crawlUrlAcceptedIssues.urlHash,
                  issue: crawlUrlAcceptedIssues.issue,
                  details: crawlUrlAcceptedIssues.details,
                })
                .from(crawlUrlAcceptedIssues)
                .where(
                  and(
                    inArray(crawlUrlAcceptedIssues.crawlId, ids),
                    inArray(crawlUrlAcceptedIssues.urlHash, hashes),
                  ),
                )),
            )
            audits.push(
              ...(
                await db
                  .select()
                  .from(crawlUrlAudit)
                  .where(
                    and(
                      inArray(crawlUrlAudit.crawlId, ids),
                      inArray(crawlUrlAudit.urlHash, hashes),
                    ),
                  )
              ).map((row) => ({ crawlId: row.crawlId, ...toCrawlUrlAudit(row) })),
            )
          }
        }
        return [...foldTraces(urls, issues, audits, accepted), ...kept]
      },
    },

    audit: {
      async setFindingStates(input) {
        return changeRules(input.domainId, (_rules, context, _config, states) =>
          planFindingStates(states, input, context),
        )
      },
      async config(domainId) {
        return readAuditConfig({
          states: async () =>
            db.select().from(findingStates).where(eq(findingStates.domainId, domainId)),
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

      async setThresholds({ domainId, thresholds }) {
        return changeRules(domainId, (_rows, _context, config) =>
          planThresholds(thresholds, thresholdsOf(config)),
        )
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

    botTests: {
      async start({ domainId, requestedBy }) {
        const id = randomUUID(),
          jobId = randomUUID(),
          now = new Date()
        try {
          await db.transaction(async (tx) => {
            await assertNotArchived(tx, domainId)
            await tx.insert(jobs).values({
              id: jobId,
              type: JOB_TYPES.botTest,
              payload: JSON.stringify({ runId: id }),
              runAt: now,
              createdAt: now,
              updatedAt: now,
            })
            await tx
              .insert(botTestRuns)
              .values({ id, jobId, domainId, requestedBy, activeKey: domainId, createdAt: now })
          })
        } catch (error) {
          if (error instanceof DomainArchivedError) throw error
          if (await this.active(domainId)) return null
          throw error
        }
        return this.get(id)
      },
      async get(id) {
        return (await db.select().from(botTestRuns).where(eq(botTestRuns.id, id)))[0] ?? null
      },
      async active(domainId) {
        return (
          (await db.select().from(botTestRuns).where(eq(botTestRuns.activeKey, domainId)))[0] ??
          null
        )
      },
      async list(domainId) {
        return await db
          .select()
          .from(botTestRuns)
          .where(eq(botTestRuns.domainId, domainId))
          .orderBy(desc(botTestRuns.createdAt), desc(botTestRuns.id))
      },
      async markRunning(id) {
        await db
          .update(botTestRuns)
          .set({ status: 'running', startedAt: new Date() })
          .where(
            and(
              eq(botTestRuns.id, id),
              isNotNull(botTestRuns.activeKey),
              isNull(botTestRuns.startedAt),
            ),
          )
      },
      async results(id) {
        const found = await db.select().from(botTestResults).where(eq(botTestResults.runId, id))
        return found.map((row) => ({
          ...row,
          reasons: JSON.parse(row.reasons) as BotTestResult['reasons'],
        }))
      },
      async record(input) {
        await db.transaction(async (tx) => {
          const active = (
            await tx
              .select()
              .from(botTestRuns)
              .where(and(eq(botTestRuns.id, input.runId), isNotNull(botTestRuns.activeKey)))
              .for('update')
          )[0]
          if (!active) return
          await tx
            .insert(botTestResults)
            .values({ ...input, reasons: JSON.stringify(input.reasons) })
            .onConflictDoNothing()
        })
      },
      async finish(id, status) {
        await db.transaction(async (tx) => {
          const current = (
            await tx
              .select()
              .from(botTestRuns)
              .where(and(eq(botTestRuns.id, id), isNotNull(botTestRuns.activeKey)))
              .for('update')
          )[0]
          if (!current) return
          await tx
            .update(botTestRuns)
            .set({ status, activeKey: null, finishedAt: new Date() })
            .where(eq(botTestRuns.id, id))
          const ended = await tx
            .select({ id: botTestRuns.id })
            .from(botTestRuns)
            .where(
              and(
                eq(botTestRuns.domainId, current.domainId),
                isNull(botTestRuns.activeKey),
                ne(botTestRuns.id, id),
              ),
            )
            .orderBy(desc(botTestRuns.finishedAt), desc(botTestRuns.id))
          const old = ended.map((row) => row.id)
          if (old.length) {
            const removed = await tx
              .select({ jobId: botTestRuns.jobId })
              .from(botTestRuns)
              .where(inArray(botTestRuns.id, old))
            await tx.delete(jobs).where(
              inArray(
                jobs.id,
                removed.map((row) => row.jobId),
              ),
            )
            await tx.delete(botTestRuns).where(inArray(botTestRuns.id, old))
          }
        })
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
            await assertNotArchived(tx, domainId)
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
          if (error instanceof DomainArchivedError) throw error
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
          for (const { row } of rows) found.push(toVerifiedUrl(row))
        }
        return newestVerifiedPerUrl(found)
      },

      async latestFinishedFor(domainId, urlHash) {
        const rows = await db
          .select({ row: urlVerificationUrls })
          .from(urlVerificationUrls)
          .innerJoin(urlVerifications, eq(urlVerifications.id, urlVerificationUrls.verificationId))
          .where(
            and(
              eq(urlVerifications.domainId, domainId),
              eq(urlVerificationUrls.urlHash, urlHash),
              eq(urlVerificationUrls.state, 'done'),
              isNull(urlVerifications.activeKey),
            ),
          )
          .orderBy(desc(urlVerificationUrls.fetchedAt), desc(urlVerifications.id))
          .limit(1)
        return rows[0] ? toVerifiedUrl(rows[0].row) : null
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
          .where(
            and(
              eq(crawlSchedules.enabled, true),
              lte(crawlSchedules.nextRunAt, now),
              // An archived domain keeps its schedules but nothing runs for it.
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(domains)
                  .where(
                    and(eq(domains.id, crawlSchedules.domainId), isNotNull(domains.archivedAt)),
                  ),
              ),
            ),
          )
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

    incidents: {
      async list(domainId, since) {
        return (await db
          .select()
          .from(siteIncidents)
          .where(
            and(
              eq(siteIncidents.domainId, domainId),
              since
                ? or(
                    isNull(siteIncidents.resolvedAt),
                    gte(siteIncidents.openedAt, since),
                    gte(siteIncidents.resolvedAt, since),
                  )
                : isNull(siteIncidents.resolvedAt),
            ),
          )
          .orderBy(desc(siteIncidents.openedAt))) as SiteIncident[]
      },
      async get(id) {
        const [row] = await db.select().from(siteIncidents).where(eq(siteIncidents.id, id))
        return (row as SiteIncident | undefined) ?? null
      },
      async claim(incidentId, userId, stage) {
        const rows = await db
          .insert(incidentNotices)
          .values({ incidentId, userId, stage, createdAt: new Date() })
          .onConflictDoNothing()
          .returning()
        return rows.length > 0
      },
      async release(incidentId, userId, stage) {
        await db
          .delete(incidentNotices)
          .where(
            and(
              eq(incidentNotices.incidentId, incidentId),
              eq(incidentNotices.userId, userId),
              eq(incidentNotices.stage, stage),
            ),
          )
      },
      async prune(before) {
        await db.delete(siteIncidents).where(lt(siteIncidents.resolvedAt, before))
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
        await db.transaction(async (tx) => {
          await recordFiles(tx, domainId, files)
        })
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
          .where(
            and(
              isNull(domains.archivedAt),
              or(isNull(crawlFileChecks.domainId), lte(crawlFileChecks.nextCheckAt, now)),
            ),
          )
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
      async finishCheck({ domainId, outcome, checkedAt, nextCheckAt, files = [] }) {
        await db.transaction(async (tx) => {
          await recordFiles(tx, domainId, files, { outcome, checkedAt, nextCheckAt })
        })
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
          .where(
            and(
              isNull(domains.archivedAt),
              or(isNull(domainFavicons.domainId), lte(domainFavicons.nextCheckAt, now)),
            ),
          )
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
