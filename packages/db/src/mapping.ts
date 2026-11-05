import { createHash } from 'node:crypto'
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
  JOB_TYPES,
  MAX_VERIFICATION_URLS,
  crawlUrlHash,
  enabledExtraFiles,
  parseAuditSnapshot,
  parseIssueEvidence,
  readUrlAuditState,
  serializeAuditSnapshot,
  statusRange,
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
  type LinkDirection,
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
  Company,
  CompanyWithDomains,
  CrawlUrlAcceptedIssue,
  Crawl,
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

// --- crawls --------------------------------------------------------------

export type CrawlRow = Omit<
  Crawl,
  'robots' | 'pagesByWorstIssue' | 'pagesWithType' | 'pagesAudit' | 'auditSnapshot'
> & {
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
export type CrawlUrlRow = Omit<CrawlUrl, 'data' | 'source' | 'scope' | 'kind' | 'state'> & {
  data: string | null
  source: string
  scope: string
  kind: string
  state: string
}
export type CrawlScheduleRow = CrawlSchedule & { updatedAt: Date }

export const toCrawl = ({
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
  robots: robots === null ? null : (parseJson(robots) as CrawlRobotsFiles),
})

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
export const newCrawlUrlRow = (crawlId: string, url: NewCrawlUrl) => ({
  crawlId,
  ...url,
  state: url.scope === 'internal' ? ('queued' as const) : ('skipped' as const),
})

export const newCrawlLinkRow = (crawlId: string, link: CrawlLink) => ({ crawlId, ...link })

export function priorityUrlRow(domainId: string, url: string, now: Date) {
  return { domainId, url, urlHash: crawlUrlHash(url), createdAt: now }
}

/** Folds `count(*) group by scope, kind, state` into the counters of a crawl. */
export function foldCrawlCounts(
  rows: { scope: string; kind: string; state: string; count: unknown }[],
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
    if (row.kind === 'page') counts.pagesCount += count
  }
  return counts
}

/** Folds `count(*) group by scope, kind` into how many URLs each view starts from. */
export function foldViewCounts(rows: { scope: string; kind: string; count: unknown }[]) {
  const counts: CrawlViewCounts = {
    pages: 0,
    resources: 0,
    redirects: 0,
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
    if (row.kind === 'page') counts.pages += count
    else counts.other += count
    if (row.kind === 'resource') counts.resources += count
    if (row.kind === 'redirect') counts.redirects += count
  }
  return counts
}

/** The columns of `crawl_urls` that listing, filtering and ordering URLs look at. */
export interface CrawlUrlColumns extends Record<CrawlUrlSort, AnyColumn> {
  crawlId: AnyColumn
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
      return and(eq(columns.scope, 'internal'), eq(columns.kind, 'page'))
    case 'resources':
      return and(eq(columns.scope, 'internal'), eq(columns.kind, 'resource'))
    case 'redirects':
      return and(eq(columns.scope, 'internal'), eq(columns.kind, 'redirect'))
    case 'other':
      return and(eq(columns.scope, 'internal'), ne(columns.kind, 'page'))
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
 */
export function crawlUrlOrder(
  columns: CrawlUrlColumns,
  sort: CrawlUrlSort = 'depth',
  direction: 'asc' | 'desc' = 'asc',
): SQL[] {
  const column = columns[sort]
  return [
    asc(sql`${column} is null`),
    (direction === 'desc' ? desc : asc)(column),
    asc(columns.url),
  ]
}

/** The columns of `crawl_links` that listing the links of a URL looks at. */
export interface CrawlLinkColumns {
  crawlId: AnyColumn
  sourceHash: AnyColumn
  targetHash: AnyColumn
  kind: AnyColumn
}

/**
 * The two ends of a link as a list of one URL sees them: `self` is the end that is the URL the
 * list is about, `other` the end each row shows (where an incoming link starts, where an outgoing
 * one points).
 */
export function crawlLinkEnds(columns: CrawlLinkColumns, direction: LinkDirection) {
  return direction === 'in'
    ? { self: columns.targetHash, other: columns.sourceHash }
    : { self: columns.sourceHash, other: columns.targetHash }
}

/** Joins each link to the `crawl_urls` row of its other end, within the same crawl. */
export const crawlLinkJoin = (
  columns: CrawlLinkColumns,
  urls: { crawlId: AnyColumn; urlHash: AnyColumn },
  direction: LinkDirection,
) =>
  and(eq(urls.crawlId, columns.crawlId), eq(urls.urlHash, crawlLinkEnds(columns, direction).other))

/**
 * The condition that selects the links of a query, within its crawl. `otherUrl` is the address of
 * the `crawl_urls` row at the other end (see `crawlLinkJoin`), which is what a search looks at.
 * An empty list of `kinds` is for the caller to answer with nothing.
 */
export function crawlLinkWhere(
  columns: CrawlLinkColumns,
  otherUrl: AnyColumn,
  query: CrawlLinkQuery,
): SQL | undefined {
  const pattern = query.search ? containsPattern(query.search) : null
  return and(
    eq(columns.crawlId, query.crawlId),
    eq(crawlLinkEnds(columns, query.direction).self, query.urlHash),
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
export const toCrawlLinkRow = (row: {
  url: string
  urlHash: string
  kind: string
  scope: string
  urlKind: string
  state: string
  statusCode: number | null
  error: string | null
}) => row as CrawlLinkRow

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

export type CrawlSettingsRow = Omit<CrawlSettings, 'optionalFiles'> & {
  optionalFiles: string | null
  domainId: string
  updatedAt: Date
}

export const toCrawlSettings = ({
  domainId: _domainId,
  updatedAt: _updatedAt,
  optionalFiles,
  ...row
}: CrawlSettingsRow): CrawlSettings => ({
  ...row,
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

export const crawlSettingsColumns = ({ optionalFiles, ...settings }: CrawlSettings) => ({
  ...settings,
  optionalFiles: JSON.stringify(optionalFiles),
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
/** MySQL compares text without regard to case or accents unless told to: here a change is a change. */
export const mysqlDiffers: Differs = (a, b, text) =>
  text ? sql`not (binary ${a} <=> binary ${b})` : sql`not (${a} <=> ${b})`

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

/** URLs that are pages (`pages`) or are not (`other`), by the kind a crawl gave them. */
export const compareViewOf = (kind: AnyColumn, view: 'pages' | 'other') =>
  view === 'pages' ? eq(kind, 'page') : ne(kind, 'page')

/** A URL that is a page in either crawl (`pages`), or in neither (`other`). */
export const compareViewEither = (a: AnyColumn, b: AnyColumn, view: 'pages' | 'other') =>
  view === 'pages' ? or(eq(a, 'page'), eq(b, 'page')) : and(ne(a, 'page'), ne(b, 'page'))

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
      compareViewOf(main.kind, query.view),
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
    compareViewEither(main.kind, other.kind, query.view),
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
  const outcome = parseJson(stored) as Omit<VerificationOutcome, 'audit'> & {
    audit: Parameters<typeof readUrlAuditState>[0]
  }
  return { ...outcome, audit: readUrlAuditState(outcome.audit) }
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
