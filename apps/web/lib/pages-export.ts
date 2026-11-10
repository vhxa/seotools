import { crawlUrlHash } from '@seotools/core'
import { ANY_ACCEPTED, type FindingAcceptance } from '@seotools/core/crawl/acceptance'
import type { Extractor } from '@seotools/core/crawl/extraction'
import { evidenceKindOf } from '@seotools/core/crawl/evidence'
import {
  PAGE_ISSUES,
  compareIssueSeverity,
  isPageIssueId,
  isSecondaryFinding,
  type IssueType,
} from '@seotools/core/crawl/issues'
import type {
  Crawl,
  CrawlRepository,
  CrawlUrl,
  CrawlUrlAcceptedIssue,
  CrawlUrlAudit,
  CrawlUrlIssue,
  CrawlUrlQuery,
  CrawlUrlSort,
  OutLink,
  OutLinkCursor,
} from '@seotools/db'
import { describeAcceptance } from './acceptance-reason'
import { CSV_BOM, csvRow, type CsvCell } from './csv'
import { evidenceTarget } from './issue-evidence'
import { activeFilters, type DetailQuery, type FilterKey, type NotApplied } from './pages-query'

/**
 * The CSV files of the pages table: the URLs of a crawl, and their findings. They hold what the
 * table lists for an address (every row, not a page of them), read from what the crawl stored, and
 * say in their own columns which domain, crawl and filters they come from, so that a file shared
 * on its own is understood without the screen it was made on. A value the crawl did not store is an
 * empty cell, never a guess.
 *
 * Adding a column is adding an entry to `PAGES_COLUMNS` or
 * `FINDINGS_COLUMNS` and its header to `Export.columns`; nothing else reads the order.
 */

export const EXPORT_KINDS = ['pages', 'findings', 'links', 'redirects'] as const
export type ExportKind = (typeof EXPORT_KINDS)[number]
export const isExportKind = (value: string): value is ExportKind =>
  (EXPORT_KINDS as readonly string[]).includes(value)

/** URLs read from the database at a time: what is in memory, whatever the size of the crawl. */
export const EXPORT_BATCH_SIZE = 500
/** Links of one URL read at a time by the links export. */
export const EXPORT_LINKS_PAGE_SIZE = 1000

/** Translates a message by its full key (`Namespace.path.to.message`). */
export type Translate = (key: string, values?: Record<string, string | number>) => string

/** The same query as the table's address, without the page and the drawer, which are not filters. */
export function rawParamsOf(search: URLSearchParams): Record<string, string[]> {
  const params: Record<string, string[]> = {}
  for (const key of new Set(search.keys())) params[key] = search.getAll(key)
  return params
}

// ---------------------------------------------------------------------------------------------
// What can be exported, and what cannot

/** Why nothing can be exported for an address, as an HTTP status and the message that says so. */
export interface ExportRefusal {
  status: 404 | 409
  message:
    | 'Export.errors.missing'
    | 'Export.errors.noCrawl'
    | 'Export.errors.pruned'
    | 'Export.errors.notAnalysed'
}

type Selection =
  | { kind: 'empty' }
  | { kind: 'missing' }
  | { kind: 'selected'; crawl: Pick<Crawl, 'pruned' | 'pagesByWorstIssue'> }

/**
 * An export is a file with rows: where there are none to export because there is no crawl, its
 * results are gone, or it was never checked for findings, the answer is an error that says why,
 * never an empty file that reads as "nothing found". A crawl of another domain is a 404, the same
 * as one that does not exist.
 */
