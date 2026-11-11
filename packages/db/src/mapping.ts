import { createHash, randomUUID } from 'node:crypto'
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
  type AnyColumn,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm'
import { ANY_ACCEPTED, parseFindingAcceptance } from '@seotools/core/crawl/acceptance'
import {
  ALERT_KINDS,
  JOB_TYPES,
  LINK_CONTEXT_LIMITS,
  LINK_REGIONS,
  MAX_DELIVERY_ERROR_LENGTH,
  MAX_VERIFICATION_URLS,
  alertLocaleOf,
  crawlUrlHash,
  enabledExtraFiles,
  extractorsSchema,
  isPageIssueId,
  isSecondaryFinding,
  parseAuditSnapshot,
  parseIssueEvidence,
  readUrlAuditState,
  serializeAuditSnapshot,
  sortedAlertKinds,
  statusRange,
  type AccessGrant,
  type AlertKind,
  type AlertLocale,
  type MailKind,
  type MailStatus,
  type AuditCondition,
  type AuditSnapshot,
  type ConditionObservation,
  type CrawlFileData,
  type CrawlPageData,
  type CrawlRobotsFiles,
  type CrawlSettings,
  type ExtraCrawlFileKind,
  type Job,
  type JobStatus,
  type LinkContext,
  type LinkDirection,
  type LinkRegion,
  type PagesAudit,
  type FieldChange,
  type PagesByWorstIssue,
  type PagesWithType,
  type Requirement,
  type UrlSnapshot,
  type CrawlUrlSource,
  type VerificationOutcome,
} from '@seotools/core'
import type {
  AlertSubscription,
  MailDelivery,
  Company,
  CompanyWithDomains,
  UserRecord,
  CrawlUrlAcceptedIssue,
  Crawl,
  PortfolioEntry,
  CrawlCounts,
  CrawlFile,
  CrawlFileCheck,
  CrawlLink,
  CrawlLinkQuery,
  CrawlLinkRow,
  CrawlSchedule,
  CrawlComparisonQuery,
  CrawlUrl,
  CrawlUrlAudit,
  CrawlUrlComparison,
  CrawlUrlIssue,
  CrawlUrlTrace,
  CrawlUrlQuery,
  CrawlUrlResult,
  CrawlUrlSort,
  CrawlUrlView,
  CrawlViewCounts,
  Domain,
  DomainFavicon,
  DomainUsage,
  FaviconImage,
  NewCrawlFile,
  NewCrawlUrl,
  NewVerificationUrl,
  SitemapHreflang,
  Verification,
  VerificationAnswer,
  VerifiedUrl,
} from './types'

export interface JobRow {
  id: string
  type: string
  payload: string
  status: JobStatus
  attempts: number
  maxAttempts: number
  runAt: Date
  lockedAt: Date | null
  lockedBy: string | null
  lastError: string | null
  result: string | null
  createdAt: Date
  updatedAt: Date
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export function toJob(row: JobRow): Job {
  return { ...row, payload: parseJson(row.payload) ?? {}, result: parseJson(row.result) }
}

export const MAX_ERROR_LENGTH = 2000
export const truncateError = (error: string) => error.slice(0, MAX_ERROR_LENGTH)

export const EMPTY_COUNTS: Record<JobStatus, number> = {
  pending: 0,
  running: 0,
  completed: 0,
  failed: 0,
}

export const CREDENTIAL_PROVIDER = 'credential'

// --- users ---------------------------------------------------------------
/** An account as a repository returns it. A role that is not known gives nothing extra. */
export function toUserRecord(
  row: {
    id: string
    name: string
    email: string
    role: string
    disabledAt: Date | null
    resetRequestedAt: Date | null
    createdAt: Date
  },
  hasPassword: boolean,
): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role === 'admin' ? 'admin' : 'member',
    disabledAt: row.disabledAt,
    hasPassword,
    resetRequestedAt: row.resetRequestedAt,
    createdAt: row.createdAt,
  }
}

/** A grant as stored. A role that is not known reads only. `null`: it says nothing it can act on. */
export function toAccessGrant(row: {
  role: string
  companyId: string | null
  domainId: string | null
}): AccessGrant | null {
  const role = row.role === 'editor' ? 'editor' : 'viewer'
  if (row.domainId) return { role, companyId: null, domainId: row.domainId }
  return row.companyId ? { role, companyId: row.companyId, domainId: null } : null
}

/** The grants of each user. */
export function foldGrants(
  rows: readonly {
    userId: string
    role: string
    companyId: string | null
    domainId: string | null
  }[],
): Map<string, AccessGrant[]> {
  const byUser = new Map<string, AccessGrant[]>()
  for (const row of rows) {
    const grant = toAccessGrant(row)
    if (grant) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), grant])
  }
  return byUser
}

export const accessRows = (userId: string, grants: readonly AccessGrant[]) =>
  grants.map(({ role, companyId, domainId }) => ({
    id: randomUUID(),
    userId,
    role,
    companyId,
    domainId,
  }))

/** Whether a change takes away the only administrator left, out of those who can sign in. */
export function removesLastAdmin(activeAdmins: readonly string[], id: string): boolean {
  return activeAdmins.length === 1 && activeAdmins[0] === id
}

const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/**
 * Nests domains under their company. Sorting happens here rather than in SQL because each
 * dialect collates text differently. Domains whose company is missing (deleted between the two
 * reads) are dropped.
 */
export function groupDomains(companies: Company[], domains: Domain[]): CompanyWithDomains[] {
  const byCompany = new Map<string, Domain[]>()
  for (const domain of domains) {
    const list = byCompany.get(domain.companyId)
    if (list) list.push(domain)
    else byCompany.set(domain.companyId, [domain])
  }
  return companies
    .map((company) => ({
      ...company,
      domains: (byCompany.get(company.id) ?? []).sort((a, b) =>
        a.host < b.host ? -1 : a.host > b.host ? 1 : 0,
      ),
    }))
    .sort((a, b) => byName.compare(a.name, b.name) || a.createdAt.getTime() - b.createdAt.getTime())
}

export type UsageCounts = Record<keyof DomainUsage, { domainId: string; n: number | string }[]>

/**
 * Puts the grouped counts of each kind of data into one `DomainUsage` per domain. Domains with
 * no rows of a kind have `0` of it; counts that arrive as strings (bigint drivers) are converted.
 */
export function foldUsage(
  domains: { id: string }[],
  counts: UsageCounts,
): Map<string, DomainUsage> {
  const usage = new Map<string, DomainUsage>()
  for (const { id } of domains) {
    usage.set(id, {
      crawls: 0,
      urls: 0,
      rules: 0,
      rechecks: 0,
      schedules: 0,
      priorityUrls: 0,
      crawlFiles: 0,
    })
  }
  for (const kind of Object.keys(counts) as (keyof DomainUsage)[]) {
    for (const { domainId, n } of counts[kind]) {
      const entry = usage.get(domainId)
      if (entry) entry[kind] = Number(n)
    }
  }
  return usage
}

// --- crawls --------------------------------------------------------------

export type CrawlRow = Omit<
  Crawl,
  'seedUrls' | 'robots' | 'pagesByWorstIssue' | 'pagesWithType' | 'pagesAudit' | 'auditSnapshot'
