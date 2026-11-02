import { createHash } from 'node:crypto'
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  ne,
  sql,
  type AnyColumn,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm'
import {
  JOB_TYPES,
  crawlUrlHash,
  enabledExtraFiles,
  type CrawlFileData,
  type CrawlPageData,
  type CrawlRobotsFiles,
  type CrawlSettings,
  type ExtraCrawlFileKind,
  type Job,
  type JobStatus,
  type PagesByWorstIssue,
  type PagesWithType,
} from '@seotools/core'
import type {
  Company,
  CompanyWithDomains,
  Crawl,
  CrawlCounts,
  CrawlFile,
  CrawlFileCheck,
  CrawlLink,
  CrawlSchedule,
  CrawlUrl,
  CrawlUrlIssue,
  CrawlUrlQuery,
  CrawlUrlResult,
  CrawlUrlSort,
  CrawlUrlView,
  Domain,
  DomainFavicon,
  FaviconImage,
  NewCrawlFile,
  NewCrawlUrl,
  SitemapHreflang,
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

export type CrawlRow = Omit<Crawl, 'robots' | 'pagesByWorstIssue' | 'pagesWithType'> & {
  robots: string | null
  pagesWorstIssueCount: number | null
  pagesWorstWarningCount: number | null
  pagesWorstOpportunityCount: number | null
  pagesWithIssueCount: number | null
  pagesWithWarningCount: number | null
  pagesWithOpportunityCount: number | null
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
  robots: robots === null ? null : (parseJson(robots) as CrawlRobotsFiles),
})

/** The columns of `crawls` that say how many pages have each type as their worst issue. */
export const pagesByWorstIssueColumns = (
  { issue, warning, opportunity }: PagesByWorstIssue,
  withType: PagesWithType,
) => ({
  pagesWorstIssueCount: issue,
  pagesWorstWarningCount: warning,
  pagesWorstOpportunityCount: opportunity,
  pagesWithIssueCount: withType.issue,
  pagesWithWarningCount: withType.warning,
  pagesWithOpportunityCount: withType.opportunity,
})

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

export const crawlViewScope = (view: CrawlUrlView) =>
  view === 'external' ? ('external' as const) : ('internal' as const)

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

/**
 * The condition that selects the URLs of a query. `withIssue` is a query for the hashes of the
 * URLs that have `query.issue`, built by the dialect since it needs its own `db`.
 */
export function crawlUrlWhere(
  columns: CrawlUrlColumns,
  query: CrawlUrlQuery,
  withIssue: (issue: string) => SQLWrapper,
): SQL | undefined {
  const pattern = query.search ? containsPattern(query.search) : null
  return and(
    eq(columns.crawlId, query.crawlId),
    // An issue picks its URLs wherever they are: a redirect or a broken link is not a page.
    query.issue ? undefined : eq(columns.scope, crawlViewScope(query.view)),
    !query.issue && query.view === 'pages' ? eq(columns.kind, 'page') : undefined,
    !query.issue && query.view === 'other' ? ne(columns.kind, 'page') : undefined,
    pattern
      ? sql`(lower(${columns.url}) like ${pattern} escape '!' or lower(${columns.title}) like ${pattern} escape '!')`
      : undefined,
    query.issue ? inArray(columns.urlHash, withIssue(query.issue)) : undefined,
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

/** One row per URL and issue: asking twice for the same one is not an error. */
export function crawlIssueRows(crawlId: string, issues: CrawlUrlIssue[]) {
  const unique = new Map<string, CrawlUrlIssue>()
  for (const issue of issues) unique.set(`${issue.urlHash}:${issue.issue}`, issue)
  return [...unique.values()].map(({ urlHash, issue, details }) => ({
    crawlId,
    urlHash,
    issue,
    details: details?.length ? JSON.stringify(details) : null,
  }))
}

export const toCrawlUrlIssue = (row: {
  urlHash: string
  issue: string
  details: string | null
}): CrawlUrlIssue => ({
  urlHash: row.urlHash,
  issue: row.issue,
  ...(row.details === null ? {} : { details: parseJson(row.details) as string[] }),
})

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