export function exportRefusal(selection: Selection, kind: ExportKind): ExportRefusal | null {
  if (selection.kind === 'missing') return { status: 404, message: 'Export.errors.missing' }
  if (selection.kind === 'empty') return { status: 409, message: 'Export.errors.noCrawl' }
  if (selection.crawl.pruned) return { status: 409, message: 'Export.errors.pruned' }
  if (kind === 'findings' && selection.crawl.pagesByWorstIssue === null) {
    return { status: 409, message: 'Export.errors.notAnalysed' }
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// File name

/** When the crawl happened: when it ended, or failing that when it started. */
export const crawlMoment = (crawl: Pick<Crawl, 'finishedAt' | 'startedAt' | 'createdAt'>): Date =>
  crawl.finishedAt ?? crawl.startedAt ?? crawl.createdAt

/** `2026-11-05T09:30:00Z`: the same instant for everyone, whatever their time zone. */
export const isoSeconds = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

/** `2026-11-05`, in UTC. */
export const isoDay = (date: Date): string => date.toISOString().slice(0, 10)

/**
 * `example.com-findings-2026-11-05.csv`. Hosts are stored normalized, but this does not rely on it:
 * it is the name of a file on someone's disk and goes into a header, so only letters, digits, dots
 * and hyphens survive.
 */
export function exportFileName(host: string, kind: ExportKind, date: Date): string {
  const safeHost =
    host
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/\.{2,}/g, '.')
      .replace(/^[.-]+|[.-]+$/g, '')
      .slice(0, 100) || 'domain'
  return `${safeHost}-${kind}-${isoDay(date)}.csv`
}

/** `Content-Disposition` for a download of a file; the name is ASCII so one parameter is enough. */
export const contentDisposition = (fileName: string): string =>
  `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`

// ---------------------------------------------------------------------------------------------
// What the file says about where it comes from

/** The filters of an address in words, as the table's chips say them, for the `Filters` column. */
export function describeListing(
  query: Pick<DetailQuery, 'view' | FilterKey>,
  unapplied: Partial<Record<FilterKey, NotApplied>>,
  translate: Translate,
): string {
  const value = (key: FilterKey): Record<string, string> => {
    switch (key) {
      case 'search':
        return { value: query.search }
      case 'issue':
        return {
          value:
            query.issue && isPageIssueId(query.issue)
              ? translate(`PageIssues.${query.issue}.name`)
              : (query.issue ?? ''),
        }
      case 'accepted':
        return {
          value:
            query.accepted && isPageIssueId(query.accepted)
              ? translate(`PageIssues.${query.accepted}.name`)
              : translate('PagesDetails.activeFilters.anyFinding'),
        }
      case 'status':
        return { value: translate(`PagesDetails.filters.status.${query.status!}`) }
      case 'type':
        return { value: translate(`PagesDetails.filters.type.${query.type!}`) }
      case 'indexability':
        return { value: translate(`AuditState.indexability.${query.indexability!}`) }
      case 'participation':
        return { value: translate(`PagesDetails.filters.audit.${query.participation!}`) }
      case 'intent':
        return { value: translate(`PagesDetails.filters.intent.${query.intent!}`) }
      case 'rule':
        return {}
    }
  }
  // A filter that does not apply to the view did not narrow the list, so the file does not claim it.
  const applied = activeFilters(query).filter((key) => !unapplied[key])
  return [
    translate('Export.filters.view', { value: translate(`PagesDetails.views.${query.view}`) }),
    ...applied.map((key) => translate(`PagesDetails.activeFilters.chip.${key}`, value(key))),
  ].join('; ')
}

// ---------------------------------------------------------------------------------------------
// Rows

/** What the file is about, the same on every row. */
export interface ExportContext {
  host: string
  crawlId: string
  crawlDate: Date
  /** `describeListing`. */
  filters: string
  /**
   * The issue the list is filtered by, if it is: the findings file then holds that finding of each
   * URL and not the others it has, which is what the table's filter lists.
   */
  onlyIssue?: string | null
  /**
   * What a rule accepts that the list is filtered by (an issue, or `ANY_ACCEPTED`): the findings file
   * then holds those, saying so, instead of what is pending. They never mix unlabelled.
   */
  onlyAccepted?: string | null
  /** Whether the crawl was checked for findings: without it a URL with none is unknown, not clean. */
  analysed: boolean
  translate: Translate
  /** The domain's custom extractors: one more column each in the pages file, named as they are. */
  extractors?: readonly Extractor[]
}

/** A URL of the list with what the crawl concluded about it. */
export interface ExportUrl {
  url: CrawlUrl
  issues: CrawlUrlIssue[]
  /** What a rule accepts on the URL: what the crawl saw, and is not pending. */
  accepted?: CrawlUrlAcceptedIssue[]
  audit: CrawlUrlAudit | undefined
  /** The links leaving it (the links file). */
  links?: OutLink[]
  /** Where its redirects end (the redirects file). */
  redirect?: RedirectChain
}

/** Where a redirect leads once every hop the crawl recorded is followed. */
export interface RedirectChain {
  /** The last URL reached: the end of the chain, or where the crawl's knowledge stops. */
  finalUrl: string | null
  finalStatus: number | null
  hops: number
  loop: boolean
}

/** Hops followed at most: past this a chain is reported as it is, unfinished. */
const MAX_REDIRECT_HOPS = 10

interface Column {
  /** The message in `Export.columns` that is the header. */
  header: string
}
interface UrlColumn extends Column {
  cell: (row: ExportUrl, context: ExportContext) => CsvCell
}
interface FindingColumn extends Column {
  cell: (finding: Finding, context: ExportContext) => CsvCell
}

/** One finding of a URL, ready to be written. */
interface Finding {
  row: ExportUrl
  issue: CrawlUrlIssue
  /** What accepts it. Absent: it is pending. */
  acceptance?: FindingAcceptance
}

const tr = (context: ExportContext, key: string, values?: Record<string, string | number>) =>
  context.translate(key, values)

/** The columns every file starts with: where the rows come from. */
const ORIGIN_COLUMNS: readonly { header: string; value: (context: ExportContext) => CsvCell }[] = [
  { header: 'domain', value: (c) => c.host },
  { header: 'crawlDate', value: (c) => isoSeconds(c.crawlDate) },
  { header: 'crawlId', value: (c) => c.crawlId },
  { header: 'filters', value: (c) => c.filters },
]

const urlOf: UrlColumn = { header: 'url', cell: ({ url }) => url.url }

/** Whether an analysis looked at the URL for findings: left out of the audit, it has none to count. */
const wasChecked = (row: ExportUrl, context: ExportContext) =>
  context.analysed && row.audit?.participation !== 'excluded'

/** The expectation as the table words it, for the pages it applies to. */
function expectationOf(row: ExportUrl, context: ExportContext): string | null {
  const { url, audit } = row
  if (!audit || url.scope !== 'internal' || url.kind !== 'page') return null
  if (audit.intent === 'indexable' && audit.intentRule === null) {
    return tr(context, 'AuditState.intent.indexableDefault')
  }
  return tr(context, `AuditState.intent.${audit.intent}`)
}

const blockerLabel = (context: ExportContext, blocker: string) =>
  ['noindex', 'canonical', 'robots', 'redirect', 'http-error'].includes(blocker)
    ? tr(context, `AuditState.blockers.${blocker}`)
    : blocker

const countOfType = (issues: readonly CrawlUrlIssue[], type: IssueType) =>
  issues.filter(({ issue }) => isPageIssueId(issue) && PAGE_ISSUES[issue].type === type).length

const typeColumn = (header: string, type: IssueType): UrlColumn => ({
  header,
  cell: (row, context) => (wasChecked(row, context) ? countOfType(row.issues, type) : null),
})

export const PAGES_COLUMNS: readonly UrlColumn[] = [
  ...ORIGIN_COLUMNS.map(({ header, value }) => ({
    header,
    cell: (_: ExportUrl, c: ExportContext) => value(c),
  })),
  urlOf,
  {
    header: 'site',
    cell: ({ url }, c) =>
      tr(c, url.scope === 'internal' ? 'Export.values.internal' : 'Export.values.external'),
  },
  {
    header: 'kind',
    // External URLs are recorded and checked, never typed.
    cell: ({ url }, c) => (url.scope === 'internal' ? tr(c, `UrlDetail.kinds.${url.kind}`) : null),
  },
  { header: 'status', cell: ({ url }) => url.statusCode },
  { header: 'error', cell: ({ url }) => url.error },
  {
    header: 'indexability',
    cell: ({ audit }, c) => (audit ? tr(c, `AuditState.indexability.${audit.indexability}`) : null),
  },
  {
    header: 'blockers',
    cell: ({ audit }, c) => audit?.blockers.map((blocker) => blockerLabel(c, blocker)).join('; '),
  },
  {
    header: 'audit',
    cell: ({ audit }, c) =>
      audit ? tr(c, `AuditState.participation.${audit.participation}`) : null,
  },
  { header: 'expectation', cell: expectationOf },
  { header: 'title', cell: ({ url }) => url.title },
  // Empty where the crawl did not store it: a crawl from before the tags were kept, or no tag.
  { header: 'ogTitle', cell: ({ url }) => url.data?.facts?.social?.title },
  { header: 'ogDescription', cell: ({ url }) => url.data?.facts?.social?.description },
  { header: 'ogImage', cell: ({ url }) => url.data?.facts?.social?.image },
  { header: 'twitterCard', cell: ({ url }) => url.data?.facts?.social?.twitterCard },
  { header: 'htmlLang', cell: ({ url }) => url.data?.facts?.document?.lang },
  typeColumn('issues', 'issue'),
  typeColumn('warnings', 'warning'),
  typeColumn('opportunities', 'opportunity'),
  {
    header: 'acceptedFindings',
    // The same finding can be accepted by several URLs: it is one finding.
    cell: (row, c) =>
      wasChecked(row, c) ? new Set(row.accepted?.map(({ issue }) => issue)).size : null,
  },
  { header: 'referencedBy', cell: ({ url }) => url.referencedBy?.total },
]

/** What a finding stores about a URL, in words: where a hreflang came from, what keeps it out. */
function detailsOf({ issue }: Finding, context: ExportContext): string {
  const kind = isPageIssueId(issue.issue) ? PAGE_ISSUES[issue.issue].detail : undefined
  return (issue.details ?? [])
    .map((detail) => {
      if (kind === 'hreflang-source' && ['html', 'header', 'sitemap'].includes(detail)) {
        return tr(context, `IssueCatalog.hreflangSources.${detail}`)
      }
      return kind === 'indexability-blocker' ? blockerLabel(context, detail) : detail
    })
    .join('; ')
}

/**
 * The addresses in the evidence of a finding, one per line, each as `evidenceTarget` says it is
 * shown: a real HTTP(S) URL in its normalized form, and what the site wrote, as text, for anything
 * else. Only the samples the crawl kept; `total` says how many there were.
 */
function evidenceAddresses({ issue }: Finding): string[] {
  const evidence = issue.evidence
  if (!evidence) return []
  // Which crawl URLs an address is does not change what is written, so nothing is looked up.
  const written = (url: string | null, text: string | undefined): string => {
    const target = evidenceTarget(url, new Set())
    return target.kind === 'text' ? (text ?? url ?? '') : target.url
  }
  switch (evidence.kind) {
    case 'images':
      return evidence.items.map((item) => written(item.url, item.src))
    case 'links':
      return evidence.items.map((item) => written(item.url, item.raw))
    case 'canonicals':
      return evidence.items.map((item) => written(item.url, item.raw))
    case 'related-urls':
      return evidence.urls.map((url) => written(url, undefined))
  }
}

/** The kind of evidence an issue comes with, and whether the finding has it. */
function evidenceState(finding: Finding): 'none' | 'stored' | 'not-stored' {
  // What a rule accepts about other URLs names them whatever the issue is.
  if (finding.acceptance) return finding.issue.evidence ? 'stored' : 'none'
  const expected = evidenceKindOf(finding.issue.issue)
  if (expected === null) return 'none'
  return finding.issue.evidence?.kind === expected ? 'stored' : 'not-stored'
}

export const FINDINGS_COLUMNS: readonly FindingColumn[] = [
  ...ORIGIN_COLUMNS.map(({ header, value }) => ({
    header,
    cell: (_: Finding, c: ExportContext) => value(c),
  })),
  { header: 'url', cell: ({ row }) => row.url.url },
  {
    header: 'findingState',
    cell: ({ acceptance, issue, row }, c) =>
      tr(
        c,
        `Export.values.${
          acceptance
            ? 'accepted'
            : isPageIssueId(issue.issue) &&
                isSecondaryFinding(issue.issue, row.audit?.indexability ?? null)
              ? 'secondary'
              : 'pending'
        }`,
      ),
  },
  {
    header: 'acceptedBecause',
    cell: ({ acceptance }, c) => (acceptance ? describeAcceptance(acceptance, c.translate) : null),
  },
  { header: 'finding', cell: ({ issue }) => issue.issue },
  {
    header: 'findingName',
    // An id the code no longer defines (an older catalog) has no name to translate: it is as it is.
    cell: ({ issue }, c) =>
      isPageIssueId(issue.issue) ? tr(c, `PageIssues.${issue.issue}.name`) : issue.issue,
  },
  {
    header: 'category',
    cell: ({ issue }, c) =>
      isPageIssueId(issue.issue)
        ? tr(c, `IssueCatalog.categories.${PAGE_ISSUES[issue.issue].category}`)
        : null,
  },
  {
    header: 'type',
    cell: ({ issue }, c) =>
      isPageIssueId(issue.issue)
        ? tr(c, `IssueCatalog.types.${PAGE_ISSUES[issue.issue].type}`)
        : null,
  },
  {
    header: 'importance',
    cell: ({ issue }, c) =>
      isPageIssueId(issue.issue)
        ? tr(c, `IssueCatalog.importance.${PAGE_ISSUES[issue.issue].importance}`)
        : null,
  },
  { header: 'details', cell: detailsOf },
  {
    header: 'evidenceTotal',
    cell: (finding, c) => {
      const evidence = finding.issue.evidence
      if (evidenceState(finding) !== 'stored' || !evidence) return null
      // The search for other pages is capped: a lower bound is said as one, not as a number.
      return evidence.kind === 'related-urls' && evidence.atLeast
        ? tr(c, 'Export.values.atLeast', { total: evidence.total })
        : evidence.total
    },
  },
  {
    header: 'evidenceSamples',
    cell: (finding, c) => {
      const state = evidenceState(finding)
      if (state === 'none') return null
      // A crawl from before the evidence was kept cannot say, and examples are never made up.
      if (state === 'not-stored') return tr(c, 'Export.values.evidenceNotStored')
      return evidenceAddresses(finding).filter(Boolean).join('\n')
    },
  },
  { header: 'status', cell: ({ row }) => row.url.statusCode },
  {
    header: 'indexability',
    cell: ({ row }, c) =>
      row.audit ? tr(c, `AuditState.indexability.${row.audit.indexability}`) : null,
  },
]

/**
 * The findings of a URL, the worst first and in a fixed order for the ones that tie: what is pending,
 * or what a rule accepts when the list asks for that.
 */
export function findingsOf(row: ExportUrl, accepted = false): Finding[] {
  const found: (CrawlUrlIssue & { acceptance?: FindingAcceptance })[] = accepted
    ? (row.accepted ?? [])
    : row.issues
  return [...found]
    .sort((a, b) => {
      const known = Number(isPageIssueId(b.issue)) - Number(isPageIssueId(a.issue))
      if (known !== 0) return known
      if (isPageIssueId(a.issue) && isPageIssueId(b.issue)) {
        return compareIssueSeverity(a.issue, b.issue) || a.issue.localeCompare(b.issue)
      }
      return a.issue.localeCompare(b.issue)
    })
    .map(({ acceptance, ...issue }) => ({ row, issue, ...(acceptance ? { acceptance } : {}) }))
}

const ORIGIN: readonly UrlColumn[] = ORIGIN_COLUMNS.map(({ header, value }) => ({
  header,
  cell: (_: ExportUrl, c: ExportContext) => value(c),
}))

interface LinkColumn extends Column {
  cell: (link: OutLink, row: ExportUrl, context: ExportContext) => CsvCell
}

/** The links file: one row per link that leaves a listed URL. */
export const LINKS_COLUMNS: readonly LinkColumn[] = [
  ...ORIGIN.map(({ header, cell }) => ({
    header,
    cell: (_: OutLink, row: ExportUrl, c: ExportContext) => cell(row, c),
  })),
  { header: 'url', cell: (_, { url }) => url.url },
  { header: 'linkTo', cell: (link) => link.url },
  { header: 'linkKind', cell: (link, _, c) => tr(c, `LinkKinds.${link.kind}`) },
  { header: 'linkStatus', cell: (link) => link.statusCode },
  { header: 'linkText', cell: (link) => link.context?.text ?? null },
  { header: 'linkElement', cell: (link) => link.context?.element ?? null },
  {
    header: 'linkRegion',
    cell: (link, _, c) =>
      link.context?.region ? tr(c, `LinkRegions.${link.context.region}`) : null,
  },
]

/** The redirects file: one row per listed URL that redirects, with where it ends. */
export const REDIRECTS_COLUMNS: readonly UrlColumn[] = [
  ...ORIGIN,
  urlOf,
  { header: 'status', cell: ({ url }) => url.statusCode },
  { header: 'redirectTo', cell: ({ url }) => url.redirectTo },
  { header: 'finalUrl', cell: ({ redirect }) => redirect?.finalUrl ?? null },
  { header: 'finalStatus', cell: ({ redirect }) => redirect?.finalStatus ?? null },
  { header: 'hops', cell: ({ redirect }) => redirect?.hops ?? null },
  {
    header: 'loop',
    cell: ({ redirect }, c) =>
      redirect ? tr(c, redirect.loop ? 'Export.values.yes' : 'Export.values.no') : null,
  },
]

const headersOf = (kind: ExportKind): readonly Column[] =>
  kind === 'pages'
    ? PAGES_COLUMNS
    : kind === 'findings'
      ? FINDINGS_COLUMNS
      : kind === 'links'
        ? LINKS_COLUMNS
        : REDIRECTS_COLUMNS

export const exportHeader = (kind: ExportKind, context: ExportContext): string =>
  csvRow([
    ...headersOf(kind).map((column) => tr(context, `Export.columns.${column.header}`)),
    // Named by whoever set them up: the name is the header, as it is.
    ...(kind === 'pages' ? (context.extractors ?? []).map((extractor) => extractor.name) : []),
  ])

/** The records a URL makes: one in the pages file, one per finding in the findings file. */
export function exportRecords(kind: ExportKind, row: ExportUrl, context: ExportContext): string[] {
  if (kind === 'pages') {
    return [
      csvRow([
        ...PAGES_COLUMNS.map((column) => column.cell(row, context)),
        ...(context.extractors ?? []).map(
          (extractor) => row.url.data?.extracted?.[extractor.key]?.join(' | ') ?? null,
        ),
      ]),
    ]
  }
  if (kind === 'links') {
    return (row.links ?? []).map((link) =>
      csvRow(LINKS_COLUMNS.map((column) => column.cell(link, row, context))),
    )
  }
  if (kind === 'redirects') {
    return row.url.kind === 'redirect'
      ? [csvRow(REDIRECTS_COLUMNS.map((column) => column.cell(row, context)))]
      : []
  }
  const { onlyIssue, onlyAccepted } = context
  return findingsOf(row, Boolean(onlyAccepted))
    .filter(({ issue }) => !onlyIssue || issue.issue === onlyIssue)
    .filter(
      ({ issue }) => !onlyAccepted || onlyAccepted === ANY_ACCEPTED || issue.issue === onlyAccepted,
    )
    .map((finding) => csvRow(FINDINGS_COLUMNS.map((column) => column.cell(finding, context))))
}

// ---------------------------------------------------------------------------------------------
// Walking the crawl

/** What the export needs of the database. */
export type ExportSource = Pick<
  CrawlRepository,
  'listUrls' | 'issuesOf' | 'acceptedOf' | 'auditOf' | 'outlinksOf' | 'urlsOf'
>

/** Follows the redirects of these URLs through what the crawl recorded, a hop at a time. */
async function redirectChains(
  source: Pick<CrawlRepository, 'urlsOf'>,
  crawlId: string,
  urls: CrawlUrl[],
): Promise<Map<string, RedirectChain>> {
  const chains = new Map<string, RedirectChain & { at: CrawlUrl; seen: Set<string> }>()
  for (const url of urls) {
    if (url.kind !== 'redirect') continue
    chains.set(url.urlHash, {
      at: url,
      seen: new Set([url.urlHash]),
      finalUrl: url.redirectTo,
      finalStatus: null,
      hops: 0,
      loop: false,
    })
  }
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    const moving = [...chains.values()].filter(
      (chain) => !chain.loop && chain.at.kind === 'redirect' && chain.at.redirectTo,
    )
    if (moving.length === 0) break
    const next = new Map(
      (
        await source.urlsOf(
          crawlId,
          moving.map((chain) => crawlUrlHash(chain.at.redirectTo!)),
        )
      ).map((url) => [url.urlHash, url]),
    )
    for (const chain of moving) {
      const target = chain.at.redirectTo!
      const hash = crawlUrlHash(target)
      chain.hops++
      chain.finalUrl = target
      const reached = next.get(hash)
      if (chain.seen.has(hash)) {
        chain.loop = true
        continue
      }
      chain.seen.add(hash)
      if (!reached) {
        // The crawl did not record where it goes: the chain is known up to here.
        chain.finalStatus = null
        chain.at = { ...chain.at, kind: 'unknown', redirectTo: null }
        continue
      }
      chain.finalStatus = reached.statusCode
      chain.at = reached
    }
  }
  return new Map(
    [...chains].map(([hash, { finalUrl, finalStatus, hops, loop }]) => [
      hash,
      { finalUrl, finalStatus, hops, loop },
    ]),
  )
}