> & {
  seedUrls: string | null
  robots: string | null
  pagesWorstIssueCount: number | null
  pagesWorstWarningCount: number | null
  pagesWorstOpportunityCount: number | null
  pagesWithIssueCount: number | null
  pagesWithWarningCount: number | null
  pagesWithOpportunityCount: number | null
  pagesAuditedCount: number | null
  pagesExcludedCount: number | null
  pagesIndexableCount: number | null
  pagesNotIndexableCount: number | null
  pagesUnknownIndexabilityCount: number | null
  auditSnapshot: string | null
}
export type CrawlUrlRow = Omit<
  CrawlUrl,
  'data' | 'source' | 'scope' | 'kind' | 'state' | 'foundKind'
> & {
  foundKind: string | null
  data: string | null
  source: string
  scope: string
  kind: string
  state: string
}
export type CrawlScheduleRow = CrawlSchedule & { updatedAt: Date }

export const toCrawl = ({
  seedUrls,
  robots,
  pagesWorstIssueCount: issue,
  pagesWorstWarningCount: warning,
  pagesWorstOpportunityCount: opportunity,
  pagesWithIssueCount: withIssue,
  pagesWithWarningCount: withWarning,
  pagesWithOpportunityCount: withOpportunity,
  pagesAuditedCount: audited,
  pagesExcludedCount: excluded,
  pagesIndexableCount: indexable,
  pagesNotIndexableCount: notIndexable,
  pagesUnknownIndexabilityCount: unknownIndexability,
  auditSnapshot,
  ...row
}: CrawlRow): Crawl => ({
  ...row,
  pagesByWorstIssue:
    issue === null || warning === null || opportunity === null
      ? null
      : { issue, warning, opportunity },
  pagesWithType:
    withIssue === null || withWarning === null || withOpportunity === null
      ? null
      : { issue: withIssue, warning: withWarning, opportunity: withOpportunity },
  pagesAudit:
    audited === null ||
    excluded === null ||
    indexable === null ||
    notIndexable === null ||
    unknownIndexability === null
      ? null
      : { audited, excluded, indexable, notIndexable, unknownIndexability },
  auditSnapshot: parseAuditSnapshot(auditSnapshot),
  seedUrls: seedUrls === null ? null : (JSON.parse(seedUrls) as string[]),
  robots: robots === null ? null : (parseJson(robots) as CrawlRobotsFiles),
})

/** Groups the rows `portfolio` reads (newest first) and the domains with an active crawl. */
export function foldPortfolio(rows: CrawlRow[], active: { domainId: string }[]) {
  const entries = new Map<string, PortfolioEntry>()
  const entry = (domainId: string) => {
    let found = entries.get(domainId)
    if (!found) entries.set(domainId, (found = { crawls: [], running: false }))
    return found
  }
  for (const row of rows) entry(row.domainId).crawls.push(toCrawl(row))
  for (const { domainId } of active) entry(domainId).running = true
  return entries
}

/** The columns of `crawls` that an analysis writes: its totals and the configuration it used. */
export const crawlAnalysisColumns = (analysis: {
  pages: PagesByWorstIssue
  withType: PagesWithType
  catalog: string
  snapshot: AuditSnapshot
  audit: PagesAudit
}) => ({
  pagesWorstIssueCount: analysis.pages.issue,
  pagesWorstWarningCount: analysis.pages.warning,
  pagesWorstOpportunityCount: analysis.pages.opportunity,
  pagesWithIssueCount: analysis.withType.issue,
  pagesWithWarningCount: analysis.withType.warning,
  pagesWithOpportunityCount: analysis.withType.opportunity,
  pagesAuditedCount: analysis.audit.audited,
  pagesExcludedCount: analysis.audit.excluded,
  pagesIndexableCount: analysis.audit.indexable,
  pagesNotIndexableCount: analysis.audit.notIndexable,
  pagesUnknownIndexabilityCount: analysis.audit.unknownIndexability,
  issueCatalog: analysis.catalog,
  auditVersion: analysis.snapshot.version,
  auditSnapshot: serializeAuditSnapshot(analysis.snapshot),
})

/** Whether a stored analysis is newer than the one being saved, which must then be dropped. */
export const supersedes = (stored: number | null, saving: number) =>
  stored !== null && stored > saving

export const toCrawlUrl = ({ data, ...row }: CrawlUrlRow): CrawlUrl => ({
  ...(row as Omit<CrawlUrl, 'data'>),
  data: data === null ? null : (parseJson(data) as CrawlPageData),
})

export const toCrawlSchedule = ({
  updatedAt: _updatedAt,
  ...row
}: CrawlScheduleRow): CrawlSchedule => row

