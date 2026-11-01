import { createHash } from 'node:crypto'
import {
  JOB_TYPES,
  crawlUrlHash,
  type CrawlPageData,
  type CrawlRobotsFiles,
  type Job,
  type JobStatus,
} from '@seotools/core'
import type {
  Company,
  CompanyWithDomains,
  Crawl,
  CrawlCounts,
  CrawlLink,
  CrawlSchedule,
  CrawlUrl,
  CrawlUrlResult,
  CrawlUrlView,
  Domain,
  DomainFavicon,
  FaviconImage,
  NewCrawlUrl,
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

export type CrawlRow = Omit<Crawl, 'robots'> & { robots: string | null }
export type CrawlUrlRow = Omit<CrawlUrl, 'data' | 'source' | 'scope' | 'kind' | 'state'> & {
  data: string | null
  source: string
  scope: string
  kind: string
  state: string
}
export type CrawlScheduleRow = CrawlSchedule & { updatedAt: Date }

export const toCrawl = ({ robots, ...row }: CrawlRow): Crawl => ({
  ...row,
  robots: robots === null ? null : (parseJson(robots) as CrawlRobotsFiles),
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

/** External URLs are recorded, never requested, so they don't enter the queue. */
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