/** The list changed while it was being written, so the file would not hold what it said it does. */
export class ExportInconsistentError extends Error {
  constructor(expected: number, seen: number) {
    super(`The list had ${expected} URLs when the export began and ${seen} when it ended`)
    this.name = 'ExportInconsistentError'
  }
}

/**
 * The text of the file, in pieces: the header first, then the records of a batch of URLs at a time.
 * It reads the URLs with the same filters and order as the table (`listing` is what `listingOf`
 * made of the address, `sort` what the address orders by), `batchSize` at a time, so a crawl of
 * any size is written with a bounded amount in memory. Nothing is read after `signal` aborts.
 *
 * `expected` is how many URLs the list held when the export began: if the walk ends with another
 * number (the crawl's results were removed meanwhile) it fails rather than end a file that would
 * look complete.
 */
export async function* exportCsv(options: {
  kind: ExportKind
  source: ExportSource
  listing: CrawlUrlQuery
  sort?: { sort: CrawlUrlSort; direction: 'asc' | 'desc' } | null
  context: ExportContext
  expected: number
  signal?: AbortSignal
  batchSize?: number
}): AsyncGenerator<string, void, undefined> {
  const { kind, source, listing, context, signal, expected } = options
  const limit = options.batchSize ?? EXPORT_BATCH_SIZE
  yield CSV_BOM + exportHeader(kind, context)

  let offset = 0
  while (!signal?.aborted) {
    const urls = await source.listUrls({
      ...listing,
      ...(options.sort ?? {}),
      limit,
      offset,
    })
    if (signal?.aborted) return
    offset += urls.length
    if (urls.length > 0) {
      const hashes = urls.map((url) => url.urlHash)
      // The pages file counts findings only when the crawl was checked for them.
      const checked = kind === 'findings' || context.analysed
      const [issues, accepted, audits, chains] = await Promise.all([
        checked ? source.issuesOf(listing.crawlId, hashes) : [],
        checked ? source.acceptedOf(listing.crawlId, hashes) : [],
        source.auditOf(listing.crawlId, hashes),
        kind === 'redirects'
          ? redirectChains(source, listing.crawlId, urls)
          : new Map<string, RedirectChain>(),
      ])
      const issuesByUrl = new Map<string, CrawlUrlIssue[]>()
      for (const issue of issues) {
        const list = issuesByUrl.get(issue.urlHash)
        if (list) list.push(issue)
        else issuesByUrl.set(issue.urlHash, [issue])
      }
      const acceptedByUrl = new Map<string, CrawlUrlAcceptedIssue[]>()
      for (const finding of accepted) {
        const list = acceptedByUrl.get(finding.urlHash)
        if (list) list.push(finding)
        else acceptedByUrl.set(finding.urlHash, [finding])
      }
      const auditByUrl = new Map(audits.map((audit) => [audit.urlHash, audit]))
      const rowOf = (url: CrawlUrl, links?: OutLink[]): ExportUrl => ({
        url,
        issues: issuesByUrl.get(url.urlHash) ?? [],
        accepted: acceptedByUrl.get(url.urlHash) ?? [],
        audit: auditByUrl.get(url.urlHash),
        links,
        redirect: chains.get(url.urlHash),
      })
      if (kind === 'links') {
        // A page can have any number of links: they are read a bounded page at a time.
        for (const url of urls) {
          let after: OutLinkCursor | null = null
          do {
            if (signal?.aborted) return
            const page: { links: OutLink[]; next: OutLinkCursor | null } = await source.outlinksOf(
              listing.crawlId,
              url.urlHash,
              { after, limit: EXPORT_LINKS_PAGE_SIZE },
            )
            const text = exportRecords(kind, rowOf(url, page.links), context).join('')
            if (text !== '') yield text
            after = page.next
          } while (after)
        }
      } else {
        const text = urls.flatMap((url) => exportRecords(kind, rowOf(url), context)).join('')
        if (text !== '') yield text
      }
    }
    if (urls.length < limit) break
  }
  if (!signal?.aborted && offset !== expected) throw new ExportInconsistentError(expected, offset)
}

/**
 * The pieces as a response body that is read as fast as the client takes it: nothing is read from
 * the database for a piece until the client has asked for it, and when it goes away (or `signal`
 * aborts) the walk stops, so a closed tab does not keep a query loop running.
 */
export function csvStream(
  pieces: AsyncGenerator<string, void, undefined>,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const stop = () => void pieces.return().catch(() => undefined)
  signal?.addEventListener('abort', stop, { once: true })
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const next = await pieces.next()
          if (next.done) {
            signal?.removeEventListener('abort', stop)
            controller.close()
          } else {
            controller.enqueue(encoder.encode(next.value))
          }
        } catch (error) {
          signal?.removeEventListener('abort', stop)
          controller.error(error)
        }
      },
      cancel() {
        signal?.removeEventListener('abort', stop)
        stop()
      },
    },
    { highWaterMark: 0 },
  )
}
