import type { AnswerPair } from '@seotools/core/crawl/paired'
import type { FindingStateRecord } from '../types'
import type { BotTestResult } from '../types'
import {
  emptyRenderCounts,
  type RenderCounts,
  type RenderState,
} from '@seotools/core/crawl/render-state'
import { detectIncidents, INCIDENT_STAGES } from '@seotools/core/incidents'
import { incidentAlertJobId, vitalsAlertJobId } from '../mapping'
import type { SiteIncident, NewCrawlFile } from '../types'
import { referenceGroup } from '@seotools/core/crawl/links'
import {
  CONFIGURATION_REASONS,
  EXPLANATION_VERSION,
  isComparisonReason,
  type ComparisonSide,
} from '@seotools/core/crawl/comparison-reasons'
import { CRAWL_LINK_KINDS } from '@seotools/core'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  GOOGLE_VITALS_KEY,
  AUDIT_SEMANTICS,
  DEFAULT_CRAWL_SETTINGS,
  JOB_TYPES,
  nextScheduledRun,
  type CrawlLinkKind,
} from '@seotools/core'
import type { AlertKind } from '@seotools/core'
import BetterSqlite3 from 'better-sqlite3'
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
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { alias, type SQLiteColumn, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { DomainArchivedError } from '../archive'
import { ComparisonSupersededError } from '../comparison-errors'
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
import { sqlitePathFromUrl } from '../dialect'
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
  sqliteDiffers,
  sumOf,
  toUrlComparison,
  compareSearch,
  comparisonUrlValues,
  isCurrentExplanation,
  STALE_EXPLANATION_MS,
  RENDER_BATCH,
  toComparisonHeader,
  toExplainedUrl,
  toStoredPage,
  toOneSidedUrl,
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
  pairedQueryHashes,
  newCrawlUrlRow,
  newestPerUrl,
  newestVerifiedPerUrl,
  newVerificationUrlRows,
  priorityUrlRow,
  toCrawl,
  toHeartbeat,
  crawlStartColumns,
  recordRunBuild,
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
  renderStateSql,
} from '../mapping'
import { assertKnownMigrations } from '../migration-guard'
import * as schema from '../schema/sqlite'
import type { CompareView } from '@seotools/core/crawl/compare'
import type {
  CrawlComparisonCounts,
  CrawlComparisonQuery,
  ExplanationDetails,
  SourceCounterpart,
  RenderRow,
  CrawlLink,
  CrawlUrlRender,
  CrawlUrlAudit,
  CrawlUrlBrief,
  CrawlUrlAcceptedIssue,
  CrawlUrlIssue,
  UserChange,
  UserTokenKind,
  Database,
  NewCrawlUrl,
  SecondAttemptCandidate,
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
  crawlAnswerPairs,
  crawlUrlLinks,
  crawlComparisons,
  crawlComparisonUrls,
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

/** Less free space than this is not worth rewriting the whole file for. */
const COMPACT_MIN_BYTES = 64 * 1024 * 1024

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

  async function checkMigrations(dir = options.defaultMigrationsDir()) {
    const exists = sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
      )
      .get()
    const rows = exists
      ? (sqlite.prepare('select hash, created_at from __drizzle_migrations').all() as {
          hash: string
          created_at: number
        }[])
      : []
    assertKnownMigrations(dir, rows)
  }

  /** Who can administer the instance right now. Read inside an immediate transaction. */
  const activeAdmins = (tx: Pick<typeof db, 'select'>) =>
    tx
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
      .all()
      .map(({ id }) => id)

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
    withRender: (states: readonly RenderState[] | null) =>
      states === null
        ? db
            .select({ urlHash: crawlUrlRenders.urlHash })
            .from(crawlUrlRenders)
            .where(eq(crawlUrlRenders.crawlId, crawlId))
        : db
            .select({ urlHash: crawlUrlRenders.urlHash })
            .from(crawlUrlRenders)
            .innerJoin(
              renderedUrls,
              and(
                eq(renderedUrls.crawlId, crawlUrlRenders.crawlId),
                eq(renderedUrls.urlHash, crawlUrlRenders.urlHash),
              ),
            )
            .where(and(eq(crawlUrlRenders.crawlId, crawlId), inArray(renderState, [...states]))),
  })

  function insertSitemapHreflang(
    executor: Pick<typeof db, 'insert'>,
    crawlId: string,
    entries: SitemapHreflang[],
  ) {
    for (const batch of chunk(entries)) {
      executor
        .insert(crawlSitemapHreflang)
        .values(batch.map((entry) => sitemapHreflangRow(crawlId, entry)))
        .onConflictDoNothing()
        .run()
    }
  }

  /** The URL of a render, to read whether its served HTML was cut. */
  const renderedUrls = alias(crawlUrls, 'rendered_urls')
  const servedLinks = alias(crawlUrlLinks, 'served_links')
  const renderState = renderStateSql(crawlUrlRenders, renderedUrls.data)
  /** Internal pages that answered 200 and have no render: a rendered crawl must leave none. */
  const unrenderedWhere = (crawlId: string) =>
    and(
      eq(crawlUrls.crawlId, crawlId),
      eq(crawlUrls.scope, 'internal'),
      eq(crawlUrls.state, 'done'),
      eq(crawlUrls.kind, 'page'),
      eq(crawlUrls.statusCode, 200),
      notExists(
        db
          .select({ urlHash: crawlUrlRenders.urlHash })
          .from(crawlUrlRenders)
          .where(
            and(
              eq(crawlUrlRenders.crawlId, crawlUrls.crawlId),
              eq(crawlUrlRenders.urlHash, crawlUrls.urlHash),
            ),
          ),
      ),
    )

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

  /** Explaining a pair: the source of a link, its row in the pair, and what the other crawl has. */
  const sourceUrls = alias(crawlUrls, 'source_urls')
  const counterpartUrls = alias(crawlUrls, 'counterpart_urls')
  const sourceRows = alias(crawlComparisonUrls, 'source_rows')

  /** Both crawls of a pair by id, with their `ref`s. `null` unless both have one. */
  const pairOf = (baseId: string, targetId: string) => {
    const rows = db
      .select({
        id: crawls.id,
        ref: crawls.ref,
        domainId: crawls.domainId,
        rendering: crawls.rendering,
      })
      .from(crawls)
      .where(inArray(crawls.id, [baseId, targetId]))
      .all()
    const base = rows.find((row) => row.id === baseId)
    const target = rows.find((row) => row.id === targetId)
    if (!base || !target || base.ref === null || target.ref === null || baseId === targetId)
      return null
    return { baseRef: base.ref, targetRef: target.ref, domainId: base.domainId }
  }

  const headerOf = (baseRef: number, targetRef: number) => {
    const row = db
      .select()
      .from(crawlComparisons)
      .where(and(eq(crawlComparisons.baseRef, baseRef), eq(crawlComparisons.targetRef, targetRef)))
      .get()
    return row ? toComparisonHeader(row) : null
  }

  /** The `ref`s of a pair whose stored explanation is current and done; `null` otherwise. */
  const explainedPair = (baseId: string, targetId: string) => {
    const pair = pairOf(baseId, targetId)
    if (!pair) return null
    return isCurrentExplanation(headerOf(pair.baseRef, pair.targetRef)) ? pair : null
  }

  const ofPair = (
    pair: { baseRef: number; targetRef: number },
    table: { baseRef: SQLiteColumn; targetRef: SQLiteColumn } = crawlComparisonUrls,
  ) => and(eq(table.baseRef, pair.baseRef), eq(table.targetRef, pair.targetRef))

  /** The stored reason of a listed URL (`main`), joined on the pair's primary key. */
  const explanationColumns = {
    side: crawlComparisonUrls.side,
    urlHash: crawlComparisonUrls.urlHash,
    seq: crawlComparisonUrls.seq,
    reason: crawlComparisonUrls.reason,
    detail: crawlComparisonUrls.detail,
    via: crawlComparisonUrls.via,
    viaKind: crawlComparisonUrls.viaKind,
    viaRendered: crawlComparisonUrls.viaRendered,
    through: crawlComparisonUrls.through,
    sources: crawlComparisonUrls.sources,
    unseen: crawlComparisonUrls.unseen,
    intoHash: crawlComparisonUrls.intoHash,
    intoUrl: crawlComparisonUrls.intoUrl,
    intoPresent: crawlComparisonUrls.intoPresent,
  }

  /** Which stored reasons a listing of `added`/`missing`/`configuration` shows. */
  const reasonFilter = (change: string, reason: string | undefined) => {
    const configuration = inArray(crawlComparisonUrls.reason, [...CONFIGURATION_REASONS])
    return and(
      change === 'configuration' ? configuration : not(configuration),
      reason ? eq(crawlComparisonUrls.reason, reason) : undefined,
    )
  }

  /**
   * The URLs a crawl has and the other does not, by side and reason, in the view: what the counts of
   * an explained pair add up. Grouped on the reason index; each row joins its own crawl's URL.
   */
  const reasonCounts = (
    pair: { baseRef: number; targetRef: number },
    ids: { baseId: string; targetId: string },
    view: CompareView,
  ) => {
    const reasons: CrawlComparisonCounts['reasons'] = { base: {}, target: {} }
    for (const side of ['base', 'target'] as const) {
      const rows = db
        .select({ reason: crawlComparisonUrls.reason, count: sql<number>`count(*)` })
        .from(crawlComparisonUrls)
        .innerJoin(
          crawlUrls,
          and(
            eq(crawlUrls.crawlId, side === 'base' ? ids.baseId : ids.targetId),
            eq(crawlUrls.urlHash, crawlComparisonUrls.urlHash),
          ),
        )
        .where(
          and(ofPair(pair), eq(crawlComparisonUrls.side, side), compareViewOf(crawlUrls, view)),
        )
        .groupBy(crawlComparisonUrls.reason)
        .all()
      for (const row of rows) {
        if (isComparisonReason(row.reason)) reasons[side][row.reason] = sumOf(row.count)
      }
    }
    return reasons
  }

  /** The listing of `configuration`: URLs of either side whose stored reason is a setting. */
  const explanationList = (
    query: CrawlComparisonQuery,
    pair: { baseRef: number; targetRef: number },
  ) => ({
    join: and(
      eq(
        crawlUrls.crawlId,
        sql`case when ${crawlComparisonUrls.side} = 'base' then ${query.baseId} else ${query.targetId} end`,
      ),
      eq(crawlUrls.urlHash, crawlComparisonUrls.urlHash),
    ),
    where: and(
      ofPair(pair),
      reasonFilter('configuration', query.reason),
      compareViewOf(crawlUrls, query.view),
      compareSearch(crawlUrls.url, crawlUrls.title, query.search),
    ),
  })

  /**
   * Inside a write's transaction: the pair is still claimed by `runner` and running. Otherwise the
   * run was taken over or a crawl was pruned (which removed the claim): nothing more is written.
   */
  const assertClaimed = (
    tx: Pick<typeof db, 'select'>,
    pair: { baseRef: number; targetRef: number },
    runner: string,
  ) => {
    const claim = tx
      .select({ runner: crawlComparisons.runner })
      .from(crawlComparisons)
      .where(
        and(
          ofPair(pair, crawlComparisons),
          eq(crawlComparisons.runner, runner),
          eq(crawlComparisons.state, 'running'),
        ),
      )
      .get()
    if (!claim) throw new ComparisonSupersededError()
  }

  /** A claim's values without its job: an attempt with none keeps the pair's queued job. */
  const withoutJob = <T extends { jobId: unknown }>({ jobId: _jobId, ...rest }: T) => rest

  /** What `counterparts` reads of a page in either crawl. */
  const pageColumns = (table: typeof sourceUrls | typeof counterpartUrls) => ({
    urlHash: table.urlHash,
    state: table.state,
    kind: table.kind,
    statusCode: table.statusCode,
    notRequested: sql<
      string | null
    >`case when ${table.data} like '%"notRequested":"excluded"%' then 'excluded' when ${table.data} like '%"notRequested":"depth"%' then 'depth' end`,
    servedTruncated: sql<number>`case when ${table.data} like '%"truncated":true%' then 1 else 0 end`,
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
    plan: (
      rows: AuditRuleRow[],
      context: PlanContext,
      config: AuditStateRow | undefined,
      states: FindingStateRecord[],
    ) => AuditPlan,
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
        const rows = tx
          .select()
          .from(auditRules)
          .where(eq(auditRules.domainId, domainId))
          .orderBy(asc(auditRules.createdAt), asc(auditRules.id))
          .all()
        const stateRows = tx
          .select()
          .from(findingStates)
          .where(eq(findingStates.domainId, domainId))
          .all()
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
              tx.delete(findingStates).where(eq(findingStates.id, row.id)).run()
          for (const row of decided.states) {
            const before = stateRows.find((r) => r.id === row.id)
            if (!before) tx.insert(findingStates).values(row).run()
            else if (before !== row)
              tx.update(findingStates).set(row).where(eq(findingStates.id, row.id)).run()
          }
        }
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
              ...(decided.thresholds ? thresholdColumns(decided.thresholds) : {}),
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

  /** Refuses, inside the transaction that would create something, a domain that is archived. */
  /** The `ref` of a crawl, which its rows of links carry. `null`: no such crawl. */
  const refOf = (crawlId: string) =>
    db.select({ ref: crawls.ref }).from(crawls).where(eq(crawls.id, crawlId)).get()?.ref ?? null

  /** Where the links of a URL of a crawl are (`ref` and `seq`), or `null` when it has none. */
  const linkScope = (crawlId: string, urlHash: string): LinkScope | null => {
    const row = db
      .select({ ref: crawls.ref, seq: crawlUrls.seq })
      .from(crawlUrls)
      .innerJoin(crawls, eq(crawls.id, crawlUrls.crawlId))
      .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.urlHash, urlHash)))
      .get()
    return row && row.ref !== null && row.seq !== null ? { ref: row.ref, seq: row.seq } : null
  }

  /** The `seq` of each of these URLs of a crawl that it has. */
  const seqsOf = (tx: Pick<typeof db, 'select'>, crawlId: string, hashes: string[]) => {
    const seqs = new Map<string, number>()
    for (const batch of chunk([...new Set(hashes)])) {
      for (const row of tx
        .select({ urlHash: crawlUrls.urlHash, seq: crawlUrls.seq })
        .from(crawlUrls)
        .where(and(eq(crawlUrls.crawlId, crawlId), inArray(crawlUrls.urlHash, batch)))
        .all()) {
        if (row.seq !== null) seqs.set(row.urlHash, row.seq)
      }
    }
    return seqs
  }

  /** Writes the compact history of a crawl (`crawl_url_history`) from its results per URL. */
  const writeHistory = (tx: Pick<typeof db, 'select' | 'insert'>, crawlId: string) => {
    let after = ''
    for (;;) {
      const urls = tx
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
        .all()
      if (urls.length === 0) return
      after = urls[urls.length - 1]!.urlHash
      const hashes = urls.map((url) => url.urlHash)
      const issues = groupIssues(
        tx
          .select({ urlHash: crawlUrlIssues.urlHash, issue: crawlUrlIssues.issue })
          .from(crawlUrlIssues)
          .where(and(eq(crawlUrlIssues.crawlId, crawlId), inArray(crawlUrlIssues.urlHash, hashes)))
          .all(),
      )
      const accepted = groupAcceptedIssues(
        tx
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
          )
          .all(),
      )
      const audits = new Map(
        tx
          .select()
          .from(crawlUrlAudit)
          .where(and(eq(crawlUrlAudit.crawlId, crawlId), inArray(crawlUrlAudit.urlHash, hashes)))
          .all()
          .map(({ crawlId: _crawl, ...row }) => [row.urlHash, row]),
      )
      tx.insert(crawlUrlHistory)
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
        .run()
    }
  }

  const assertNotArchived = (tx: Pick<typeof db, 'select'>, domainId: string) => {
    const row = tx
      .select({ archivedAt: domains.archivedAt })
      .from(domains)
      .where(eq(domains.id, domainId))
      .get()
    if (row?.archivedAt) throw new DomainArchivedError(domainId)
  }

  /**
   * Removes the jobs that work on these domains: their crawls' and rechecks'. The domain's rows
   * go by cascade, and a job that finds its crawl gone has nothing left to do; deleting the job
   * too means a running one is not retried, and a queued one never starts.
   */
  const recordFiles = (
    tx: Pick<typeof db, 'select' | 'insert' | 'update'>,
    domainId: string,
    files: NewCrawlFile[],
    check?: { outcome: 'ok' | 'unreachable' | 'tls-error'; checkedAt: Date; nextCheckAt: Date },
  ) => {
    const [domain] = tx.select().from(domains).where(eq(domains.id, domainId)).all()
    if (!domain || domain.archivedAt) return
    const previous = tx
      .select()
      .from(crawlFiles)
      .where(eq(crawlFiles.domainId, domainId))
      .all()
      .filter((row) => row.incidentObserved)
      .map(toCrawlFile)
    const [previousCheck] = tx
      .select()
      .from(crawlFileChecks)
      .where(eq(crawlFileChecks.domainId, domainId))
      .all()
    const active = tx
      .select()
      .from(siteIncidents)
      .where(and(eq(siteIncidents.domainId, domainId), isNull(siteIncidents.resolvedAt)))
      .all() as SiteIncident[]
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
      tx.insert(crawlFiles)
        .values({ ...crawlFileRow(domainId, file), incidentObserved: true })
        .onConflictDoUpdate({
          target: [crawlFiles.domainId, crawlFiles.urlHash],
          set: { ...crawlFileColumns(file), incidentObserved: true },
        })
        .run()
    }
    if (check) {
      const values = { ...check, requestedAt: null }
      tx.insert(crawlFileChecks)
        .values({ domainId, ...values })
        .onConflictDoUpdate({ target: crawlFileChecks.domainId, set: values })
        .run()
    }
    const queue = (id: string, stage: string, details: string) => {
      tx.insert(jobs)
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
        .run()
    }
    for (const incident of changes.open) {
      const id = randomUUID(),
        event = incident.stage === 'changed'
      tx.insert(siteIncidents)
        .values({
          ...incident,
          id,
          domainId,
          activeKey: event ? null : `${incident.kind} ${incident.subject}`,
          openedAt: now,
          lastSeenAt: now,
          resolvedAt: event ? now : null,
        })
        .run()
      queue(id, incident.stage, incident.details)
    }
    for (const incident of changes.escalate) {
      const old = active.find((i) => i.id === incident.id)!
      tx.update(siteIncidents)
        .set({ stage: incident.stage, details: incident.details, lastSeenAt: now })
        .where(eq(siteIncidents.id, incident.id))
        .run()
      if (old.stage !== incident.stage) queue(incident.id, incident.stage, incident.details)
    }
    for (const incident of changes.resolve) {
      tx.update(siteIncidents)
        .set({ activeKey: null, resolvedAt: now, lastSeenAt: now })
        .where(eq(siteIncidents.id, incident.id))
        .run()
      queue(incident.id, 'resolved', incident.details)
    }
  }

  const removeJobsOf = (tx: Pick<typeof db, 'select' | 'delete'>, domainIds: string[]) => {
    if (domainIds.length === 0) return
    const ids = [
      ...tx
        .select({ id: crawls.jobId, crawlId: crawls.id })
        .from(crawls)
        .where(inArray(crawls.domainId, domainIds))
        .all()
        .flatMap((row) => [
          row.id,
          alertJobId(row.crawlId),
          vitalsJobId(row.crawlId),
          vitalsAlertJobId(row.crawlId),
        ]),
      ...tx
        .select({ id: urlVerifications.jobId })
        .from(urlVerifications)
        .where(inArray(urlVerifications.domainId, domainIds))
        .all()
        .map((row) => row.id),
    ]
    ids.push(
      ...tx
        .select({ id: botTestRuns.jobId })
        .from(botTestRuns)
        .where(inArray(botTestRuns.domainId, domainIds))
        .all()
        .map((row) => row.id),
    )
    // The jobs that explain a pair of the domain's crawls (`requestComparison`).
    for (const row of tx
      .select({ id: crawlComparisons.jobId })
      .from(crawlComparisons)
      .innerJoin(crawls, eq(crawls.ref, crawlComparisons.targetRef))
      .where(and(inArray(crawls.domainId, domainIds), isNotNull(crawlComparisons.jobId)))
      .all()) {
      if (row.id) ids.push(row.id)
    }
    const incidentIds = tx
      .select({ id: siteIncidents.id })
      .from(siteIncidents)
      .where(inArray(siteIncidents.domainId, domainIds))
      .all()
    ids.push(
      ...incidentIds.flatMap((row) =>
        INCIDENT_STAGES.map((stage) => incidentAlertJobId(row.id, stage)),
      ),
    )
    for (const batch of chunk(ids)) tx.delete(jobs).where(inArray(jobs.id, batch)).run()
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

    checkMigrations,
    async compact() {
      const pages = Number(sqlite.pragma('page_count', { simple: true }))
      const free = Number(sqlite.pragma('freelist_count', { simple: true }))
      const size = Number(sqlite.pragma('page_size', { simple: true }))
      if (free * 4 < pages || free * size < COMPACT_MIN_BYTES) return null
      sqlite.exec('VACUUM')
      return free * size
    },

    async migrate(dir) {
      await checkMigrations(dir)
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
        return db.delete(jobs).where(and(old, notInUse)).run().changes
      },
    },

    heartbeats: {
      async beat({ workerId, startedAt, build, outdated, now = new Date() }) {
        const values = {
          lastSeenAt: now,
          build: build ? JSON.stringify(build) : null,
          outdated: outdated ?? null,
        }
        db.insert(workerHeartbeats)
          .values({ workerId, startedAt, ...values })
          .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: values })
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
        return row ? toHeartbeat(row) : null
      },
      async recent(since) {
        const rows = db
          .select()
          .from(workerHeartbeats)
          .where(gte(workerHeartbeats.lastSeenAt, since))
          .orderBy(desc(workerHeartbeats.lastSeenAt))
          .all()
        return rows.map(toHeartbeat)
      },
    },

    vitals: {
      async queueAlerts(crawlId) {
        db.insert(jobs)
          .values({
            id: vitalsAlertJobId(crawlId),
            type: 'vitals.alerts',
            payload: JSON.stringify({ crawlId }),
            runAt: new Date(),
          })
          .onConflictDoNothing()
          .run()
      },
      async latestCrawl(domainId, before) {
        const row = db
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
          .get()
        return row ? toCrawl(row) : null
      },
      async origins(crawlId) {
        return db.select().from(crawlVitals).where(eq(crawlVitals.crawlId, crawlId)).all()
      },
      async urls(crawlId) {
        return db.select().from(crawlUrlVitals).where(eq(crawlUrlVitals.crawlId, crawlId)).all()
      },
      async saveOrigin(row) {
        db.insert(crawlVitals)
          .values(row)
          .onConflictDoUpdate({ target: [crawlVitals.crawlId, crawlVitals.formFactor], set: row })
          .run()
      },
      async saveUrl(row) {
        db.insert(crawlUrlVitals)
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
          .run()
      },
    },
    userPreferences: {
      async favouriteDomainId(userId) {
        const [row] = db
          .select()
          .from(schema.userPreferences)
          .where(eq(schema.userPreferences.userId, userId))
          .all()
        return row?.favouriteDomainId ?? null
      },
      async setFavouriteDomain(userId, domainId) {
        db.insert(schema.userPreferences)
          .values({ userId, favouriteDomainId: domainId })
          .onConflictDoUpdate({
            target: schema.userPreferences.userId,
            set: { favouriteDomainId: domainId },
          })
          .run()
      },
      async locale(userId) {
        const [row] = db
          .select()
          .from(schema.userPreferences)
          .where(eq(schema.userPreferences.userId, userId))
          .all()
        return row?.locale ?? null
      },
      async setLocale(userId, locale) {
        db.insert(schema.userPreferences)
          .values({ userId, locale })
          .onConflictDoUpdate({ target: schema.userPreferences.userId, set: { locale } })
          .run()
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
          tx.insert(user).values({ id, email, name, role: 'admin', emailVerified: true }).run()
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

    users: {
      async list() {
        const known = new Set(
          db
            .select({ userId: account.userId })
            .from(account)
            .where(eq(account.providerId, CREDENTIAL_PROVIDER))
            .all()
            .map(({ userId }) => userId),
        )
        return db
          .select()
          .from(user)
          .orderBy(asc(user.name), asc(user.email))
          .all()
          .map((row) => toUserRecord(row, known.has(row.id)))
      },
      async get(id) {
        const row = db.select().from(user).where(eq(user.id, id)).get()
        if (!row) return null
        const cred = db
          .select({ id: account.id })
          .from(account)
          .where(and(eq(account.userId, id), eq(account.providerId, CREDENTIAL_PROVIDER)))
          .get()
        return toUserRecord(row, cred !== undefined)
      },
      async findByEmail(email) {
        const row = db.select({ id: user.id }).from(user).where(eq(user.email, email)).get()
        return row ? this.get(row.id) : null
      },
      async create({ email, name, role }) {
        const id = randomUUID()
        db.insert(user).values({ id, email, name, role, emailVerified: false }).run()
        const created = await this.get(id)
        if (!created) throw new Error(`User ${id} not found after creating it`)
        return created
      },
      async setRole(id, role) {
        return db.transaction(
          (tx): UserChange => {
            if (!tx.select({ id: user.id }).from(user).where(eq(user.id, id)).get()) {
              return 'not-found'
            }
            if (role !== 'admin' && removesLastAdmin(activeAdmins(tx), id)) return 'last-admin'
            tx.update(user).set({ role }).where(eq(user.id, id)).run()
            return 'ok'
          },
          { behavior: 'immediate' },
        )
      },
      async setDisabled(id, disabled) {
        return db.transaction(
          (tx): UserChange => {
            if (!tx.select({ id: user.id }).from(user).where(eq(user.id, id)).get()) {
              return 'not-found'
            }
            if (disabled && removesLastAdmin(activeAdmins(tx), id)) return 'last-admin'
            tx.update(user)
              .set({ disabledAt: disabled ? new Date() : null })
              .where(eq(user.id, id))
              .run()
            if (disabled) {
              tx.delete(schema.session).where(eq(schema.session.userId, id)).run()
              tx.delete(userTokens).where(eq(userTokens.userId, id)).run()
            }
            return 'ok'
          },
          { behavior: 'immediate' },
        )
      },
      async grantsOf(userId) {
        const rows = db.select().from(userAccess).where(eq(userAccess.userId, userId)).all()
        return foldGrants(rows).get(userId) ?? []
      },
      async allGrants() {
        return foldGrants(db.select().from(userAccess).all())
      },
      async setGrants(userId, grants) {
        return db.transaction((tx) => {
          if (!tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).get()) return false
          for (const { companyId, domainId } of grants) {
            const target = companyId
              ? tx
                  .select({ id: companies.id })
                  .from(companies)
                  .where(eq(companies.id, companyId))
                  .get()
              : tx.select({ id: domains.id }).from(domains).where(eq(domains.id, domainId!)).get()
            if (!target) return false
          }
          tx.delete(userAccess).where(eq(userAccess.userId, userId)).run()
          for (const batch of chunk(accessRows(userId, grants))) {
            tx.insert(userAccess).values(batch).run()
          }
          return true
        })
      },
      async addToken(input) {
        db.insert(userTokens).values(input).run()
      },
      async findToken(tokenHash, now) {
        const row = db
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
          .get()
        if (!row) return null
        const found = await this.get(row.userId)
        return found ? { kind: row.kind as UserTokenKind, user: found } : null
      },
      async redeemToken({ tokenHash, passwordHash, now }) {
        return db.transaction(
          (tx) => {
            const token = tx
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
              .get()
            if (!token) return false
            const { userId } = token
            const credential = and(
              eq(account.userId, userId),
              eq(account.providerId, CREDENTIAL_PROVIDER),
            )
            if (tx.select({ id: account.id }).from(account).where(credential).get()) {
              tx.update(account).set({ password: passwordHash }).where(credential).run()
            } else {
              tx.insert(account)
                .values({
                  id: randomUUID(),
                  accountId: userId,
                  providerId: CREDENTIAL_PROVIDER,
                  userId,
                  password: passwordHash,
                })
                .run()
            }
            tx.update(user).set({ emailVerified: true }).where(eq(user.id, userId)).run()
            tx.delete(userTokens).where(eq(userTokens.userId, userId)).run()
            tx.delete(schema.session).where(eq(schema.session.userId, userId)).run()
            return true
          },
          { behavior: 'immediate' },
        )
      },
      async markResetRequested(id, at) {
        db.update(user).set({ resetRequestedAt: at }).where(eq(user.id, id)).run()
      },
    },

    mail: {
      async record(input) {
        db.insert(mailDeliveries).values(mailDeliveryRow(input)).run()
      },
      async recent({ limit, outcome }) {
        return db
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
          .all()
          .map(toMailDelivery)
      },
      async prune({ before, keep }) {
        let removed = db
          .delete(mailDeliveries)
          .where(lt(mailDeliveries.createdAt, before))
          .run().changes
        const edge = db
          .select({ createdAt: mailDeliveries.createdAt })
          .from(mailDeliveries)
          .orderBy(desc(mailDeliveries.createdAt))
          .limit(1)
          .offset(Math.max(1, keep) - 1)
          .get()
        if (edge) {
          removed += db
            .delete(mailDeliveries)
            .where(lt(mailDeliveries.createdAt, edge.createdAt))
            .run().changes
        }
        return removed
      },
    },

    alerts: {
      async forUser(userId) {
        return db
          .select()
          .from(alertSubscriptions)
          .where(eq(alertSubscriptions.userId, userId))
          .orderBy(asc(alertSubscriptions.domainId))
          .all()
          .map(toAlertSubscription)
      },
      async forDomain(domainId) {
        return db
          .select()
          .from(alertSubscriptions)
          .where(eq(alertSubscriptions.domainId, domainId))
          .orderBy(asc(alertSubscriptions.userId))
          .all()
          .map(toAlertSubscription)
      },
      async save({ userId, locale, domains: entries }) {
        db.transaction((tx) => {
          for (const { domainId, kinds } of entries) {
            const known = knownAlertKinds(kinds)
            if (known.length === 0) {
              tx.delete(alertSubscriptions)
                .where(
                  and(
                    eq(alertSubscriptions.userId, userId),
                    eq(alertSubscriptions.domainId, domainId),
                  ),
                )
                .run()
              continue
            }
            const columns = alertColumns(known, locale)
            tx.insert(alertSubscriptions)
              .values({ userId, domainId, ...columns })
              .onConflictDoUpdate({
                target: [alertSubscriptions.userId, alertSubscriptions.domainId],
                set: columns,
              })
              .run()
          }
          tx.update(alertSubscriptions)
            .set({ locale })
            .where(eq(alertSubscriptions.userId, userId))
            .run()
        })
      },
      async claim({ crawlId, userId, kinds }) {
        const taken: AlertKind[] = []
        for (const kind of knownAlertKinds(kinds)) {
          const result = db
            .insert(alertNotices)
            .values({ crawlId, userId, kind })
            .onConflictDoNothing()
            .run()
          if (result.changes > 0) taken.push(kind)
        }
        return taken
      },
      async release({ crawlId, userId, kinds }) {
        db.delete(alertNotices)
          .where(
            and(
              eq(alertNotices.crawlId, crawlId),
              eq(alertNotices.userId, userId),
              inArray(alertNotices.kind, knownAlertKinds(kinds)),
            ),
          )
          .run()
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
        db.transaction((tx) => {
          tx.insert(companies).values(company).run()
          tx.insert(domains).values(domain).run()
          tx.insert(crawlSettings)
            .values({
              domainId: domain.id,
              ...crawlSettingsColumns(initialSettings ?? DEFAULT_CRAWL_SETTINGS),
            })
            .run()
        })
        return { company, domain }
      },
      async rename(id, name) {
        db.update(companies).set({ name }).where(eq(companies.id, id)).run()
        return db.select().from(companies).where(eq(companies.id, id)).get() ?? null
      },
      async delete(id) {
        return db.transaction((tx) => {
          const company = tx.select().from(companies).where(eq(companies.id, id)).get()
          if (!company) return false
          const ids = tx
            .select({ id: domains.id })
            .from(domains)
            .where(eq(domains.companyId, id))
            .all()
            .map((row) => row.id)
          removeJobsOf(tx, ids)
          tx.delete(companies).where(eq(companies.id, id)).run()
          return true
        })
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
      async add({ companyId, host, crawlSettings: initialSettings }) {
        const domain = {
          id: randomUUID(),
          companyId,
          host,
          createdAt: new Date(),
          archivedAt: null,
        }
        db.transaction((tx) => {
          tx.insert(domains).values(domain).run()
          tx.insert(crawlSettings)
            .values({
              domainId: domain.id,
              ...crawlSettingsColumns(initialSettings ?? DEFAULT_CRAWL_SETTINGS),
            })
            .run()
        })
        return domain
      },
      async archive(id) {
        return db.transaction((tx) => {
          const found = tx.select().from(domains).where(eq(domains.id, id)).get()
          if (!found) return null
          const now = new Date()
          if (!found.archivedAt) {
            tx.update(domains).set({ archivedAt: now }).where(eq(domains.id, id)).run()
          }
          const activeBotRun = tx
            .select({ id: botTestRuns.id })
            .from(botTestRuns)
            .where(and(eq(botTestRuns.domainId, id), isNotNull(botTestRuns.activeKey)))
            .all()
          if (activeBotRun.length) {
            const previous = tx
              .select({ id: botTestRuns.id, jobId: botTestRuns.jobId })
              .from(botTestRuns)
              .where(and(eq(botTestRuns.domainId, id), isNull(botTestRuns.activeKey)))
              .all()
            if (previous.length) {
              tx.delete(jobs)
                .where(
                  inArray(
                    jobs.id,
                    previous.map((row) => row.jobId),
                  ),
                )
                .run()
              tx.delete(botTestRuns)
                .where(
                  inArray(
                    botTestRuns.id,
                    previous.map((row) => row.id),
                  ),
                )
                .run()
            }
          }
          tx.update(botTestRuns)
            .set({ status: 'cancelled', activeKey: null, finishedAt: now })
            .where(and(eq(botTestRuns.domainId, id), isNotNull(botTestRuns.activeKey)))
            .run()
          // The same statements as `crawls.cancel` and `verifications.cancel`: the jobs notice
          // at their next check that the crawl is no longer running, and stop requesting.
          const ended = { status: 'cancelled', activeKey: null, finishedAt: now } as const
          tx.update(crawls)
            .set(ended)
            .where(and(eq(crawls.domainId, id), isNotNull(crawls.activeKey)))
            .run()
          tx.update(urlVerifications)
            .set(ended)
            .where(and(eq(urlVerifications.domainId, id), isNotNull(urlVerifications.activeKey)))
            .run()
          return tx.select().from(domains).where(eq(domains.id, id)).get() ?? null
        })
      },
      async unarchive(id) {
        return db.transaction((tx) => {
          if (!tx.select().from(domains).where(eq(domains.id, id)).get()) return null
          const now = new Date()
          tx.update(domains).set({ archivedAt: null }).where(eq(domains.id, id)).run()
          const schedules = tx
            .select()
            .from(crawlSchedules)
            .where(and(eq(crawlSchedules.domainId, id), eq(crawlSchedules.enabled, true)))
            .all()
          for (const row of schedules) {
            const schedule = toCrawlSchedule(row)
            tx.update(crawlSchedules)
              .set({ nextRunAt: nextScheduledRun(schedule, now) })
              .where(eq(crawlSchedules.id, row.id))
              .run()
          }
          return tx.select().from(domains).where(eq(domains.id, id)).get() ?? null
        })
      },
      async move({ id, companyId }) {
        return db.transaction((tx) => {
          const company = tx.select().from(companies).where(eq(companies.id, companyId)).get()
          if (!company) return null
          tx.update(domains).set({ companyId }).where(eq(domains.id, id)).run()
          return tx.select().from(domains).where(eq(domains.id, id)).get() ?? null
        })
      },
      async delete(id) {
        return db.transaction((tx) => {
          if (!tx.select().from(domains).where(eq(domains.id, id)).get()) return false
          removeJobsOf(tx, [id])
          tx.delete(domains).where(eq(domains.id, id)).run()
          return true
        })
      },
      async usage() {
        const group = <T extends SQLiteTable>(table: T, column: SQLiteColumn) =>
          db
            .select({ domainId: column, n: sql<number>`count(*)` })
            .from(table)
            .groupBy(column)
            .all()
        return foldUsage(db.select({ id: domains.id }).from(domains).all(), {
          crawls: group(crawls, crawls.domainId),
          urls: db
            .select({ domainId: crawls.domainId, n: sql<number>`count(*)` })
            .from(crawlUrls)
            .innerJoin(crawls, eq(crawlUrls.crawlId, crawls.id))
            .groupBy(crawls.domainId)
            .all(),
          rules: group(auditRules, auditRules.domainId),
          rechecks: group(urlVerifications, urlVerifications.domainId),
          schedules: group(crawlSchedules, crawlSchedules.domainId),
          priorityUrls: group(priorityUrls, priorityUrls.domainId),
          crawlFiles: group(crawlFiles, crawlFiles.domainId),
        })
      },
    },

    crawls: {
      async requestSecrets(domainId) {
        const row = db
          .select()
          .from(crawlSettings)
          .where(eq(crawlSettings.domainId, domainId))
          .get()
        return row?.requestSecrets ?? null
      },
      async saveRequestSecrets(domainId, encrypted) {
        await this.saveSettings(domainId, await this.settings(domainId))
        db.update(crawlSettings)
          .set({ requestSecrets: encrypted })
          .where(eq(crawlSettings.domainId, domainId))
          .run()
      },
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

      async saveIgnoredParameters(domainId, patterns) {
        const values = { ignoredParameters: JSON.stringify(patterns), updatedAt: new Date() }
        db.insert(crawlSettings)
          .values({ domainId, ...crawlSettingsColumns(DEFAULT_CRAWL_SETTINGS), ...values })
          .onConflictDoUpdate({ target: crawlSettings.domainId, set: values })
          .run()
      },

      async saveSettings(domainId, input) {
        const values = crawlSettingsColumns(input)
        const updatedAt = new Date()
        db.insert(crawlSettings)
          .values({ domainId, ...values, updatedAt })
          .onConflictDoUpdate({ target: crawlSettings.domainId, set: { ...values, updatedAt } })
          .run()
      },

      async start({ domainId, type, trigger, seedUrls, build }) {
        const now = new Date()
        const id = randomUUID()
        const jobId = randomUUID()
        try {
          db.transaction((tx) => {
            assertNotArchived(tx, domainId)
            const snapshot = tx
              .select()
              .from(crawlSettings)
              .where(eq(crawlSettings.domainId, domainId))
              .get()
            tx.insert(jobs)
              .values(crawlJobValues(id, jobId, now))
              .run()
            // One writer at a time in SQLite: the next number cannot be taken in between.
            const last =
              tx
                .select({ ref: max(crawls.ref) })
                .from(crawls)
                .get()?.ref ?? 0
            tx.insert(crawls)
              .values({
                id,
                domainId,
                type,
                trigger,
                admissionDropped: false,
                seedUrls: seedUrls ? JSON.stringify(seedUrls) : null,
                ...crawlStartColumns(snapshot, build),
                jobId,
                activeKey: domainId,
                ref: last + 1,
                createdAt: now,
              })
              .run()
          })
        } catch (error) {
          if (error instanceof DomainArchivedError) throw error
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
        const rows = db
          .select(columns)
          .from(crawls)
          .where(
            inArray(
              crawls.id,
              db.select({ id: ranked.id }).from(ranked).where(lte(ranked.rank, recent)),
            ),
          )
          .orderBy(desc(crawls.createdAt))
          .all()
        const active = db
          .select({ domainId: crawls.domainId })
          .from(crawls)
          .where(isNotNull(crawls.activeKey))
          .all()
        return foldPortfolio(
          rows.map((row) => ({ ...row, robots: null, seedUrls: null, auditSnapshot: null })),
          active,
        )
      },

      async listStructureUrls(crawlId, { after, limit }) {
        const rows = db
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
          .all()
        return rows as StructureUrl[]
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

      async markRunning(id, build) {
        return db.transaction(
          (tx) => {
            const active = and(eq(crawls.id, id), isNotNull(crawls.activeKey))
            const current = tx.select().from(crawls).where(active).get()
            if (!current) return null
            const row = tx
              .update(crawls)
              .set({
                status: 'running',
                startedAt: current.startedAt ?? new Date(),
                runBuilds: build
                  ? recordRunBuild(current.runBuilds, build, current.startedAt !== null)
                  : current.runBuilds,
              })
              .where(active)
              .returning()
              .get()
            return toCrawl(row)
          },
          { behavior: 'immediate' },
        )
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

      async finish(id, { status, error, observations }) {
        const counts = await this.countUrls(id)
        return db.transaction((tx) => {
          const crawl = tx
            .select({ type: crawls.type, domainId: crawls.domainId })
            .from(crawls)
            .where(eq(crawls.id, id))
            .get()
          const result = tx
            .update(crawls)
            .set({
              ...counts,
              pairedSummary: observations ? JSON.stringify(observations.summary) : null,
              status,
              error: error === undefined ? null : truncateError(error),
              activeKey: null,
              finishedAt: new Date(),
            })
            .where(and(eq(crawls.id, id), isNotNull(crawls.activeKey)))
            .run()
          if (result.changes === 0) return false
          if (observations?.pairs.length) {
            tx.insert(crawlAnswerPairs)
              .values(
                observations.pairs.map((pair) => ({
                  crawlId: id,
                  sourceHash: pair.sourceHash,
                  detail: JSON.stringify(pair),
                })),
              )
              .run()
          }
          // The one place a crawl ends: whoever asked to be told hears of a full crawl from here.
          if (crawl?.type === 'full') {
            tx.insert(jobs).values(alertJobValues(id, new Date())).onConflictDoNothing().run()
            const key = tx.select().from(settings).where(eq(settings.key, GOOGLE_VITALS_KEY)).get()
            const config = tx
              .select()
              .from(crawlSettings)
              .where(eq(crawlSettings.domainId, crawl.domainId))
              .get()
            if (key && config?.collectVitals !== false)
              tx.insert(jobs).values(vitalsJobValues(id, new Date())).onConflictDoNothing().run()
          }
          return true
        })
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
          .orderBy(desc(crawls.createdAt), desc(crawls.ref))
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
        const usableIds = new Set(
          candidates
            .filter((crawl) => crawl.status === 'completed' || crawl.status === 'incomplete')
            .map((crawl) => crawl.id),
        )
        for (const crawlId of expired) {
          // What each URL of a usable full crawl was stays, compact, for the history of a URL.
          const keepHistory = type === 'full' && usableIds.has(crawlId)
          db.transaction((tx) => {
            if (keepHistory) writeHistory(tx, crawlId)
            const ref = tx
              .select({ ref: crawls.ref })
              .from(crawls)
              .where(eq(crawls.id, crawlId))
              .get()?.ref
            if (ref != null) {
              tx.delete(crawlUrlLinks).where(eq(crawlUrlLinks.crawlRef, ref)).run()
              // Why URLs differ is read with the links: it goes with the results it explains.
              // The header first, then its rows, as on PostgreSQL.
              const headers = tx
                .delete(crawlComparisons)
                .where(or(eq(crawlComparisons.baseRef, ref), eq(crawlComparisons.targetRef, ref)))
                .returning({ jobId: crawlComparisons.jobId })
                .all()
              // Their jobs that have not started have nothing left to explain.
              const queued = headers.flatMap((header) => (header.jobId ? [header.jobId] : []))
              if (queued.length > 0)
                tx.delete(jobs)
                  .where(and(inArray(jobs.id, queued), eq(jobs.status, 'pending')))
                  .run()
              tx.delete(crawlComparisonUrls)
                .where(
                  or(eq(crawlComparisonUrls.baseRef, ref), eq(crawlComparisonUrls.targetRef, ref)),
                )
                .run()
            }
            tx.delete(crawlUrlIssues).where(eq(crawlUrlIssues.crawlId, crawlId)).run()
            tx.delete(crawlUrlAcceptedIssues)
              .where(eq(crawlUrlAcceptedIssues.crawlId, crawlId))
              .run()
            tx.delete(crawlUrlAudit).where(eq(crawlUrlAudit.crawlId, crawlId)).run()
            tx.delete(crawlSitemapHreflang).where(eq(crawlSitemapHreflang.crawlId, crawlId)).run()
            tx.delete(crawlUrlRenders).where(eq(crawlUrlRenders.crawlId, crawlId)).run()
            tx.delete(crawlUrlVitals).where(eq(crawlUrlVitals.crawlId, crawlId)).run()
            tx.delete(crawlUrls).where(eq(crawlUrls.crawlId, crawlId)).run()
            tx.update(crawls)
              .set({ pruned: true, history: keepHistory })
              .where(eq(crawls.id, crawlId))
              .run()
          })
        }
        return expired.length
      },

      async expireHistory({ now, defaultDays }) {
        const rows = db
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
          .all()
        const expired = rows
          .filter((row) => historyExpired(row, now, defaultDays))
          .map((row) => row.id)
        for (const batch of chunk(expired)) {
          db.transaction((tx) => {
            tx.delete(crawlUrlHistory).where(inArray(crawlUrlHistory.crawlId, batch)).run()
            tx.update(crawls).set({ history: false }).where(inArray(crawls.id, batch)).run()
          })
        }
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

      async markAdmissionDropped(crawlId) {
        await db.update(crawls).set({ admissionDropped: true }).where(eq(crawls.id, crawlId))
      },
      async extendRetryAfter(crawlId, until) {
        await db
          .update(crawls)
          .set({ retryAfterUntil: until })
          .where(
            and(
              eq(crawls.id, crawlId),
              or(isNull(crawls.retryAfterUntil), lt(crawls.retryAfterUntil, until)),
            ),
          )
      },

      async pairedCandidates(crawlId) {
        const eligible = and(
          eq(crawlUrls.crawlId, crawlId),
          eq(crawlUrls.scope, 'internal'),
          eq(crawlUrls.state, 'done'),
          eq(crawlUrls.kind, 'page'),
          isNull(crawlUrls.secondAttempt),
          gte(crawlUrls.statusCode, 200),
          ne(crawlUrls.statusCode, 206),
          lt(crawlUrls.statusCode, 300),
          sql`coalesce(json_extract(${crawlUrls.data}, '$.truncated'), 0) = 0`,
        )
        const [total] = await db
          .select({ count: sql<number>`count(*)` })
          .from(crawlUrls)
          .where(eligible)
        const hashes = await pairedQueryHashes((after) =>
          db
            .select({ urlHash: crawlUrls.urlHash, url: crawlUrls.url })
            .from(crawlUrls)
            .where(and(eligible, like(crawlUrls.url, '%?%'), gt(crawlUrls.urlHash, after)))
            .orderBy(asc(crawlUrls.urlHash))
            .limit(256),
        )
        const queryRows = hashes.length
          ? await db
              .select()
              .from(crawlUrls)
              .where(and(eligible, inArray(crawlUrls.urlHash, hashes)))
          : []
        const query = hashes.map((hash) => queryRows.find((row) => row.urlHash === hash)!)
        const general = await db
          .select()
          .from(crawlUrls)
          .where(
            and(
              eligible,
              query.length
                ? notInArray(
                    crawlUrls.urlHash,
                    query.map((row) => row.urlHash),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(crawlUrls.urlHash), asc(crawlUrls.url))
          .limit(16)
        return { eligible: Number(total?.count ?? 0), rows: [...query, ...general].map(toCrawlUrl) }
      },

      async servedAnchorBatch(crawlId, ref, seq, after) {
        return db
          .selectDistinct({ hash: crawlUrls.urlHash, url: crawlUrls.url })
          .from(crawlUrlLinks)
          .innerJoin(
            crawlUrls,
            and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.seq, crawlUrlLinks.target)),
          )
          .where(
            and(
              eq(crawlUrlLinks.crawlRef, ref),
              eq(crawlUrlLinks.source, seq),
              inArray(crawlUrlLinks.kind, ['anchor', 'anchor-nofollow']),
              or(isNull(crawlUrlLinks.rendered), eq(crawlUrlLinks.rendered, 0)),
              eq(crawlUrls.scope, 'internal'),
              gt(crawlUrls.urlHash, after),
            ),
          )
          .orderBy(asc(crawlUrls.urlHash))
          .limit(256)
      },

      async answerPairs(crawlId, sourceHashes) {
        // A crawl has at most 24 pairs, even when WP4 requests many source URLs.
        const wanted = new Set(sourceHashes)
        const rows = await db
          .select()
          .from(crawlAnswerPairs)
          .where(eq(crawlAnswerPairs.crawlId, crawlId))
        return rows
          .filter((row) => wanted.has(row.sourceHash))
          .map((row) => JSON.parse(row.detail) as AnswerPair)
      },

      async nextQueued(crawlId, limit) {
        const rows = db
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
          .orderBy(
            asc(crawlUrls.depth),
            asc(isNull(crawlUrls.seq)),
            asc(crawlUrls.seq),
            asc(crawlUrls.urlHash),
          )
          .limit(limit)
          .all()
        return rows as NewCrawlUrl[]
      },

      async transientFailureCandidates({ crawlId, ref, guessSources, after, limit }) {
        return db
          .select({ urlHash: crawlUrls.urlHash, error: crawlUrls.error })
          .from(crawlUrls)
          .where(
            and(
              eq(crawlUrls.crawlId, crawlId),
              eq(crawlUrls.scope, 'internal'),
              eq(crawlUrls.state, 'done'),
              gt(crawlUrls.urlHash, after),
              or(
                eq(crawlUrls.statusCode, 429),
                and(gte(crawlUrls.statusCode, 500), lt(crawlUrls.statusCode, 600)),
                and(isNull(crawlUrls.statusCode), isNotNull(crawlUrls.error)),
              ),
              guessSources.length === 0
                ? undefined
                : or(
                    notInArray(crawlUrls.source, [...guessSources]),
                    exists(
                      db
                        .select({ source: crawlUrlLinks.source })
                        .from(crawlUrlLinks)
                        .where(
                          and(
                            eq(crawlUrlLinks.crawlRef, ref ?? -1),
                            eq(crawlUrlLinks.target, crawlUrls.seq),
                            ne(crawlUrlLinks.source, crawlUrls.seq),
                            ne(crawlUrlLinks.kind, 'redirect'),
                          ),
                        ),
                    ),
                  ),
            ),
          )
          .orderBy(asc(crawlUrls.urlHash))
          .limit(limit)
          .all()
      },

      async planSecondPass(crawlId, pass, hashes) {
        return db.transaction((tx) => {
          const claimed = tx
            .update(crawls)
            .set({ secondPass: JSON.stringify(pass) })
            .where(
              and(eq(crawls.id, crawlId), eq(crawls.status, 'running'), isNull(crawls.secondPass)),
            )
            .returning({ id: crawls.id })
            .all()
          if (claimed.length === 0) return false
          for (const batch of chunk(hashes)) {
            tx.update(crawlUrls)
              .set({ secondAttempt: 'queued' })
              .where(and(eq(crawlUrls.crawlId, crawlId), inArray(crawlUrls.urlHash, batch)))
              .run()
          }
          return true
        })
      },

      async nextSecondAttempt(crawlId, limit) {
        const rows = db
          .select()
          .from(crawlUrls)
          .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.secondAttempt, 'queued')))
          .orderBy(
            asc(crawlUrls.depth),
            asc(isNull(crawlUrls.seq)),
            asc(crawlUrls.seq),
            asc(crawlUrls.urlHash),
          )
          .limit(limit)
          .all()
        return rows.map((row): SecondAttemptCandidate => {
          const { data, ...url } = toCrawlUrl(row)
          return { ...url, seq: url.seq ?? 0, firstRequestFailure: data?.firstRequestFailure }
        })
      },

      async claimSecondAttempt(crawlId, urlHash) {
        const rows = db
          .update(crawlUrls)
          .set({ secondAttempt: 'started' })
          .where(
            and(
              eq(crawlUrls.crawlId, crawlId),
              eq(crawlUrls.urlHash, urlHash),
              eq(crawlUrls.secondAttempt, 'queued'),
              exists(
                db
                  .select({ id: crawls.id })
                  .from(crawls)
                  .where(and(eq(crawls.id, crawlId), eq(crawls.status, 'running'))),
              ),
            ),
          )
          .returning({ hash: crawlUrls.urlHash })
          .all()
        return rows.length > 0
      },

      async finishSecondPass(crawlId, skip) {
        db.transaction((tx) => {
          const rows = tx
            .select({ state: crawlUrls.secondAttempt, count: sql<number>`count(*)` })
            .from(crawlUrls)
            .where(and(eq(crawlUrls.crawlId, crawlId), isNotNull(crawlUrls.secondAttempt)))
            .groupBy(crawlUrls.secondAttempt)
            .all()
          const counts = new Map(rows.map(({ state, count }) => [state, Number(count)]))
          if (counts.has('queued') && !skip) return
          const totals = {
            answered: counts.get('answered') ?? 0,
            failed: counts.get('failed') ?? 0,
            unconfirmed: counts.get('started') ?? 0,
          }
          const pass = skip
            ? { state: 'skipped', reason: skip, ...totals }
            : { state: 'done', ...totals }
          tx.update(crawls)
            .set({ secondPass: JSON.stringify(pass) })
            .where(and(eq(crawls.id, crawlId), eq(crawls.status, 'running')))
            .run()
          if (skip) {
            tx.update(crawlUrls)
              .set({ secondAttempt: null })
              .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.secondAttempt, 'queued')))
              .run()
          }
        })
      },

      async secondAttemptedUrls(crawlId) {
        const rows = db
          .select({ url: crawlUrls.url })
          .from(crawlUrls)
          .where(and(eq(crawlUrls.crawlId, crawlId), isNotNull(crawlUrls.secondAttempt)))
          .all()
        return rows.map(({ url }) => url)
      },

      async knownUrls(crawlId) {
        return db
          .select({ urlHash: crawlUrls.urlHash, scope: crawlUrls.scope, seq: crawlUrls.seq })
          .from(crawlUrls)
          .where(eq(crawlUrls.crawlId, crawlId))
          .all()
      },

      async renderOf(crawlId, urlHash) {
        const rows = db
          .select()
          .from(crawlUrlRenders)
          .where(and(eq(crawlUrlRenders.crawlId, crawlId), eq(crawlUrlRenders.urlHash, urlHash)))
          .all()
        const row = rows[0]
        return row ? { ...row, data: JSON.parse(row.data) as CrawlUrlRender['data'] } : null
      },
      async renders(crawlId) {
        const rows = db
          .select()
          .from(crawlUrlRenders)
          .where(eq(crawlUrlRenders.crawlId, crawlId))
          .all()
        return rows.map((row) => ({
          ...row,
          data: JSON.parse(row.data) as CrawlUrlRender['data'],
        }))
      },
      async renderStatesOf(crawlId, urlHashes) {
        const states = new Map<string, RenderState>()
        for (const batch of chunk([...new Set(urlHashes)])) {
          const rows = db
            .select({ urlHash: crawlUrlRenders.urlHash, state: renderState })
            .from(crawlUrlRenders)
            .innerJoin(
              renderedUrls,
              and(
                eq(renderedUrls.crawlId, crawlUrlRenders.crawlId),
                eq(renderedUrls.urlHash, crawlUrlRenders.urlHash),
              ),
            )
            .where(
              and(eq(crawlUrlRenders.crawlId, crawlId), inArray(crawlUrlRenders.urlHash, batch)),
            )
            .all()
          for (const row of rows) states.set(row.urlHash, row.state)
        }
        return states
      },
      async renderCounts(crawlIds) {
        const counts = new Map<string, RenderCounts>()
        for (const batch of chunk([...new Set(crawlIds)])) {
          const rows = db
            .select({
              crawlId: crawlUrlRenders.crawlId,
              state: renderState,
              count: sql<number>`count(*)`,
            })
            .from(crawlUrlRenders)
            .innerJoin(
              renderedUrls,
              and(
                eq(renderedUrls.crawlId, crawlUrlRenders.crawlId),
                eq(renderedUrls.urlHash, crawlUrlRenders.urlHash),
              ),
            )
            .where(inArray(crawlUrlRenders.crawlId, batch))
            .groupBy(sql`1`, sql`2`)
            .all()
          for (const row of rows) {
            const found = counts.get(row.crawlId) ?? emptyRenderCounts()
            found[row.state] += Number(row.count)
            counts.set(row.crawlId, found)
          }
        }
        return counts
      },
      async renderedLinksOf(crawlId, urlHash, limit) {
        const scope = linkScope(crawlId, urlHash)
        if (!scope) return { served: 0, total: 0, items: [] }
        const anchors = ['anchor', 'anchor-nofollow'] as const
        const from = and(
          eq(crawlUrlLinks.crawlRef, scope.ref),
          eq(crawlUrlLinks.source, scope.seq),
          inArray(crawlUrlLinks.kind, anchors),
          eq(crawlUrls.scope, 'internal'),
        )
        const join = crawlLinkJoin(crawlUrlLinks, crawlUrls, 'out', crawlId)
        // What the served HTML links to, as the targets of the anchors that were not found by rendering.
        const servedTargets = db
          .select({ target: servedLinks.target })
          .from(servedLinks)
          .where(
            and(
              eq(servedLinks.crawlRef, scope.ref),
              eq(servedLinks.source, scope.seq),
              inArray(servedLinks.kind, anchors),
              isNull(servedLinks.rendered),
            ),
          )
        const onlyRendered = and(
          from,
          eq(crawlUrlLinks.rendered, 1),
          notInArray(crawlUrlLinks.target, servedTargets),
        )
        const served = db
          .select({ count: sql<number>`count(distinct ${crawlUrls.urlHash})` })
          .from(crawlUrlLinks)
          .innerJoin(crawlUrls, join)
          .where(and(from, isNull(crawlUrlLinks.rendered)))
        const total = db
          .select({ count: sql<number>`count(distinct ${crawlUrls.urlHash})` })
          .from(crawlUrlLinks)
          .innerJoin(crawlUrls, join)
          .where(onlyRendered)
        const rows = db
          .selectDistinct({ url: crawlUrls.url, urlHash: crawlUrls.urlHash })
          .from(crawlUrlLinks)
          .innerJoin(crawlUrls, join)
          .where(onlyRendered)
          .orderBy(asc(crawlUrls.url), asc(crawlUrls.urlHash))
          .limit(limit)
        const servedRow = served.get()
        const totalRow = total.get()
        const items = rows.all()
        return {
          served: Number(servedRow?.count ?? 0),
          total: Number(totalRow?.count ?? 0),
          items,
        }
      },
      async saveBrowserWait(crawlId, milliseconds) {
        db.update(crawls).set({ browserWaitMs: milliseconds }).where(eq(crawls.id, crawlId)).run()
      },

      async unrenderedPages(crawlId, limit) {
        return db
          .select({ urlHash: crawlUrls.urlHash, url: crawlUrls.url })
          .from(crawlUrls)
          .where(unrenderedWhere(crawlId))
          .orderBy(asc(crawlUrls.urlHash))
          .limit(limit)
          .all()
      },

      async requeueUnrendered(crawlId) {
        return db
          .update(crawlUrls)
          .set({ state: 'queued' })
          .where(unrenderedWhere(crawlId))
          .returning({ urlHash: crawlUrls.urlHash })
          .all().length
      },

      async saveRenders(crawlId, renders) {
        db.transaction((tx) => {
          for (const render of renders) {
            const values = { crawlId, ...render, data: JSON.stringify(render.data) }
            tx.insert(crawlUrlRenders)
              .values(values)
              .onConflictDoUpdate({
                target: [crawlUrlRenders.crawlId, crawlUrlRenders.urlHash],
                set: values,
              })
              .run()
          }
        })
      },

      async recordResult({
        crawlId,
        urlHash,
        result,
        render,
        secondAttempt,
        robots,
        sitemapHreflang = [],
        urls = [],
        links = [],
      }) {
        const columns = crawlResultColumns(result, new Date())
        db.transaction((tx) => {
          for (const batch of chunk(urls)) {
            tx.insert(crawlUrls)
              .values(batch.map((url) => newCrawlUrlRow(crawlId, url)))
              .onConflictDoNothing()
              .run()
          }
          if (links.length > 0) {
            const ref = tx
              .select({ ref: crawls.ref })
              .from(crawls)
              .where(eq(crawls.id, crawlId))
              .get()?.ref
            const seqs = seqsOf(
              tx,
              crawlId,
              links.flatMap((link) => [link.sourceHash, link.targetHash]),
            )
            const rows = links.flatMap((link) => {
              const source = link.sourceSeq ?? seqs.get(link.sourceHash)
              const target = link.targetSeq ?? seqs.get(link.targetHash)
              return ref == null || source === undefined || target === undefined
                ? []
                : [newCrawlLinkRow(ref, source, target, link)]
            })
            for (const batch of chunk(rows)) {
              tx.insert(crawlUrlLinks).values(batch).onConflictDoNothing().run()
            }
          }
          if (robots) {
            tx.update(crawls)
              .set({ robots: crawlRobotsColumn(robots) })
              .where(eq(crawls.id, crawlId))
              .run()
          }
          insertSitemapHreflang(tx, crawlId, sitemapHreflang)
          if (render) {
            const values = { crawlId, ...render, data: JSON.stringify(render.data) }
            tx.insert(crawlUrlRenders)
              .values(values)
              .onConflictDoUpdate({
                target: [crawlUrlRenders.crawlId, crawlUrlRenders.urlHash],
                set: values,
              })
              .run()
          }
          tx.update(crawlUrls)
            .set({ ...columns, secondAttempt })
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
            statusCode: crawlUrls.statusCode,
            count: sql<number>`count(*)`,
          })
          .from(crawlUrls)
          .where(eq(crawlUrls.crawlId, crawlId))
          .groupBy(crawlUrls.scope, crawlUrls.kind, crawlUrls.state, crawlUrls.statusCode)
          .all()
        return foldCrawlCounts(rows)
      },

      async viewCounts(crawlId) {
        const rows = db
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
          .all()
        return foldViewCounts(rows)
      },

      async listUrls({ limit, offset, sort, direction, ...query }) {
        const crawl = db
          .select({ ref: crawls.ref })
          .from(crawls)
          .where(eq(crawls.id, query.crawlId))
          .get()
        const references = sql<number>`(select count(distinct ${crawlUrlLinks.source}) from ${crawlUrlLinks} where ${crawlUrlLinks.crawlRef} = ${crawl?.ref ?? -1} and ${crawlUrlLinks.target} = ${crawlUrls.seq})`
        const rows = db
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
          .all()
        const seqs = rows.flatMap((row) => (row.seq === null ? [] : [row.seq]))
        if (!seqs.length || crawl?.ref == null) return rows.map(toCrawlUrl)
        const referenceKind = sql<string>`case when ${inArray(
          crawlUrlLinks.kind,
          CRAWL_LINK_KINDS.filter((kind) => referenceGroup(kind) === 'resource'),
        )} then 'resource' when ${inArray(crawlUrlLinks.kind, ['canonical', 'hreflang', 'sitemap'])} then ${crawlUrlLinks.kind} else 'link' end`
        const grouped = db
          .select({
            target: crawlUrlLinks.target,
            kind: referenceKind,
            count: sql<number>`count(distinct ${crawlUrlLinks.source})`,
          })
          .from(crawlUrlLinks)
          .where(and(eq(crawlUrlLinks.crawlRef, crawl.ref), inArray(crawlUrlLinks.target, seqs)))
          .groupBy(crawlUrlLinks.target, sql`2`)
          .all()
        const totals = db
          .select({
            target: crawlUrlLinks.target,
            count: sql<number>`count(distinct ${crawlUrlLinks.source})`,
          })
          .from(crawlUrlLinks)
          .where(and(eq(crawlUrlLinks.crawlRef, crawl.ref), inArray(crawlUrlLinks.target, seqs)))
          .groupBy(crawlUrlLinks.target)
          .all()
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
        const row = db
          .select({ count: sql<number>`count(*)` })
          .from(crawlUrls)
          .where(crawlUrlWhere(urlColumns, query, subqueries(query.crawlId)))
          .get()
        return Number(row?.count ?? 0)
      },

      async urlsOf(crawlId, urlHashes) {
        const found: CrawlUrl[] = []
        for (const batch of chunk([...new Set(urlHashes)])) {
          const rows = db
            .select()
            .from(crawlUrls)
            .where(and(eq(crawlUrls.crawlId, crawlId), inArray(crawlUrls.urlHash, batch)))
            .all()
          for (const row of rows) found.push(toCrawlUrl(row))
        }
        return found
      },

      async outlinksOf(crawlId, sourceHash, { after, limit }) {
        const ref = refOf(crawlId)
        if (ref === null) return { links: [], next: null }
        const source = db
          .select({ seq: crawlUrls.seq })
          .from(crawlUrls)
          .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.urlHash, sourceHash)))
          .get()
        if (!source || source.seq === null) return { links: [], next: null }
        const rows = db
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
          .all()
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
        const rows = db
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
          .all()
        const last = rows.at(-1)
        return {
          urls: rows.map((row) => row.url),
          observations: rows.map(({ url, canonical }) => ({ url, canonical })),
          next: last && last.seq !== null && rows.length === limit ? last.seq : null,
        }
      },

      async parameterEntries(crawlId, { limit, offset }) {
        const ref = refOf(crawlId)
        if (ref === null) return { entries: [], total: 0 }
        const sources = alias(crawlUrls, 'entry_sources')
        const where = and(eq(crawlUrlLinks.crawlRef, ref), isNotNull(crawlUrlLinks.snippet))
        const rows = db
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
          .all()
        const counted = db
          .select({ count: sql<number>`count(*)` })
          .from(crawlUrlLinks)
          .where(where)
          .get()
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
        const ref = refOf(crawlId)
        const columns = {
          url: crawlUrls.url,
          urlHash: crawlUrls.urlHash,
          seq: crawlUrls.seq,
          foundFrom: crawlUrls.foundFrom,
          foundKind: crawlUrls.foundKind,
        }
        let row = db
          .select(columns)
          .from(crawlUrls)
          .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.urlHash, urlHash)))
          .get()
        const seen = new Set<string>()
        while (row && !seen.has(row.urlHash) && steps.length < MAX_DISCOVERY_STEPS) {
          seen.add(row.urlHash)
          const from = row.foundFrom
          const link =
            from === null || ref === null || row.seq === null
              ? undefined
              : db
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
                  .get()
          steps.unshift({
            url: row.url,
            urlHash: row.urlHash,
            foundKind: from === null ? null : (row.foundKind as CrawlLinkKind | null),
            context: link ? toLinkContext(link) : null,
          })
          if (from === null) break
          row = db
            .select(columns)
            .from(crawlUrls)
            .where(and(eq(crawlUrls.crawlId, crawlId), eq(crawlUrls.seq, from)))
            .get()
        }
        return steps
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
        const scope = linkScope(crawlId, targetHash)
        if (!scope) return []
        const rows = db
          .select({ url: crawlUrls.url, kind: crawlUrlLinks.kind })
          .from(crawlUrlLinks)
          .innerJoin(crawlUrls, crawlLinkJoin(crawlUrlLinks, crawlUrls, 'in', crawlId))
          .where(crawlLinkWhere(crawlUrlLinks, crawlUrls.url, { direction: 'in' }, scope))
          .orderBy(asc(crawlUrls.url), asc(crawlUrlLinks.kind))
          .limit(limit)
          .all()
        return rows as { url: string; kind: CrawlLinkKind }[]
      },

      async linkTargets(crawlId, sourceHash, { limit = MAX_LIMIT } = {}) {
        const scope = linkScope(crawlId, sourceHash)
        if (!scope) return []
        const rows = db
          .select({ url: crawlUrls.url, kind: crawlUrlLinks.kind })
          .from(crawlUrlLinks)
          .innerJoin(crawlUrls, crawlLinkJoin(crawlUrlLinks, crawlUrls, 'out', crawlId))
          .where(crawlLinkWhere(crawlUrlLinks, crawlUrls.url, { direction: 'out' }, scope))
          .orderBy(asc(crawlUrls.url), asc(crawlUrlLinks.kind))
          .limit(limit)
          .all()
        return rows as { url: string; kind: CrawlLinkKind }[]
      },

      async listLinks({ limit, offset, crawlId, urlHash, ...query }) {
        if (query.kinds?.length === 0) return []
        const scope = linkScope(crawlId, urlHash)
        if (!scope) return []
        const rows = db
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
          .all()
        return rows.map(toCrawlLinkRow)
      },

      async countLinks({ crawlId, urlHash, ...query }) {
        if (query.kinds?.length === 0) return 0
        const scope = linkScope(crawlId, urlHash)
        if (!scope) return 0
        const row = db
          .select({ count: sql<number>`count(*)` })
          .from(crawlUrlLinks)
          .innerJoin(crawlUrls, crawlLinkJoin(crawlUrlLinks, crawlUrls, query.direction, crawlId))
          .where(crawlLinkWhere(crawlUrlLinks, crawlUrls.url, query, scope))
          .get()
        return Number(row?.count ?? 0)
      },

      async linkKindCounts(crawlId, urlHash, direction) {
        const scope = linkScope(crawlId, urlHash)
        if (!scope) return []
        const rows = db
          .select({ kind: crawlUrlLinks.kind, count: sql<number>`count(*)` })
          .from(crawlUrlLinks)
          .innerJoin(crawlUrls, crawlLinkJoin(crawlUrlLinks, crawlUrls, direction, crawlId))
          .where(crawlLinkWhere(crawlUrlLinks, crawlUrls.url, { direction }, scope))
          .groupBy(crawlUrlLinks.kind)
          .all()
        return rows.map((row) => ({ kind: row.kind as CrawlLinkKind, count: Number(row.count) }))
      },

      async linksFrom(crawlId, sourceHashes) {
        const ref = refOf(crawlId)
        if (ref === null) return []
        const sources = alias(crawlUrls, 'sources')
        const targets = alias(crawlUrls, 'targets')
        const found: CrawlLink[] = []
        for (const batch of chunk(sourceHashes)) {
          const rows = db
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
            .all()
          for (const { rendered, ...row } of rows as CrawlLink[])
            found.push({ ...row, ...(rendered ? { rendered } : {}) })
        }
        return found
      },

      async addSitemapHreflang(crawlId, entries) {
        insertSitemapHreflang(db, crawlId, entries)
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
                      eq(crawlUrlLinks.crawlRef, refOf(crawlId) ?? -1),
                      inArray(crawlUrlLinks.kind, ['anchor', 'anchor-nofollow']),
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

      async saveAnalysis({
        crawlId,
        issues,
        accepted = [],
        pages,
        withType,
        catalog,
        audit,
        build,
      }) {
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
              .set({
                ...crawlAnalysisColumns({
                  pages,
                  withType,
                  catalog,
                  snapshot: audit.snapshot,
                  audit: audit.pages,
                }),
                analysisBuild: build ? JSON.stringify(build) : null,
              })
              .where(eq(crawls.id, crawlId))
              .run()
            return true
          },
          { behavior: 'immediate' },
        )
      },

      async issueCounts(crawlId) {
        const rows = db
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
          .all()
        return foldIssueCounts(rows)
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
          const rows = db
            .select()
            .from(crawlUrlAudit)
            .where(and(eq(crawlUrlAudit.crawlId, crawlId), inArray(crawlUrlAudit.urlHash, batch)))
            .all()
          for (const row of rows) found.push(toCrawlUrlAudit(row))
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
                compareViewOf(crawlUrls, view),
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
                compareViewEither(crawlUrls, otherUrls, view),
              ),
            )
            .get(),
        ])
        const pair = explainedPair(baseId, targetId)
        const reasons = pair
          ? reasonCounts(pair, { baseId, targetId }, view)
          : { base: {}, target: {} }
        const configured = (side: 'base' | 'target') =>
          CONFIGURATION_REASONS.reduce((sum, reason) => sum + (reasons[side][reason] ?? 0), 0)
        return {
          added: sumOf(added?.count) - configured('target'),
          missing: sumOf(missing?.count) - configured('base'),
          configuration: configured('base') + configured('target'),
          explained: pair !== null,
          reasons,
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
        const pair =
          query.change === 'added' || query.change === 'missing' || query.change === 'configuration'
            ? explainedPair(query.baseId, query.targetId)
            : null
        if (query.change === 'configuration') {
          if (!pair) return []
          const list = explanationList(query, pair)
          const rows = db
            .select({
              urlHash: crawlUrls.urlHash,
              url: crawlUrls.url,
              main: snapshotOf(crawlUrls),
              explanation: explanationColumns,
            })
            .from(crawlComparisonUrls)
            .innerJoin(crawlUrls, list.join)
            .where(list.where)
            .orderBy(asc(crawlUrls.url), asc(crawlUrls.urlHash))
            .limit(limit)
            .offset(offset)
            .all()
          return rows.map((row) => toUrlComparison(query.change, { ...row, other: null }))
        }
        const plan = comparePlan(query)
        const rows = db
          .select({
            urlHash: crawlUrls.urlHash,
            url: crawlUrls.url,
            main: snapshotOf(crawlUrls),
            other: snapshotOf(otherUrls),
            explanation: explanationColumns,
          })
          .from(crawlUrls)
          .leftJoin(
            otherUrls,
            and(eq(otherUrls.crawlId, plan.otherCrawlId), eq(otherUrls.urlHash, crawlUrls.urlHash)),
          )
          .leftJoin(
            crawlComparisonUrls,
            pair
              ? and(ofPair(pair), eq(crawlComparisonUrls.urlHash, crawlUrls.urlHash))
              : sql`0 = 1`,
          )
          .where(
            compareWhere(
              query,
              crawlUrls,
              otherUrls,
              sqliteDiffers,
              findingDifferences(query.baseId, query.targetId),
              pair ? reasonFilter(query.change, query.reason) : undefined,
            ),
          )
          .orderBy(asc(crawlUrls.url), asc(crawlUrls.urlHash))
          .limit(limit)
          .offset(offset)
          .all()
        return rows.map(({ explanation, ...row }) =>
          toUrlComparison(query.change, pair ? { ...row, explanation } : row),
        )
      },

      async countCompared(query) {
        if (!(await comparablePair(query.domainId, query.baseId, query.targetId))) return 0
        const pair =
          query.change === 'added' || query.change === 'missing' || query.change === 'configuration'
            ? explainedPair(query.baseId, query.targetId)
            : null
        if (query.change === 'configuration') {
          if (!pair) return 0
          const list = explanationList(query, pair)
          const row = db
            .select({ count: sql<number>`count(*)` })
            .from(crawlComparisonUrls)
            .innerJoin(crawlUrls, list.join)
            .where(list.where)
            .get()
          return sumOf(row?.count)
        }
        const plan = comparePlan(query)
        const base = db
          .select({ count: sql<number>`count(*)` })
          .from(crawlUrls)
          .leftJoin(
            otherUrls,
            and(eq(otherUrls.crawlId, plan.otherCrawlId), eq(otherUrls.urlHash, crawlUrls.urlHash)),
          )
        const where = compareWhere(
          query,
          crawlUrls,
          otherUrls,
          sqliteDiffers,
          findingDifferences(query.baseId, query.targetId),
          pair ? reasonFilter(query.change, query.reason) : undefined,
        )
        const row = pair
          ? base
              .leftJoin(
                crawlComparisonUrls,
                and(ofPair(pair), eq(crawlComparisonUrls.urlHash, crawlUrls.urlHash)),
              )
              .where(where)
              .get()
          : base.where(where).get()
        return sumOf(row?.count)
      },

      async comparisonHeader({ domainId, baseId, targetId }) {
        const pair = pairOf(baseId, targetId)
        if (!pair || pair.domainId !== domainId) return null
        return headerOf(pair.baseRef, pair.targetRef)
      },

      async requestComparison({ domainId, baseId, targetId, now = new Date() }) {
        if (!(await comparablePair(domainId, baseId, targetId))) return null
        const found = pairOf(baseId, targetId)
        if (!found) return null
        const pair = { baseRef: found.baseRef, targetRef: found.targetRef }
        const archived = db
          .select({ archivedAt: domains.archivedAt })
          .from(domains)
          .where(eq(domains.id, domainId))
          .get()?.archivedAt
        if (archived) return headerOf(pair.baseRef, pair.targetRef)
        const jobId = randomUUID()
        const queued = {
          version: EXPLANATION_VERSION,
          state: 'queued',
          runner: null,
          jobId,
          startedAt: now,
          finishedAt: null,
        }
        // A job of the pair that is still waiting or running: never a second one.
        const activeJob = exists(
          db
            .select({ one: sql`1` })
            .from(jobs)
            .where(
              and(
                eq(jobs.id, crawlComparisons.jobId),
                inArray(jobs.status, ['pending', 'running']),
              ),
            ),
        )
        const idle = or(
          and(
            isNull(crawlComparisons.jobId),
            or(
              ne(crawlComparisons.state, 'running'),
              // A run inside a crawl job that never finished.
              lt(crawlComparisons.startedAt, new Date(now.getTime() - STALE_EXPLANATION_MS)),
            ),
          ),
          and(isNotNull(crawlComparisons.jobId), not(activeJob)),
        )
        db.transaction(
          (tx) => {
            // Retention is checked in the same transaction: a pruned crawl never gets a header again.
            const kept = tx
              .select({ id: crawls.id })
              .from(crawls)
              .where(and(inArray(crawls.id, [baseId, targetId]), eq(crawls.pruned, false)))
              .all()
            if (kept.length < 2) return
            const created = tx
              .insert(crawlComparisons)
              .values({ ...pair, ...queued, failures: 0, retryAt: null })
              .onConflictDoNothing()
              .returning({ ref: crawlComparisons.baseRef })
              .all()
            const renewed =
              created.length > 0
                ? created
                : tx
                    .update(crawlComparisons)
                    .set(queued)
                    .where(
                      and(
                        ofPair(pair, crawlComparisons),
                        idle,
                        or(
                          ne(crawlComparisons.version, EXPLANATION_VERSION),
                          // Failed: asked for again only once its back-off has passed.
                          and(
                            eq(crawlComparisons.state, 'failed'),
                            or(
                              isNull(crawlComparisons.retryAt),
                              lte(crawlComparisons.retryAt, now),
                            ),
                          ),
                          inArray(crawlComparisons.state, ['queued', 'running']),
                        ),
                      ),
                    )
                    .returning({ ref: crawlComparisons.baseRef })
                    .all()
            if (renewed.length === 0) {
              // Failed inside a crawl while the pair's own job still waits: queued for that job.
              tx.update(crawlComparisons)
                .set({ state: 'queued', retryAt: null })
                .where(
                  and(
                    ofPair(pair, crawlComparisons),
                    eq(crawlComparisons.state, 'failed'),
                    isNotNull(crawlComparisons.jobId),
                    activeJob,
                  ),
                )
                .run()
            }
            if (renewed.length > 0) {
              tx.insert(jobs)
                .values({
                  id: jobId,
                  type: JOB_TYPES.compareExplain,
                  payload: JSON.stringify({ baseId, targetId }),
                  runAt: now,
                  createdAt: now,
                  updatedAt: now,
                })
                .run()
            }
          },
          { behavior: 'immediate' },
        )
        return headerOf(pair.baseRef, pair.targetRef)
      },

      async explanationStamp(domainId) {
        const row = db
          .select({
            count: sql<number>`count(*)`,
            done: sql<number>`sum(case when ${crawlComparisons.state} = 'done' then 1 else 0 end)`,
            last: max(crawlComparisons.finishedAt),
          })
          .from(crawlComparisons)
          .innerJoin(crawls, eq(crawls.ref, crawlComparisons.targetRef))
          .where(eq(crawls.domainId, domainId))
          .get()
        return `${sumOf(row?.count)}:${sumOf(row?.done)}:${row?.last?.getTime?.() ?? row?.last ?? ''}`
      },

      async comparisonReasons({ domainId, baseId, targetId, urlHashes }) {
        if (urlHashes.length === 0 || !(await comparablePair(domainId, baseId, targetId))) return []
        const pair = pairOf(baseId, targetId)
        if (!pair) return []
        const found: { urlHash: string; side: ComparisonSide; reason: string }[] = []
        for (const batch of chunk([...new Set(urlHashes)])) {
          const rows = db
            .select({
              urlHash: crawlComparisonUrls.urlHash,
              side: crawlComparisonUrls.side,
              reason: crawlComparisonUrls.reason,
            })
            .from(crawlComparisonUrls)
            .where(and(ofPair(pair), inArray(crawlComparisonUrls.urlHash, batch)))
            .all()
          for (const row of rows) found.push({ ...row, side: row.side as ComparisonSide })
        }
        return found
      },

      comparisonWork: {
        async begin({ baseId, targetId, runner, version, jobId = null, now = new Date() }) {
          return db.transaction(
            (tx) => {
              // Claimed only while both crawls are still retained full results of the pair.
              const rows = tx
                .select({
                  id: crawls.id,
                  ref: crawls.ref,
                  pruned: crawls.pruned,
                  status: crawls.status,
                })
                .from(crawls)
                .where(inArray(crawls.id, [baseId, targetId]))
                .all()
              const base = rows.find((row) => row.id === baseId)
              const target = rows.find((row) => row.id === targetId)
              const usable = (row: typeof base) =>
                !!row &&
                row.ref !== null &&
                !row.pruned &&
                (row.status === 'completed' || row.status === 'incomplete')
              if (baseId === targetId || !usable(base) || !usable(target)) return false
              const pair = { baseRef: base!.ref!, targetRef: target!.ref! }
              const values = {
                version,
                state: 'running',
                runner,
                jobId,
                startedAt: now,
                finishedAt: null,
              }
              tx.insert(crawlComparisons)
                .values({ ...pair, ...values, failures: 0, retryAt: null })
                .onConflictDoUpdate({
                  target: [crawlComparisons.baseRef, crawlComparisons.targetRef],
                  // An attempt with no job of its own (inside a crawl) keeps the pair's queued job.
                  set: jobId === null ? withoutJob(values) : values,
                })
                .run()
              tx.delete(crawlComparisonUrls).where(ofPair(pair)).run()
              return true
            },
            { behavior: 'immediate' },
          )
        },

        async oneSided({ baseId, targetId, side, after, limit, undecided }) {
          const pair = pairOf(baseId, targetId)
          if (!pair) return []
          const [ownId, otherId] = side === 'base' ? [baseId, targetId] : [targetId, baseId]
          const rows = db
            .select({
              urlHash: crawlUrls.urlHash,
              url: crawlUrls.url,
              seq: crawlUrls.seq,
              source: crawlUrls.source,
              foundFrom: crawlUrls.foundFrom,
              foundKind: crawlUrls.foundKind,
              viaHash: sourceUrls.urlHash,
              viaUrl: sourceUrls.url,
              viaRendered: crawlUrlLinks.rendered,
              viaLinkKind: crawlUrlLinks.kind,
            })
            .from(crawlUrls)
            .leftJoin(
              otherUrls,
              and(eq(otherUrls.crawlId, otherId), eq(otherUrls.urlHash, crawlUrls.urlHash)),
            )
            .leftJoin(
              sourceUrls,
              and(eq(sourceUrls.crawlId, ownId), eq(sourceUrls.seq, crawlUrls.foundFrom)),
            )
            .leftJoin(
              crawlUrlLinks,
              and(
                eq(crawlUrlLinks.crawlRef, side === 'base' ? pair.baseRef : pair.targetRef),
                eq(crawlUrlLinks.source, crawlUrls.foundFrom),
                eq(crawlUrlLinks.target, crawlUrls.seq),
                eq(crawlUrlLinks.kind, crawlUrls.foundKind),
              ),
            )
            .leftJoin(
              crawlComparisonUrls,
              undecided
                ? and(ofPair(pair), eq(crawlComparisonUrls.urlHash, crawlUrls.urlHash))
                : sql`0 = 1`,
            )
            .where(
              and(
                eq(crawlUrls.crawlId, ownId),
                eq(crawlUrls.scope, 'internal'),
                isNull(otherUrls.urlHash),
                undecided ? isNull(crawlComparisonUrls.urlHash) : undefined,
                after === null ? undefined : gt(crawlUrls.urlHash, after),
              ),
            )
            .orderBy(asc(crawlUrls.urlHash))
            .limit(limit)
            .all()
          return rows.map(toOneSidedUrl)
        },

        async present(crawlId, urlHashes) {
          const found: { urlHash: string; url: string; seq: number | null }[] = []
          for (const batch of chunk([...new Set(urlHashes)])) {
            const rows = db
              .select({ urlHash: crawlUrls.urlHash, url: crawlUrls.url, seq: crawlUrls.seq })
              .from(crawlUrls)
              .where(and(eq(crawlUrls.crawlId, crawlId), inArray(crawlUrls.urlHash, batch)))
              .all()
            found.push(...rows)
          }
          return found
        },

        async save({ baseId, targetId, runner, rows }) {
          const pair = pairOf(baseId, targetId)
          if (!pair) throw new ComparisonSupersededError()
          db.transaction(
            (tx) => {
              assertClaimed(tx, pair, runner)
              for (const batch of chunk(rows, 1000)) {
                tx.insert(crawlComparisonUrls)
                  .values(
                    batch.map((row) => comparisonUrlValues(pair.baseRef, pair.targetRef, row)),
                  )
                  .onConflictDoNothing()
                  .run()
              }
            },
            { behavior: 'immediate' },
          )
        },

        async inLinks({ baseId, targetId, side, seqs, after, limit }) {
          const pair = pairOf(baseId, targetId)
          if (!pair || seqs.length === 0) return []
          const ownRef = side === 'base' ? pair.baseRef : pair.targetRef
          const rows = db
            .select({
              target: crawlUrlLinks.target,
              source: crawlUrlLinks.source,
              kind: crawlUrlLinks.kind,
              rendered: crawlUrlLinks.rendered,
            })
            .from(crawlUrlLinks)
            .where(
              and(
                eq(crawlUrlLinks.crawlRef, ownRef),
                inArray(crawlUrlLinks.target, seqs),
                // A page that names itself (canonical, og:url) says nothing about how it was reached.
                ne(crawlUrlLinks.source, crawlUrlLinks.target),
                after === null
                  ? undefined
                  : or(
                      gt(crawlUrlLinks.target, after.target),
                      and(
                        eq(crawlUrlLinks.target, after.target),
                        gt(crawlUrlLinks.source, after.source),
                      ),
                      and(
                        eq(crawlUrlLinks.target, after.target),
                        eq(crawlUrlLinks.source, after.source),
                        gt(crawlUrlLinks.kind, after.kind),
                      ),
                    ),
              ),
            )
            .orderBy(asc(crawlUrlLinks.target), asc(crawlUrlLinks.source), asc(crawlUrlLinks.kind))
            .limit(limit)
            .all()
          return rows.map((row) => ({ ...row, rendered: row.rendered === 1 }))
        },

        async counterparts({ baseId, targetId, side, sources, merged }) {
          const pair = pairOf(baseId, targetId)
          if (!pair || sources.length === 0) return []
          const [ownId, otherId] = side === 'base' ? [baseId, targetId] : [targetId, baseId]
          const found: SourceCounterpart[] = []
          // By index, joined here; 5,000 parameters a lookup, within both dialects' limits.
          for (const batch of chunk([...new Set(sources)], 5000)) {
            const own = db
              .select({ seq: sourceUrls.seq, ...pageColumns(sourceUrls) })
              .from(sourceUrls)
              .where(and(eq(sourceUrls.crawlId, ownId), inArray(sourceUrls.seq, batch)))
              .all()
            if (own.length === 0) continue
            const hashes = own.map((row) => row.urlHash)
            // Sources the other crawl reads at another address: not the same page there.
            const moved = new Set<string>()
            if (merged) {
              const rows = db
                .select({ urlHash: sourceRows.urlHash })
                .from(sourceRows)
                .where(
                  and(
                    ofPair(pair, sourceRows),
                    inArray(sourceRows.urlHash, hashes),
                    isNotNull(sourceRows.intoHash),
                  ),
                )
                .all()
              for (const row of rows) moved.add(row.urlHash)
            }
            const others = db
              .select(pageColumns(counterpartUrls))
              .from(counterpartUrls)
              .where(
                and(eq(counterpartUrls.crawlId, otherId), inArray(counterpartUrls.urlHash, hashes)),
              )
              .all()
            const byHash = new Map(others.map((row) => [row.urlHash, row]))
            for (const row of own) {
              if (row.seq === null) continue
              const ownPage = toStoredPage(row)
              if (!ownPage) continue
              found.push({
                source: row.seq,
                own: ownPage,
                other: moved.has(row.urlHash) ? null : toStoredPage(byHash.get(row.urlHash)),
                identityChanged: moved.has(row.urlHash),
              })
            }
          }
          return found
        },

        async renders({ baseId, targetId, crawlId, urlHashes }) {
          if (urlHashes.length === 0 || (crawlId !== baseId && crawlId !== targetId)) return []
          const found: RenderRow[] = []
          for (const batch of chunk([...new Set(urlHashes)], RENDER_BATCH)) {
            const rows = db
              .select({
                urlHash: crawlUrlRenders.urlHash,
                status: crawlUrlRenders.status,
                settled: crawlUrlRenders.settled,
                truncated: crawlUrlRenders.truncated,
                data: crawlUrlRenders.data,
              })
              .from(crawlUrlRenders)
              .where(
                and(eq(crawlUrlRenders.crawlId, crawlId), inArray(crawlUrlRenders.urlHash, batch)),
              )
              .all()
            for (const row of rows)
              found.push({ ...row, settled: Boolean(row.settled) } as RenderRow)
          }
          return found
        },

        async pending({ baseId, targetId, after, limit }) {
          const pair = pairOf(baseId, targetId)
          if (!pair) return []
          const rows = db
            .select(explanationColumns)
            .from(crawlComparisonUrls)
            .where(
              and(
                ofPair(pair),
                eq(crawlComparisonUrls.reason, 'pending'),
                after === null ? undefined : gt(crawlComparisonUrls.urlHash, after),
              ),
            )
            .orderBy(asc(crawlComparisonUrls.urlHash))
            .limit(limit)
            .all()
          return rows.map(toExplainedUrl)
        },

        async merges({ baseId, targetId, side, after, limit }) {
          const pair = pairOf(baseId, targetId)
          if (!pair) return []
          const rows = db
            .select(explanationColumns)
            .from(crawlComparisonUrls)
            .where(
              and(
                ofPair(pair),
                eq(crawlComparisonUrls.side, side),
                inArray(crawlComparisonUrls.reason, ['merged', 'split']),
                eq(crawlComparisonUrls.intoPresent, true),
                after === null ? undefined : gt(crawlComparisonUrls.urlHash, after),
              ),
            )
            .orderBy(asc(crawlComparisonUrls.urlHash))
            .limit(limit)
            .all()
          return rows.map(toExplainedUrl)
        },

        async unseenSources({ baseId, targetId, side, seqs }) {
          const pair = pairOf(baseId, targetId)
          if (!pair || seqs.length === 0) return []
          const [ownId, otherId] = side === 'base' ? [baseId, targetId] : [targetId, baseId]
          const ownRef = side === 'base' ? pair.baseRef : pair.targetRef
          const rows = db
            .select({
              target: crawlUrlLinks.target,
              reason: sourceRows.reason,
              detail: sourceRows.detail,
              seq: sql<number>`min(${crawlUrlLinks.source})`,
            })
            .from(crawlUrlLinks)
            .innerJoin(
              sourceUrls,
              and(eq(sourceUrls.crawlId, ownId), eq(sourceUrls.seq, crawlUrlLinks.source)),
            )
            .leftJoin(
              sourceRows,
              and(ofPair(pair, sourceRows), eq(sourceRows.urlHash, sourceUrls.urlHash)),
            )
            .leftJoin(
              counterpartUrls,
              and(
                eq(counterpartUrls.crawlId, otherId),
                eq(counterpartUrls.urlHash, sourceUrls.urlHash),
              ),
            )
            .where(
              and(
                eq(crawlUrlLinks.crawlRef, ownRef),
                inArray(crawlUrlLinks.target, seqs),
                ne(crawlUrlLinks.source, crawlUrlLinks.target),
                isNull(counterpartUrls.urlHash),
              ),
            )
            .groupBy(sql.raw('1, 2, 3'))
            .all()
          return rows.map((row) => ({
            target: Number(row.target),
            reason: row.reason,
            detail: row.detail,
            seq: Number(row.seq),
          }))
        },

        async resolve({ baseId, targetId, runner, rows }) {
          const pair = pairOf(baseId, targetId)
          if (!pair) throw new ComparisonSupersededError()
          if (rows.length === 0) return
          db.transaction(
            (tx) => {
              assertClaimed(tx, pair, runner)
              for (const batch of chunk(rows, 1000)) {
                tx.delete(crawlComparisonUrls)
                  .where(
                    and(
                      ofPair(pair),
                      inArray(
                        crawlComparisonUrls.urlHash,
                        batch.map((row) => row.urlHash),
                      ),
                    ),
                  )
                  .run()
                tx.insert(crawlComparisonUrls)
                  .values(
                    batch.map((row) => comparisonUrlValues(pair.baseRef, pair.targetRef, row)),
                  )
                  .run()
              }
            },
            { behavior: 'immediate' },
          )
        },

        async finish({ baseId, targetId, runner, state, retryAt = null, now = new Date() }) {
          const pair = pairOf(baseId, targetId)
          if (!pair) return false
          const values =
            state === 'done'
              ? { state, finishedAt: now, failures: 0, retryAt: null }
              : state === 'failed'
                ? {
                    state,
                    finishedAt: now,
                    failures: sql`${crawlComparisons.failures} + 1`,
                    retryAt,
                  }
                : // The job that runs it will try again: still to be worked out.
                  { state, runner: null }
          const updated = db
            .update(crawlComparisons)
            .set(values)
            .where(
              and(
                ofPair(pair, crawlComparisons),
                eq(crawlComparisons.runner, runner),
                eq(crawlComparisons.state, 'running'),
              ),
            )
            .returning({ ref: crawlComparisons.baseRef })
            .all()
          return updated.length > 0
        },
      },

      async explanationDetails({ domainId, baseId, targetId, rows }) {
        const details: ExplanationDetails = {
          urls: { base: new Map(), target: new Map() },
          links: { base: new Map(), target: new Map() },
        }
        if (rows.length === 0 || !(await comparablePair(domainId, baseId, targetId))) return details
        const pair = pairOf(baseId, targetId)
        if (!pair) return details
        for (const side of ['base', 'target'] as const) {
          const own = rows.filter((row) => row.side === side)
          const crawlId = side === 'base' ? baseId : targetId
          const ref = side === 'base' ? pair.baseRef : pair.targetRef
          const seqs = [
            ...new Set(own.flatMap((row) => [row.via, row.through]).filter((seq) => seq !== null)),
          ]
          for (const batch of chunk(seqs)) {
            const found = db
              .select({ seq: crawlUrls.seq, url: crawlUrls.url })
              .from(crawlUrls)
              .where(and(eq(crawlUrls.crawlId, crawlId), inArray(crawlUrls.seq, batch)))
              .all()
            for (const row of found) if (row.seq !== null) details.urls[side].set(row.seq, row.url)
          }
          // The exact link each reason is about: its stored kind, never another link of the pair.
          const linked = own.filter(
            (row) => row.via !== null && row.seq !== null && row.viaKind !== null,
          )
          if (linked.length === 0) continue
          const links = db
            .select({
              source: crawlUrlLinks.source,
              target: crawlUrlLinks.target,
              kind: crawlUrlLinks.kind,
              rendered: crawlUrlLinks.rendered,
              text: crawlUrlLinks.text,
              element: crawlUrlLinks.element,
              region: crawlUrlLinks.region,
              snippet: crawlUrlLinks.snippet,
            })
            .from(crawlUrlLinks)
            .where(
              and(
                eq(crawlUrlLinks.crawlRef, ref),
                or(
                  ...linked.map((row) =>
                    and(
                      eq(crawlUrlLinks.source, row.via!),
                      eq(crawlUrlLinks.target, row.seq!),
                      eq(crawlUrlLinks.kind, row.viaKind!),
                    ),
                  ),
                ),
              ),
            )
            .all()
          for (const row of linked) {
            const first = links.find(
              (link) =>
                link.source === row.via && link.target === row.seq && link.kind === row.viaKind,
            )
            if (!first) continue
            const context = toLinkContext(first)
            details.links[side].set(row.seq!, {
              kind: first.kind,
              rendered: first.rendered === 1,
              ...(context ? { context } : {}),
            })
          }
        }
        return details
      },

      async urlHistory({ domainId, crawlIds, urlHashes }) {
        if (crawlIds.length === 0 || urlHashes.length === 0) return []
        const owned: string[] = []
        const compact: string[] = []
        for (const batch of chunk(crawlIds, HISTORY_BATCH)) {
          const rows = db
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
            .all()
          for (const row of rows) (row.pruned ? compact : owned).push(row.id)
        }
        const kept: CrawlUrlTrace[] = []
        for (const ids of chunk(compact, HISTORY_BATCH)) {
          for (const hashes of chunk(urlHashes, HISTORY_BATCH)) {
            for (const row of db
              .select()
              .from(crawlUrlHistory)
              .where(
                and(
                  inArray(crawlUrlHistory.crawlId, ids),
                  inArray(crawlUrlHistory.urlHash, hashes),
                ),
              )
              .all()) {
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
                  details: crawlUrlAcceptedIssues.details,
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
            db.select().from(findingStates).where(eq(findingStates.domainId, domainId)).all(),
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

      async setThresholds({ domainId, thresholds }) {
        return changeRules(domainId, (_rows, _context, config) =>
          planThresholds(thresholds, thresholdsOf(config)),
        )
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

    botTests: {
      async start({ domainId, requestedBy }) {
        const id = randomUUID(),
          jobId = randomUUID(),
          now = new Date()
        try {
          db.transaction((tx) => {
            assertNotArchived(tx, domainId)
            tx.insert(jobs)
              .values({
                id: jobId,
                type: JOB_TYPES.botTest,
                payload: JSON.stringify({ runId: id }),
                runAt: now,
                createdAt: now,
                updatedAt: now,
              })
              .run()
            tx.insert(botTestRuns)
              .values({ id, jobId, domainId, requestedBy, activeKey: domainId, createdAt: now })
              .run()
          })
        } catch (error) {
          if (error instanceof DomainArchivedError) throw error
          if (await this.active(domainId)) return null
          throw error
        }
        return this.get(id)
      },
      async get(id) {
        return db.select().from(botTestRuns).where(eq(botTestRuns.id, id)).get() ?? null
      },
      async active(domainId) {
        return (
          db.select().from(botTestRuns).where(eq(botTestRuns.activeKey, domainId)).get() ?? null
        )
      },
      async list(domainId) {
        return db
          .select()
          .from(botTestRuns)
          .where(eq(botTestRuns.domainId, domainId))
          .orderBy(desc(botTestRuns.createdAt), desc(botTestRuns.id))
          .all()
      },
      async markRunning(id) {
        db.update(botTestRuns)
          .set({ status: 'running', startedAt: new Date() })
          .where(
            and(
              eq(botTestRuns.id, id),
              isNotNull(botTestRuns.activeKey),
              isNull(botTestRuns.startedAt),
            ),
          )
          .run()
      },
      async results(id) {
        const found = db.select().from(botTestResults).where(eq(botTestResults.runId, id)).all()
        return found.map((row) => ({
          ...row,
          reasons: JSON.parse(row.reasons) as BotTestResult['reasons'],
        }))
      },
      async record(input) {
        db.transaction((tx) => {
          const active = tx
            .select()
            .from(botTestRuns)
            .where(and(eq(botTestRuns.id, input.runId), isNotNull(botTestRuns.activeKey)))
            .get()
          if (!active) return
          tx.insert(botTestResults)
            .values({ ...input, reasons: JSON.stringify(input.reasons) })
            .onConflictDoNothing()
            .run()
        })
      },
      async finish(id, status) {
        db.transaction((tx) => {
          const current = tx
            .select()
            .from(botTestRuns)
            .where(and(eq(botTestRuns.id, id), isNotNull(botTestRuns.activeKey)))
            .get()
          if (!current) return
          tx.update(botTestRuns)
            .set({ status, activeKey: null, finishedAt: new Date() })
            .where(eq(botTestRuns.id, id))
            .run()
          const ended = tx
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
            .all()
          const old = ended.map((row) => row.id)
          if (old.length) {
            const removed = tx
              .select({ jobId: botTestRuns.jobId })
              .from(botTestRuns)
              .where(inArray(botTestRuns.id, old))
              .all()
            tx.delete(jobs)
              .where(
                inArray(
                  jobs.id,
                  removed.map((row) => row.jobId),
                ),
              )
              .run()
            tx.delete(botTestRuns).where(inArray(botTestRuns.id, old)).run()
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
          db.transaction((tx) => {
            assertNotArchived(tx, domainId)
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
          if (error instanceof DomainArchivedError) throw error
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
          for (const { row } of rows) found.push(toVerifiedUrl(row))
        }
        return newestVerifiedPerUrl(found)
      },

      async latestFinishedFor(domainId, urlHash) {
        const rows = db
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
          .all()
        return rows[0] ? toVerifiedUrl(rows[0].row) : null
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

    incidents: {
      async list(domainId, since) {
        return db
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
          .orderBy(desc(siteIncidents.openedAt))
          .all() as SiteIncident[]
      },
      async get(id) {
        const [row] = db.select().from(siteIncidents).where(eq(siteIncidents.id, id)).all()
        return (row as SiteIncident | undefined) ?? null
      },
      async claim(incidentId, userId, stage) {
        const rows = db
          .insert(incidentNotices)
          .values({ incidentId, userId, stage, createdAt: new Date() })
          .onConflictDoNothing()
          .returning()
          .all()
        return rows.length > 0
      },
      async release(incidentId, userId, stage) {
        db.delete(incidentNotices)
          .where(
            and(
              eq(incidentNotices.incidentId, incidentId),
              eq(incidentNotices.userId, userId),
              eq(incidentNotices.stage, stage),
            ),
          )
          .run()
      },
      async prune(before) {
        db.delete(siteIncidents).where(lt(siteIncidents.resolvedAt, before)).run()
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
        db.transaction((tx) => {
          recordFiles(tx, domainId, files)
        })
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
          .where(
            and(
              isNull(domains.archivedAt),
              or(isNull(crawlFileChecks.domainId), lte(crawlFileChecks.nextCheckAt, now)),
            ),
          )
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
      async finishCheck({ domainId, outcome, checkedAt, nextCheckAt, files = [] }) {
        db.transaction((tx) => {
          recordFiles(tx, domainId, files, { outcome, checkedAt, nextCheckAt })
        })
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
          .where(
            and(
              isNull(domains.archivedAt),
              or(isNull(domainFavicons.domainId), lte(domainFavicons.nextCheckAt, now)),
            ),
          )
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