/** The job that runs a crawl, ready for insertion alongside it. */
export function crawlJobValues(crawlId: string, jobId: string, now: Date) {
  return {
    id: jobId,
    type: JOB_TYPES.crawlRun,
    payload: JSON.stringify({ crawlId }),
    runAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * The job that tells people about a full crawl that ended. Its id comes from the crawl, so a crawl has
 * one at most, and whatever removes the jobs of a crawl can find it without storing it.
 */
export function alertJobId(crawlId: string): string {
  const hex = createHash('sha256').update(`crawl.alerts:${crawlId}`, 'utf8').digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

export function alertJobValues(crawlId: string, now: Date) {
  return {
    id: alertJobId(crawlId),
    type: JOB_TYPES.crawlAlerts,
    payload: JSON.stringify({ crawlId }),
    runAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

// --- email and alerts ----------------------------------------------------
export const toMailDelivery = (row: {
  id: string
  kind: string
  recipient: string
  status: string
  error: string | null
  createdAt: Date
}): MailDelivery => ({ ...row, kind: row.kind as MailKind, status: row.status as MailStatus })

/** Attempts recorded in the same millisecond still have an order: the newest is the latest. */
let lastDeliveryAt = 0
const nextDeliveryAt = () => {
  lastDeliveryAt = Math.max(Date.now(), lastDeliveryAt + 1)
  return new Date(lastDeliveryAt)
}

export const mailDeliveryRow = (input: {
  kind: MailKind
  recipient: string
  status: MailStatus
  error?: string | null
}) => ({
  id: randomUUID(),
  kind: input.kind,
  recipient: cleanText(input.recipient, 254),
  status: input.status,
  error: input.error ? cleanText(input.error, MAX_DELIVERY_ERROR_LENGTH) : null,
  createdAt: nextDeliveryAt(),
})

interface AlertRow {
  userId: string
  domainId: string
  crawlProblem: boolean
  importantFindings: boolean
  changeSummary: boolean
  locale: string
  updatedAt: Date
}

export const toAlertSubscription = (row: AlertRow): AlertSubscription => ({
  userId: row.userId,
  domainId: row.domainId,
  kinds: sortedAlertKinds([
    ...(row.crawlProblem ? (['crawl-problem'] as const) : []),
    ...(row.importantFindings ? (['important-findings'] as const) : []),
    ...(row.changeSummary ? (['change-summary'] as const) : []),
  ]),
  locale: alertLocaleOf(row.locale),
  updatedAt: row.updatedAt,
})

/** The columns of a subscription for the kinds asked for. */
export const alertColumns = (kinds: readonly AlertKind[], locale: AlertLocale) => ({
  crawlProblem: kinds.includes('crawl-problem'),
  importantFindings: kinds.includes('important-findings'),
  changeSummary: kinds.includes('change-summary'),
  locale,
  updatedAt: new Date(),
})

/** Only kinds that exist, once each. */
export const knownAlertKinds = (kinds: readonly AlertKind[]) =>
  ALERT_KINDS.filter((kind) => kinds.includes(kind))

const MAX_TEXT_LENGTH = 2048
const MAX_CONTENT_TYPE_LENGTH = 255
const MAX_INT = 2_147_483_647

/**
 * Whatever a website sends ends up here, so it has to fit: control characters are removed (Postgres
 * refuses NUL in text) and values are cut to length, without splitting a surrogate pair.
 */
export function cleanText(value: string, max?: number): string
export function cleanText(value: string | null | undefined, max?: number): string | null
export function cleanText(value: string | null | undefined, max = MAX_TEXT_LENGTH): string | null {
  if (value === null || value === undefined) return null
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const cut = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max)
  // `slice` may have cut an emoji in half, and a lone surrogate is not valid UTF-8.
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut
}

/** The values of a result as columns, trimmed to what the database accepts. */
export function crawlResultColumns(result: CrawlUrlResult, now: Date) {
  return {
    state: 'done' as const,
    kind: result.kind,
    statusCode: result.statusCode,
    contentType: cleanText(result.contentType, MAX_CONTENT_TYPE_LENGTH),
    redirectTo: result.redirectTo,
    title: cleanText(result.title),
    metaRobots: cleanText(result.metaRobots),
    xRobotsTag: cleanText(result.xRobotsTag),
    canonical: cleanText(result.canonical),
    responseTimeMs:
      result.responseTimeMs === null ? null : Math.min(result.responseTimeMs, MAX_INT),
    bytes: result.bytes === null ? null : Math.min(result.bytes, MAX_INT),
    error: result.error === null ? null : truncateError(cleanText(result.error)),
    data: result.data === null ? null : JSON.stringify(result.data),
    fetchedAt: now,
  }
}

export const crawlRobotsColumn = (robots: CrawlRobotsFiles) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(robots).map(([origin, { status, body }]) => [
        origin,
        { status, body: cleanText(body, Number.MAX_SAFE_INTEGER) },
      ]),
    ),
  )

/** External URLs are recorded, not crawled, so they don't enter the queue. */
export const newCrawlUrlRow = (crawlId: string, { notRequested, ...url }: NewCrawlUrl) => ({
  crawlId,
  ...url,
  data: notRequested ? JSON.stringify({ notRequested }) : null,
  state: url.scope === 'internal' && !notRequested ? ('queued' as const) : ('skipped' as const),
})

/** A link as a row of `crawl_url_links`: its ends by `seq`, its crawl by `ref`, its context bounded. */
export function newCrawlLinkRow(crawlRef: number, source: number, target: number, link: CrawlLink) {
  const { context } = link
  return {
    crawlRef,
    source,
    target,
    kind: link.kind,
    text: cleanText(context?.text, LINK_CONTEXT_LIMITS.text),
    element: cleanText(context?.element, LINK_CONTEXT_LIMITS.element),
    region: context?.region && LINK_REGIONS.includes(context.region) ? context.region : null,
    snippet: cleanText(context?.snippet, LINK_CONTEXT_LIMITS.snippet),
  }
}

/** The context of a stored link, or `null` when none was kept. */
export function toLinkContext(row: {
  text: string | null
  element: string | null
  region: string | null
  snippet: string | null
}): LinkContext | null {
  const context: LinkContext = {
    ...(row.text ? { text: row.text } : {}),
    ...(row.element ? { element: row.element } : {}),
    ...(row.region && (LINK_REGIONS as readonly string[]).includes(row.region)
      ? { region: row.region as LinkRegion }
      : {}),
    ...(row.snippet ? { snippet: row.snippet } : {}),
  }
  return Object.keys(context).length > 0 ? context : null
}

export function priorityUrlRow(domainId: string, url: string, now: Date) {
  return { domainId, url, urlHash: crawlUrlHash(url), createdAt: now }
}

/** Folds `count(*) group by scope, kind, state` into the counters of a crawl. */
export function foldCrawlCounts(
  rows: { scope: string; kind: string; state: string; statusCode: number | null; count: unknown }[],
): CrawlCounts {
  const counts: CrawlCounts = { pagesCount: 0, urlsCount: 0, urlsDoneCount: 0, externalCount: 0 }
  for (const row of rows) {
    const count = Number(row.count)
    if (row.scope === 'external') {
      counts.externalCount += count
      continue
    }
    counts.urlsCount += count
    if (row.state === 'done') counts.urlsDoneCount += count
    if (isPage(row)) counts.pagesCount += count
  }
  return counts
}

/** A URL of the site counted as a page: it answered with HTML and a 2xx (`URL_VIEWS`). */
const isPage = (row: { kind: string; statusCode: number | null }) =>
  row.kind === 'page' && row.statusCode !== null && row.statusCode >= 200 && row.statusCode < 300

/** A URL of the site that answered 4xx/5xx or did not answer, whatever it was meant to be. */
const isError = (row: { kind: string; state: string; statusCode: number | null }) =>
  row.state === 'done' &&
  row.kind !== 'redirect' &&
  (row.statusCode === null || row.statusCode >= 400)

/** Folds `count(*) group by scope, kind` into how many URLs each view starts from. */
export function foldViewCounts(
  rows: { scope: string; kind: string; state: string; statusCode: number | null; count: unknown }[],
) {
  const counts: CrawlViewCounts = {
    pages: 0,
    resources: 0,
    redirects: 0,
    errors: 0,
    other: 0,
    external: 0,
    all: 0,
  }
  for (const row of rows) {
    const count = Number(row.count)
    counts.all += count
    if (row.scope === 'external') {
      counts.external += count
      continue
    }
    if (isPage(row)) counts.pages += count
    else counts.other += count
    if (row.kind === 'resource' && row.statusCode !== null && row.statusCode < 400) {
      counts.resources += count
    }
    if (row.kind === 'redirect') counts.redirects += count
    if (isError(row)) counts.errors += count
  }
  return counts
}

/** The columns of `crawl_urls` that listing, filtering and ordering URLs look at. */
export interface CrawlUrlColumns extends Record<Exclude<CrawlUrlSort, 'referencedBy'>, AnyColumn> {
  crawlId: AnyColumn
  state: AnyColumn
  scope: AnyColumn
  kind: AnyColumn
  urlHash: AnyColumn
}

/** `like` has no escape character by default in SQLite, so every dialect gets this one. */
const LIKE_ESCAPE = '!'
const containsPattern = (text: string) =>
  `%${text.toLowerCase().replace(/[!%_]/g, `${LIKE_ESCAPE}$&`)}%`

/** The columns of `crawl_url_audit` that filtering looks at. */
export interface CrawlAuditColumns {
  crawlId: AnyColumn
  urlHash: AnyColumn
  participation: AnyColumn
  intent: AnyColumn
  indexability: AnyColumn
  participationRule: AnyColumn
  intentRule: AnyColumn
  noindexRule: AnyColumn
  nofollowRule: AnyColumn
  robotsRule: AnyColumn
  sitemapRule: AnyColumn
}

type AuditFilter = Pick<CrawlUrlQuery, 'participation' | 'intent' | 'rule' | 'indexability'>
/** Every column that names the rule that decided something about a URL. */
export const auditRuleColumns = (columns: CrawlAuditColumns): AnyColumn[] => [
  columns.participationRule,
  columns.intentRule,
  columns.noindexRule,
  columns.nofollowRule,
  columns.robotsRule,
  columns.sitemapRule,
]

export const hasAuditFilter = (query: AuditFilter) =>
  Boolean(query.participation || query.intent || query.rule || query.indexability)

/** Selects the rows of `crawl_url_audit` that a filter keeps. */
export function crawlAuditWhere(
  columns: CrawlAuditColumns,
  crawlId: string,
  filter: AuditFilter,
): SQL | undefined {
  return and(
    eq(columns.crawlId, crawlId),
    filter.participation ? eq(columns.participation, filter.participation) : undefined,
    filter.intent ? eq(columns.intent, filter.intent) : undefined,
    filter.indexability ? eq(columns.indexability, filter.indexability) : undefined,
    filter.rule
      ? or(...auditRuleColumns(columns).map((column) => eq(column, filter.rule!)))
      : undefined,
  )
}

/** What a view starts from: URLs of the site or external ones, and what they turned out to be. */
export function crawlViewWhere(columns: CrawlUrlColumns, view: CrawlUrlView): SQL | undefined {
  switch (view) {
    case 'pages':
      return and(
        eq(columns.scope, 'internal'),
        eq(columns.kind, 'page'),
        gte(columns.status, 200),
        lt(columns.status, 300),
      )
    case 'resources':
      return and(
        eq(columns.scope, 'internal'),
        eq(columns.kind, 'resource'),
        lt(columns.status, 400),
      )
    case 'redirects':
      return and(eq(columns.scope, 'internal'), eq(columns.kind, 'redirect'))
    case 'errors':
      return and(
        eq(columns.scope, 'internal'),
        eq(columns.state, 'done'),
        ne(columns.kind, 'redirect'),
        or(gte(columns.status, 400), isNull(columns.status)),
      )
    case 'other':
      // Everything of the site that is not a page: together with `pages`, every URL of the site.
      return and(
        eq(columns.scope, 'internal'),
        or(
          ne(columns.kind, 'page'),
          isNull(columns.status),
          lt(columns.status, 200),
          gte(columns.status, 300),
        ),
      )
    case 'external':
      return eq(columns.scope, 'external')
    case 'all':
      return undefined
  }
}

/** The URLs whose status is of a class, or that have none. */
export function crawlStatusWhere(
  columns: CrawlUrlColumns,
  status: NonNullable<CrawlUrlQuery['status']>,
): SQL | undefined {
  if (status === 'none') return isNull(columns.status)
  const { min, max } = statusRange(status)
  return and(gte(columns.status, min), lt(columns.status, max))
}

/**
 * The condition that selects the URLs of a query. `subqueries` build, for the dialect (they need its
 * own `db`), the hashes of the URLs that have `query.issue` and those that pass the audit filters.
 */
export function crawlUrlWhere(
  columns: CrawlUrlColumns,
  query: CrawlUrlQuery,
  subqueries: {
    withIssue: (issue: string) => SQLWrapper
    /** The hashes of the URLs with an accepted finding: this issue, or any when it is `null`. */
    withAccepted: (issue: string | null) => SQLWrapper
    withAudit: (filter: AuditFilter) => SQLWrapper
  },
): SQL | undefined {
  const pattern = query.search ? containsPattern(query.search) : null
  return and(
    eq(columns.crawlId, query.crawlId),
    // An issue picks its URLs wherever they are: a redirect or a broken link is not a page.
    query.issue || query.accepted ? undefined : crawlViewWhere(columns, query.view),
    query.status ? crawlStatusWhere(columns, query.status) : undefined,
    // A type is a fact about the URLs of the site: external ones are recorded, never typed.
    query.type ? and(eq(columns.scope, 'internal'), eq(columns.kind, query.type)) : undefined,
    pattern
      ? sql`(lower(${columns.url}) like ${pattern} escape '!' or lower(${columns.title}) like ${pattern} escape '!')`
      : undefined,
    query.issue ? inArray(columns.urlHash, subqueries.withIssue(query.issue)) : undefined,
    query.accepted
      ? inArray(
          columns.urlHash,
          subqueries.withAccepted(query.accepted === ANY_ACCEPTED ? null : query.accepted),
        )
      : undefined,
    hasAuditFilter(query) ? inArray(columns.urlHash, subqueries.withAudit(query)) : undefined,
  )
}

/**
 * Shallowest first by default. URLs without a value (a title that is missing, a request that never
 * answered) go last whatever the direction, since each dialect sorts NULLs differently.
 *
 * The order is total: the hash decides between two addresses that a dialect's collation may
 * consider the same (`/A` and `/a`), so that pages of a list, and an export that walks all of
 * them, never repeat or skip a URL.
 */
export function crawlUrlOrder(
  columns: CrawlUrlColumns,
  sort: CrawlUrlSort = 'depth',
  direction: 'asc' | 'desc' = 'asc',
): SQL[] {
  const column = columns[sort === 'referencedBy' ? 'url' : sort]
  return [
    asc(sql`${column} is null`),
    (direction === 'desc' ? desc : asc)(column),
    asc(columns.url),
    asc(columns.urlHash),
  ]
}

/** The columns of `crawl_url_links` that listing the links of a URL looks at. */
export interface CrawlLinkColumns {
  crawlRef: AnyColumn
  source: AnyColumn
  target: AnyColumn
  kind: AnyColumn
}

/** Where the links of one URL of a crawl are: the crawl's `ref` and the URL's `seq`. */
export interface LinkScope {
  ref: number
  seq: number
}

/**
 * The two ends of a link as a list of one URL sees them: `self` is the end that is the URL the
 * list is about, `other` the end each row shows (where an incoming link starts, where an outgoing
 * one points).
 */
export function crawlLinkEnds(columns: CrawlLinkColumns, direction: LinkDirection) {
  return direction === 'in'
    ? { self: columns.target, other: columns.source }
    : { self: columns.source, other: columns.target }
}

/** Joins each link to the `crawl_urls` row of its other end, within the same crawl. */
export const crawlLinkJoin = (
  columns: CrawlLinkColumns,
  urls: { crawlId: AnyColumn; seq: AnyColumn },
  direction: LinkDirection,
  crawlId: string,
) => and(eq(urls.crawlId, crawlId), eq(urls.seq, crawlLinkEnds(columns, direction).other))

/**
 * The condition that selects the links of a query, within its crawl. `otherUrl` is the address of
 * the `crawl_urls` row at the other end (see `crawlLinkJoin`), which is what a search looks at.
 * An empty list of `kinds` is for the caller to answer with nothing.
 */
export function crawlLinkWhere(
  columns: CrawlLinkColumns,
  otherUrl: AnyColumn,
  query: Omit<CrawlLinkQuery, 'crawlId' | 'urlHash'>,
  scope: LinkScope,
): SQL | undefined {
  const pattern = query.search ? containsPattern(query.search) : null
  return and(
    eq(columns.crawlRef, scope.ref),
    eq(crawlLinkEnds(columns, query.direction).self, scope.seq),
    query.kinds ? inArray(columns.kind, [...query.kinds]) : undefined,
    pattern ? sql`lower(${otherUrl}) like ${pattern} escape '!'` : undefined,
  )
}

/**
 * Pages of links must not repeat or skip a row, so the order has to be total: by address, and the
 * hash decides between two addresses a dialect's collation may consider the same (`/A` and `/a`).
 */
export const crawlLinkOrder = (otherUrl: AnyColumn, otherHash: AnyColumn, kind: AnyColumn) => [
  asc(otherUrl),
  asc(otherHash),
  asc(kind),
]

/** A row of `listLinks`, as the repository returns it. */
export const toCrawlLinkRow = ({
  text,
  element,
  region,
  snippet,
  ...row
}: {
  url: string
  urlHash: string
  kind: string
  scope: string
  urlKind: string
  state: string
  statusCode: number | null
  error: string | null
  text: string | null
  element: string | null
  region: string | null
  snippet: string | null
}): CrawlLinkRow =>
  ({ ...row, context: toLinkContext({ text, element, region, snippet }) }) as CrawlLinkRow

/**
 * What a URL of a crawl was, compact: the row of `crawl_url_history` that keeps it once its
 * results per URL are removed. `audit` is the row `crawlAuditRows` writes, read back with
 * `toCrawlUrlAudit`.
 */
export function crawlHistoryRow(
  crawlId: string,
  url: SnapshotRow & { urlHash: string; url: string },
  issues: readonly string[],
  accepted: readonly string[],
  audit: Omit<ReturnType<typeof crawlAuditRows>[number], 'crawlId'> | null,
) {
  return {
    crawlId,
    urlHash: url.urlHash,
    url: url.url,
    state: url.state ?? 'queued',
    kind: url.kind ?? 'unknown',
    statusCode: url.statusCode,
    redirectTo: url.redirectTo,
    title: url.title,
    canonical: url.canonical,
    metaRobots: url.metaRobots,
    xRobotsTag: url.xRobotsTag,
    error: url.error,
    depth: url.depth ?? 0,
    issues: issues.length > 0 ? JSON.stringify([...new Set(issues)]) : null,
    accepted: accepted.length > 0 ? JSON.stringify([...new Set(accepted)]) : null,
    audit: audit ? JSON.stringify(audit) : null,
  }
}

/** Folds issue counts by the URL's indexability into what is pending and what is secondary. */
export function foldIssueCounts(
  rows: { issue: string; indexability: string | null; pages: unknown }[],
): { issue: string; pages: number; secondary: number }[] {
  const counts = new Map<string, { issue: string; pages: number; secondary: number }>()
  for (const row of rows) {
    const entry = counts.get(row.issue) ?? { issue: row.issue, pages: 0, secondary: 0 }
    const secondary = isPageIssueId(row.issue) && isSecondaryFinding(row.issue, row.indexability)
    if (secondary) entry.secondary += Number(row.pages)
    else entry.pages += Number(row.pages)
    counts.set(row.issue, entry)
  }
  return [...counts.values()]
}

/** Issues by URL, as the history keeps them. */
export function groupIssues(rows: { urlHash: string; issue: string }[]) {
  const grouped = new Map<string, string[]>()
  for (const { urlHash, issue } of rows)
    grouped.set(urlHash, [...(grouped.get(urlHash) ?? []), issue])
  return grouped
}

const DAY_MS = 86_400_000

/**
 * Whether the compact history of a crawl is past its domain's `historyDays`: the default when the
 * domain saved no settings (`saved` is null), never when it chose to keep it (`days` is null).
 */
export function historyExpired(
  row: { finishedAt: Date | null; createdAt: Date; saved: string | null; days: number | null },
  now: Date,
  defaultDays: number,
): boolean {
  const days = row.saved === null ? defaultDays : row.days
  if (days === null) return false
  return (row.finishedAt ?? row.createdAt).getTime() < now.getTime() - days * DAY_MS
}

/** A row of `crawl_url_history` as the trace of a URL in that crawl (see `foldTraces`). */
export function historyTrace(row: {
  crawlId: string
  urlHash: string
  url: string
  state: string
  kind: string
  statusCode: number | null
  redirectTo: string | null
  title: string | null
  canonical: string | null
  metaRobots: string | null
  xRobotsTag: string | null
  error: string | null
  depth: number
  issues: string | null
  accepted: string | null
  audit: string | null
}): CrawlUrlTrace | null {
  const snapshot = toUrlSnapshot(row)
  if (!snapshot) return null
  const list = (raw: string | null) => {
    const parsed = raw === null ? [] : parseJson(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  }
  const audit = row.audit === null ? null : parseJson(row.audit)
  return {
    crawlId: row.crawlId,
    urlHash: row.urlHash,
    url: row.url,
    snapshot,
    issues: list(row.issues).map((issue) => ({ urlHash: row.urlHash, issue })),
    accepted: list(row.accepted),
    audit:
      audit && typeof audit === 'object'
        ? toCrawlUrlAudit({
            ...(audit as Parameters<typeof toCrawlUrlAudit>[0]),
            urlHash: row.urlHash,
          })
        : null,
  }
}

/**
 * What an issue row keeps in its `details` column. Rows written before evidence existed hold a JSON
 * array of strings, and rows without evidence still do: only a finding with evidence is an object,
 * `{ details?, evidence }`, so nothing already stored changes meaning.
 */
export function serializeIssueDetails(issue: CrawlUrlIssue): string | null {
  const details = issue.details?.length ? issue.details : undefined
  if (issue.evidence) {
    return JSON.stringify({ ...(details ? { details } : {}), evidence: issue.evidence })
  }
  return details ? JSON.stringify(details) : null
}

/** The inverse of `serializeIssueDetails`. Evidence that does not check out is left out. */
export function parseIssueDetails(
  stored: string | null,
): Pick<CrawlUrlIssue, 'details' | 'evidence'> {
  if (stored === null) return {}
  const value = parseJson(stored) as unknown
  if (Array.isArray(value)) return { details: value as string[] }
  if (typeof value !== 'object' || value === null) return {}
  const { details, evidence } = value as { details?: unknown; evidence?: unknown }
  const parsed = parseIssueEvidence(evidence)
  return {
    ...(Array.isArray(details) ? { details: details as string[] } : {}),
    ...(parsed ? { evidence: parsed } : {}),
  }
}

/** One row per URL and issue: asking twice for the same one is not an error. */
export function crawlIssueRows(crawlId: string, issues: CrawlUrlIssue[]) {
  const unique = new Map<string, CrawlUrlIssue>()
  for (const issue of issues) unique.set(`${issue.urlHash}:${issue.issue}`, issue)
  return [...unique.values()].map((issue) => ({
    crawlId,
    urlHash: issue.urlHash,
    issue: issue.issue,
    details: serializeIssueDetails(issue),
  }))
}

export const toCrawlUrlIssue = (row: {
  urlHash: string
  issue: string
  details: string | null
}): CrawlUrlIssue => ({
  urlHash: row.urlHash,
  issue: row.issue,
  ...parseIssueDetails(row.details),
})

/** One row per URL, issue and URL that accepts it. */
export function crawlAcceptedRows(crawlId: string, accepted: readonly CrawlUrlAcceptedIssue[]) {
  const unique = new Map<string, CrawlUrlAcceptedIssue>()
  for (const finding of accepted) {
    unique.set(`${finding.urlHash}:${finding.issue}:${finding.acceptedBy}`, finding)
  }
  return [...unique.values()].map(
    ({ urlHash, issue, acceptedBy, acceptance, details, evidence }) => ({
      crawlId,
      urlHash,
      issue,
      acceptedBy,
      details: JSON.stringify({
        acceptance,
        ...(details?.length ? { details } : {}),
        ...(evidence ? { evidence } : {}),
      }),
    }),
  )
}

/** The inverse of `crawlAcceptedRows`. `null`: what is stored does not say what accepted it. */
export function toCrawlUrlAcceptedIssue(row: {
  urlHash: string
  issue: string
  acceptedBy: string
  details: string
}): CrawlUrlAcceptedIssue | null {
  const stored = parseJson(row.details) as { acceptance?: unknown } | null
  const acceptance = parseFindingAcceptance(stored?.acceptance)
  if (!acceptance) return null
  return {
    urlHash: row.urlHash,
    issue: row.issue,
    acceptedBy: row.acceptedBy,
    acceptance,
    ...parseIssueDetails(row.details),
  }
}

/** One row per internal URL of an analysis. */
export function crawlAuditRows(crawlId: string, urls: CrawlUrlAudit[]) {
  const unique = new Map<string, CrawlUrlAudit>()
  for (const url of urls) unique.set(url.urlHash, url)
  return [...unique.values()].map((url) => ({
    crawlId,
    urlHash: url.urlHash,
    participation: url.participation,
    participationRule: url.participationRule,
    intent: url.intent,
    intentRule: url.intentRule,
    // Retired with semantics 3: it is the `nofollow` condition being `allowed` now.
    acceptNofollow: false,
    ...conditionColumns(url.conditions),
    indexability: url.indexability,
    blockers: url.blockers.length > 0 ? JSON.stringify(url.blockers) : null,
  }))
}

/** The conditions a rule stated for a URL, as columns: `null` for the ones nothing states. */
function conditionColumns(conditions: CrawlUrlAudit['conditions']) {
  const column = (condition: AuditCondition) => {
    const state = conditions[condition]
    return {
      requirement: state?.requirement ?? null,
      rule: state?.rule ?? null,
      observed: state?.observed ?? null,
    }
  }
  const {
    requirement: noindexRequirement,
    rule: noindexRule,
    observed: noindexObserved,
  } = column('noindex')
  const {
    requirement: nofollowRequirement,
    rule: nofollowRule,
    observed: nofollowObserved,
  } = column('nofollow')
  const {
    requirement: robotsRequirement,
    rule: robotsRule,
    observed: robotsObserved,
  } = column('robots')
  const {
    requirement: sitemapRequirement,
    rule: sitemapRule,
    observed: sitemapObserved,
  } = column('sitemap')
  return {
    noindexRequirement,
    noindexRule,
    noindexObserved,
    nofollowRequirement,
    nofollowRule,
    nofollowObserved,
    robotsRequirement,
    robotsRule,
    robotsObserved,
    sitemapRequirement,
    sitemapRule,
    sitemapObserved,
  }
}

type ConditionColumns = ReturnType<typeof conditionColumns>

export const toCrawlUrlAudit = (
  row: {
    urlHash: string
    participation: string
    participationRule: string | null
    intent: string
    intentRule: string | null
    acceptNofollow: boolean
    indexability: string
    blockers: string | null
  } & ConditionColumns,
): CrawlUrlAudit => {
  const conditions: CrawlUrlAudit['conditions'] = {}
  const read = (
    condition: AuditCondition,
    requirement: string | null,
    rule: string | null,
    observed: string | null,
  ) => {
    if (requirement === null) return
    conditions[condition] = {
      requirement: requirement as Requirement,
      rule,
      observed: observed as ConditionObservation | null,
    }
  }
  read('noindex', row.noindexRequirement, row.noindexRule, row.noindexObserved)
  read('nofollow', row.nofollowRequirement, row.nofollowRule, row.nofollowObserved)
  read('robots', row.robotsRequirement, row.robotsRule, row.robotsObserved)
  read('sitemap', row.sitemapRequirement, row.sitemapRule, row.sitemapObserved)
  // What an analysis of semantics 2 kept as an accepted `nofollow` is the condition being allowed.
  return readUrlAuditState({
    urlHash: row.urlHash,
    participation: row.participation as CrawlUrlAudit['participation'],
    participationRule: row.participationRule,
    intent: row.intent as CrawlUrlAudit['intent'],
    intentRule: row.intentRule,
    acceptNofollow: row.acceptNofollow,
    conditions,
    indexability: row.indexability as CrawlUrlAudit['indexability'],
    blockers: row.blockers === null ? [] : (parseJson(row.blockers) as string[]),
  })
}

/** Folds the rows of a count by rule, for either dimension, into one count per rule. */
export function foldRuleCounts(
  rows: { rule: string | null; count: unknown }[],
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const { rule, count } of rows) {
    if (rule !== null) counts.set(rule, (counts.get(rule) ?? 0) + Number(count))
  }
  return counts
}

const MAX_HREFLANG_LENGTH = 35

/** Whatever a sitemap declares has to fit, and the same alternate twice is one row. */
export const sitemapHreflangRow = (crawlId: string, entry: SitemapHreflang) => ({
  crawlId,
  pageHash: entry.pageHash,
  lang: cleanText(entry.lang, MAX_HREFLANG_LENGTH),
  targetHash: crawlUrlHash(entry.url),
  url: entry.url,
})

/** Multi-row inserts are split so they stay under every driver's parameter limit. */
export function chunk<T>(items: T[], size = 500): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/** Keeps the most recently fetched result of each URL. */
export function newestPerUrl(rows: CrawlUrl[]): CrawlUrl[] {
  const newest = new Map<string, CrawlUrl>()
  for (const row of rows) {
    const current = newest.get(row.urlHash)
    if (!current || (row.fetchedAt?.getTime() ?? 0) > (current.fetchedAt?.getTime() ?? 0)) {
      newest.set(row.urlHash, row)
    }
  }
  return [...newest.values()]
}

/** The columns of `domain_favicons` for a check's outcome; `icon: null` is "the site has none". */
export function faviconRow(domainId: string, icon: FaviconImage | null, nextCheckAt: Date) {
  return {
    domainId,
    contentType: icon?.contentType ?? null,
    data: icon ? icon.data.toString('base64') : null,
    hash: icon ? createHash('sha256').update(icon.data).digest('hex').slice(0, 16) : null,
    sourceUrl: icon?.sourceUrl ?? null,
    nextCheckAt,
  }
}

export function toDomainFavicon(row: {
  domainId: string
  contentType: string | null
  data: string | null
  hash: string | null
  sourceUrl: string | null
}): DomainFavicon | null {
  if (row.data === null || row.contentType === null || row.hash === null) return null
  return {
    domainId: row.domainId,
    contentType: row.contentType,
    data: Buffer.from(row.data, 'base64'),
    hash: row.hash,
    sourceUrl: row.sourceUrl ?? '',
  }
}

// --- crawl settings ------------------------------------------------------

export type CrawlSettingsRow = Omit<
  CrawlSettings,
  'optionalFiles' | 'includePrefixes' | 'excludePrefixes' | 'extractors'
> & {
  optionalFiles: string | null
  extractors: string | null
  requestSecrets: string | null
  includePrefixes: string | null
  excludePrefixes: string | null
  domainId: string
  updatedAt: Date
}

export const toCrawlSettings = ({
  domainId: _domainId,
  updatedAt: _updatedAt,
  optionalFiles,
  requestSecrets: _requestSecrets,
  includePrefixes,
  excludePrefixes,
  extractors,
  ...row
}: CrawlSettingsRow): CrawlSettings => ({
  ...row,
  // Read back through its schema: an extractor that no longer checks out is dropped, not run.
  extractors: extractorsSchema.catch([]).parse(parseJson(extractors) ?? []),
  includePrefixes: (parseJson(includePrefixes) ?? []) as string[],
  excludePrefixes: (parseJson(excludePrefixes) ?? []) as string[],
  optionalFiles: (parseJson(optionalFiles) ?? []) as CrawlSettings['optionalFiles'],
})

/** The extra crawl files turned on in each stored settings row, leaving out rows with none. */
export function enabledFilesByDomain(rows: CrawlSettingsRow[]): Map<string, ExtraCrawlFileKind[]> {
  const enabled = new Map<string, ExtraCrawlFileKind[]>()
  for (const row of rows) {
    const kinds = enabledExtraFiles(toCrawlSettings(row))
    if (kinds.length > 0) enabled.set(row.domainId, kinds)
  }
  return enabled
}

export const crawlSettingsColumns = ({
  optionalFiles,
  includePrefixes,
  excludePrefixes,
  extractors,
  ...settings
}: CrawlSettings) => ({
  ...settings,
  extractors: extractors.length > 0 ? JSON.stringify(extractors) : null,
  optionalFiles: JSON.stringify(optionalFiles),
  includePrefixes: JSON.stringify(includePrefixes),
  excludePrefixes: JSON.stringify(excludePrefixes),
})

// --- crawl files ---------------------------------------------------------

/** Sorted here rather than in SQL because each dialect collates text differently. */
export const byUrl = (a: { url: string }, b: { url: string }) =>
  a.url < b.url ? -1 : a.url > b.url ? 1 : 0

export type CrawlFileRow = Omit<CrawlFile, 'data' | 'kind'> & { data: string | null; kind: string }

export const toCrawlFile = ({ data, ...row }: CrawlFileRow): CrawlFile => ({
  ...(row as Omit<CrawlFile, 'data'>),
  data: data === null ? null : (parseJson(data) as CrawlFileData),
})

export const toCrawlFileCheck = (row: {
  domainId: string
  nextCheckAt: Date
  requestedAt: Date | null
  checkedAt: Date | null
  outcome: string | null
}): CrawlFileCheck => row as CrawlFileCheck

/** Everything but the key: what replaces the row of a URL. Whatever the site sent has to fit. */
export function crawlFileColumns(file: NewCrawlFile) {
  return {
    url: file.url,
    kind: file.kind,
    statusCode: file.statusCode,
    contentType: cleanText(file.contentType, MAX_CONTENT_TYPE_LENGTH),
    redirectTo: file.redirectTo,
    bytes: file.bytes === null ? null : Math.min(file.bytes, MAX_INT),
    truncated: file.truncated,
    body: cleanText(file.body, Number.MAX_SAFE_INTEGER),
    error: file.error === null ? null : truncateError(cleanText(file.error)),
    data: file.data === null ? null : JSON.stringify(file.data),
    via: file.via,
    fetchedAt: file.fetchedAt,
  }
}

export const crawlFileRow = (domainId: string, file: NewCrawlFile) => ({
  domainId,
  urlHash: crawlUrlHash(file.url),
  ...crawlFileColumns(file),
})

// --- comparing crawls ---------------------------------------------------------------------------

/** The columns of `crawl_urls` a comparison looks at. One set for each side of the join. */
export interface CompareColumns {
  crawlId: AnyColumn
  urlHash: AnyColumn
  url: AnyColumn
  scope: AnyColumn
  state: AnyColumn
  kind: AnyColumn
  statusCode: AnyColumn
  redirectTo: AnyColumn
  title: AnyColumn
  canonical: AnyColumn
  metaRobots: AnyColumn
  xRobotsTag: AnyColumn
  error: AnyColumn
  depth: AnyColumn
}

/** Whether two columns hold different values, `null` against a value included. `text`: exactly. */
export type Differs = (a: AnyColumn, b: AnyColumn, text?: boolean) => SQL

export const sqliteDiffers: Differs = (a, b) => sql`${a} is not ${b}`
export const pgDiffers: Differs = (a, b) => sql`${a} is distinct from ${b}`

/** What the findings of two crawls differ in, for a dialect to build (they need its own `db`). */
export interface FindingDifferences {
  /** The URL has an issue in the later crawl that the earlier one does not report for it. */
  gained: (issue?: string) => SQL
  /** The URL has an issue in the earlier crawl that the later one does not report for it. */
  lost: (issue?: string) => SQL
}

const anyOf = (conditions: SQL[]): SQL => sql`(${sql.join(conditions, sql` or `)})`

/** The condition for a URL that both crawls requested to have changed the way `change` says. */
export function changeCondition(
  change: FieldChange | 'gained' | 'lost',
  columns: { target: CompareColumns; base: CompareColumns },
  differs: Differs,
  findings: FindingDifferences,
  issue?: string,
): SQL {
  const { target: t, base: b } = columns
  switch (change) {
    case 'status':
      return anyOf([
        differs(t.statusCode, b.statusCode),
        differs(t.kind, b.kind, true),
        differs(t.redirectTo, b.redirectTo, true),
      ])
    case 'title':
      return differs(t.title, b.title, true)
    case 'canonical':
      return differs(t.canonical, b.canonical, true)
    case 'robots':
      return anyOf([
        differs(t.metaRobots, b.metaRobots, true),
        differs(t.xRobotsTag, b.xRobotsTag, true),
      ])
    case 'gained':
      return findings.gained(issue)
    case 'lost':
      return findings.lost(issue)
  }
}

type PageColumns = { kind: AnyColumn; statusCode: AnyColumn }

/** A page: HTML that answered 2xx (`URL_VIEWS`), as the listing counts them. */
const isPageSql = ({ kind, statusCode }: PageColumns) =>
  and(eq(kind, 'page'), gte(statusCode, 200), lt(statusCode, 300))
const notPageSql = ({ kind, statusCode }: PageColumns) =>
  or(ne(kind, 'page'), isNull(statusCode), lt(statusCode, 200), gte(statusCode, 300))

/** URLs that are pages (`pages`) or are not (`other`) in the crawl they come from. */
export const compareViewOf = (url: PageColumns, view: 'pages' | 'other') =>
  view === 'pages' ? isPageSql(url) : notPageSql(url)

/**
 * A URL that is a page in either crawl (`pages`: a page that broke or appeared is a change of a
 * page), or in neither (`other`).
 */
export const compareViewEither = (a: PageColumns, b: PageColumns, view: 'pages' | 'other') =>
  view === 'pages' ? or(isPageSql(a), isPageSql(b)) : and(notPageSql(a), notPageSql(b))

/** The URL or the title contains the text, whatever its case. */
export const compareSearch = (url: AnyColumn, title: AnyColumn, search: string | undefined) => {
  if (!search) return undefined
  const pattern = containsPattern(search)
  return sql`(lower(${url}) like ${pattern} escape '!' or lower(${title}) like ${pattern} escape '!')`
}

/**
 * How a listing of changes is read: the rows come from `main`, left joined to the same URL in
 * `otherCrawlId`. `added` and `missing` list the URLs the other crawl does not have; the rest, those
 * both crawls have and requested, so the join must also find a match.
 */
export function comparePlan(query: Pick<CrawlComparisonQuery, 'change' | 'baseId' | 'targetId'>) {
  if (query.change === 'missing') {
    return { mainCrawlId: query.baseId, otherCrawlId: query.targetId, matched: false }
  }
  return {
    mainCrawlId: query.targetId,
    otherCrawlId: query.baseId,
    matched: query.change !== 'added',
  }
}

/** The condition that selects what `comparePlan` lists. `main` is the table the rows come from. */
export function compareWhere(
  query: CrawlComparisonQuery,
  main: CompareColumns,
  other: CompareColumns,
  differs: Differs,
  findings: FindingDifferences,
): SQL | undefined {
  const plan = comparePlan(query)
  const search = compareSearch(main.url, main.title, query.search)
  if (!plan.matched) {
    return and(
      eq(main.crawlId, plan.mainCrawlId),
      eq(main.scope, 'internal'),
      compareViewOf(main, query.view),
      isNull(other.urlHash),
      search,
    )
  }
  if (query.change === 'added' || query.change === 'missing') return undefined
  return and(
    eq(main.crawlId, plan.mainCrawlId),
    eq(main.scope, 'internal'),
    eq(other.scope, 'internal'),
    eq(main.state, 'done'),
    eq(other.state, 'done'),
    compareViewEither(main, other, query.view),
    search,
    changeCondition(query.change, { target: main, base: other }, differs, findings, query.issue),
  )
}

type SnapshotRow = {
  state: string | null
  kind: string | null
  statusCode: number | null
  redirectTo: string | null
  title: string | null
  canonical: string | null
  metaRobots: string | null
  xRobotsTag: string | null
  error: string | null
  depth: number | null
}

/** A joined side that has no row (a left join that found nothing) is all `null`: `state` is never. */
export function toUrlSnapshot(row: SnapshotRow | null | undefined): UrlSnapshot | null {
  if (!row || row.state === null || row.kind === null || row.depth === null) return null
  return {
    state: row.state as UrlSnapshot['state'],
    kind: row.kind as UrlSnapshot['kind'],
    statusCode: row.statusCode,
    redirectTo: row.redirectTo,
    title: row.title,
    canonical: row.canonical,
    metaRobots: row.metaRobots,
    xRobotsTag: row.xRobotsTag,
    error: row.error,
    depth: row.depth,
  }
}

/** A listed row, with each side in the position `change` gives it. */
export function toUrlComparison(
  change: CrawlComparisonQuery['change'],
  row: {
    urlHash: string
    url: string
    main: SnapshotRow | null | undefined
    other: SnapshotRow | null | undefined
  },
): CrawlUrlComparison {
  const main = toUrlSnapshot(row.main)
  const other = toUrlSnapshot(row.other)
  const { urlHash, url } = row
  if (change === 'added') return { urlHash, url, base: null, target: main }
  if (change === 'missing') return { urlHash, url, base: main, target: null }
  return { urlHash, url, base: other, target: main }
}

/** Crawls and URLs per query of a history: each list is a `where … in (…)`. */
export const HISTORY_BATCH = 200

export const sumOf = (value: unknown) => Number(value ?? 0)

/** The entries of a history: a URL's row, its issues and its audit, per crawl. */
export function foldTraces(
  urls: (SnapshotRow & { crawlId: string; urlHash: string; url: string })[],
  issues: (CrawlUrlIssue & { crawlId: string })[],
  audits: (CrawlUrlAudit & { crawlId: string })[],
  accepted: { crawlId: string; urlHash: string; issue: string }[] = [],
): CrawlUrlTrace[] {
  const key = (crawlId: string, urlHash: string) => `${crawlId}:${urlHash}`
  const issuesBy = new Map<string, CrawlUrlIssue[]>()
  for (const { crawlId, ...issue } of issues) {
    const k = key(crawlId, issue.urlHash)
    issuesBy.set(k, [...(issuesBy.get(k) ?? []), issue])
  }
  const auditBy = new Map(
    audits.map(({ crawlId, ...audit }) => [key(crawlId, audit.urlHash), audit]),
  )
  const acceptedBy = new Map<string, string[]>()
  for (const { crawlId, urlHash, issue } of accepted) {
    const k = key(crawlId, urlHash)
    acceptedBy.set(k, [...(acceptedBy.get(k) ?? []), issue])
  }
  return urls.flatMap(({ crawlId, urlHash, url, ...row }) => {
    const snapshot = toUrlSnapshot(row)
    if (!snapshot) return []
    const k = key(crawlId, urlHash)
    return [
      {
        crawlId,
        urlHash,
        url,
        snapshot,
        issues: issuesBy.get(k) ?? [],
        accepted: acceptedBy.get(k) ?? [],
        audit: auditBy.get(k) ?? null,
      },
    ]
  })
}
// --- rechecks ------------------------------------------------------------

/** The job that runs a recheck, ready for insertion alongside it. */
export function verificationJobValues(verificationId: string, jobId: string, now: Date) {
  return {
    id: jobId,
    type: JOB_TYPES.urlVerify,
    payload: JSON.stringify({ verificationId }),
    runAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

/** A recheck takes between one and `MAX_VERIFICATION_URLS` URLs, each once. */
export function assertVerificationUrls(urls: readonly NewVerificationUrl[]) {
  if (urls.length === 0) throw new RangeError('A recheck needs at least one URL')
  if (urls.length > MAX_VERIFICATION_URLS) {
    throw new RangeError(`A recheck takes at most ${MAX_VERIFICATION_URLS} URLs`)
  }
  if (new Set(urls.map((url) => url.urlHash)).size !== urls.length) {
    throw new RangeError('A recheck takes each URL once')
  }
}

export const newVerificationUrlRows = (
  verificationId: string,
  urls: readonly NewVerificationUrl[],
) => urls.map((url) => ({ verificationId, ...url, state: 'queued' as const }))

/** What a recheck stores of an answer: the columns of a crawl's result, without what is extracted. */
export function verificationAnswerColumns(answer: VerificationAnswer, now: Date) {
  const { data: _data, ...columns } = crawlResultColumns({ ...answer, data: null }, now)
  return columns
}

export const verificationOutcomeColumn = (outcome: VerificationOutcome) => JSON.stringify(outcome)

export const toVerification = ({
  activeKey: _activeKey,
  ...row
}: Verification & { activeKey: string | null }): Verification => row

type VerifiedUrlRow = Omit<VerifiedUrl, 'outcome' | 'source'> & {
  source: string
  outcome: string | null
}

/** What a recheck stored, read like a newer one: rechecks from before conditions have none. */
function readOutcome(stored: string): VerificationOutcome {
  const { accepted, ...outcome } = parseJson(stored) as Omit<VerificationOutcome, 'audit'> & {
    audit: Parameters<typeof readUrlAuditState>[0]
  }
  return {
    ...outcome,
    audit: readUrlAuditState(outcome.audit),
    // Absent in rechecks from before it was kept: that stays absent, never an empty list.
    ...(Array.isArray(accepted)
      ? {
          accepted: accepted.flatMap((finding) => {
            const acceptance = parseFindingAcceptance(finding.acceptance)
            return acceptance ? [{ ...finding, acceptance }] : []
          }),
        }
      : {}),
  }
}

export const toVerifiedUrl = ({ outcome, source, ...row }: VerifiedUrlRow): VerifiedUrl => ({
  ...row,
  source: source as CrawlUrlSource,
  outcome: outcome === null ? null : readOutcome(outcome),
})

/** Keeps the most recent result of each URL. */
export function newestVerifiedPerUrl(rows: VerifiedUrl[]): VerifiedUrl[] {
  const newest = new Map<string, VerifiedUrl>()
  for (const row of rows) {
    const current = newest.get(row.urlHash)
    if (!current || (row.fetchedAt?.getTime() ?? 0) > (current.fetchedAt?.getTime() ?? 0)) {
      newest.set(row.urlHash, row)
    }
  }
  return [...newest.values()]
}

/** The rechecks beyond the newest `keep` of those that ended: what `prune` removes. */
export const expiredVerifications = (ended: readonly { id: string }[], keep: number): string[] =>
  ended.slice(Math.max(0, keep)).map((verification) => verification.id)

export const vitalsJobId = (crawlId: string) => `cwv:${crawlId}`
export function vitalsJobValues(crawlId: string, now: Date) {
  return { ...alertJobValues(crawlId, now), id: vitalsJobId(crawlId), type: JOB_TYPES.cwvCollect }
}
