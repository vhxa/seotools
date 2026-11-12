import type { CrawlUrlKind } from '@seotools/core'
import { INDEX_INTENTS, type IndexIntent } from '@seotools/core/crawl/audit'
import { INDEXABILITY_STATES, type IndexabilityState } from '@seotools/core/crawl/indexability'
import { ANY_ACCEPTED } from '@seotools/core/crawl/acceptance'
import { isPageIssueId } from '@seotools/core/crawl/issues'
import {
  CRAWL_URL_VIEWS,
  FINDING_STATE_FILTERS,
  type FindingStateFilter,
  STATUS_FILTERS,
  URL_TYPES,
  URL_VIEWS,
  viewHasTypes,
  viewIsAudited,
  type StatusFilter,
} from '@seotools/core/crawl/listing'
import type { CrawlUrlQuery, CrawlUrlSort, CrawlUrlView } from '@seotools/db'

/**
 * What the pages detail table shows is kept in the URL (`?view=…&q=…`), so that a filtered list
 * can be shared, bookmarked and linked to from the overview. Pure: the table (a client component)
 * and the page (a server component) both use it.
 */

export const PAGES_PAGE_SIZE = 50
/**
 * The views the table offers. `other` (the URLs of the site that are not pages) is not among them:
 * it is how addresses made before resources and redirects had a view of their own still work.
 */
export const DETAIL_VIEWS = URL_VIEWS
export const DETAIL_SORTS = [
  'referencedBy',
  'url',
  'title',
  'status',
  'depth',
  'responseTime',
  'bytes',
] as const satisfies readonly CrawlUrlSort[]

export const PARTICIPATION_FILTERS = ['audited', 'excluded'] as const
export type ParticipationFilter = (typeof PARTICIPATION_FILTERS)[number]

export const MAX_SEARCH_LENGTH = 200
/** The shape of a rule id or a crawl id: a UUID. */
const RULE_ID = /^[0-9a-f-]{36}$/i
/** Whether a value has the shape of a crawl id. Whose crawl it is, is for the server to check. */
export const isCrawlId = (value: string) => RULE_ID.test(value)
/** The shape of `crawlUrlHash`: 32 hexadecimal characters. */
const URL_HASH = /^[0-9a-f]{32}$/
export const isUrlHash = (value: string) => URL_HASH.test(value)

export interface DetailQuery {
  state: FindingStateFilter | null
  /**
   * The crawl being browsed: one of the domain's retained full crawls. `null`: the latest one, which
   * is also what an address without it means. Only its shape is checked here (`isCrawlId`); the page
   * checks that it is a crawl of the domain before using it.
   */
  crawl: string | null
  /**
   * Where the list starts from. With an `issue` it is always `all`: an issue lists its URLs in
   * whichever view they are, and the address never says otherwise.
   */
  view: CrawlUrlView
  page: number
  /** `null`: the default order, shallowest first. */
  sort: CrawlUrlSort | null
  direction: 'asc' | 'desc'
  search: string
  /** An id from `PAGE_ISSUES`. */
  issue: string | null
  /**
   * Only URLs with a finding a rule accepts: an id from `PAGE_ISSUES`, or `ANY_ACCEPTED`. It lists
   * every view at once, like `issue`, and the two exclude each other.
   */
  accepted: string | null
  /** Only URLs whose last request got a status of this class, or none at all. */
  status: StatusFilter | null
  /** Only URLs of the site that turned out to be this. */
  type: CrawlUrlKind | null
  /** Only URLs with this technical indexability, as the crawl saw it. */
  indexability: IndexabilityState | null
  /** Only URLs the analysis audited, or only those it left out. */
  participation: ParticipationFilter | null
  /** Only URLs with this expectation of their indexation. */
  intent: IndexIntent | null
  /** Only URLs this rule decided: how the settings link to the URLs a rule affects. */
  rule: string | null
  /** The hash of the URL open in the drawer. */
  url: string | null
}

type RawParams = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

/** Reads the query of the detail page, ignoring whatever is not valid instead of failing. */
export function parseDetailQuery(params: RawParams): DetailQuery {
  const sort = first(params.sort)
  const issue = first(params.issue)
  const url = first(params.url)
  const participation = first(params.audit)
  const intent = first(params.intent)
  const rule = first(params.rule)
  const crawl = first(params.crawl)
  const status = first(params.status)
  const type = first(params.type)
  const indexability = first(params.indexability)
  const validIssue = issue && isPageIssueId(issue) ? issue : null
  const accepted = first(params.accepted)
  const validAccepted =
    !validIssue && accepted && (accepted === ANY_ACCEPTED || isPageIssueId(accepted))
      ? accepted
      : null
  return {
    state: FINDING_STATE_FILTERS.find((s) => s === first(params.state)) ?? null,
    crawl: crawl && isCrawlId(crawl) ? crawl : null,
    // An issue picks its own URLs, in whichever view they are: that is every URL of the crawl.
    view:
      validIssue || validAccepted
        ? 'all'
        : (CRAWL_URL_VIEWS.find((view) => view === first(params.view)) ?? 'pages'),
    page: Math.max(1, Math.floor(Number(first(params.page))) || 1),
    sort: DETAIL_SORTS.find((option) => option === sort) ?? null,
    direction: first(params.dir) === 'desc' ? 'desc' : 'asc',
    search: (first(params.q) ?? '').trim().slice(0, MAX_SEARCH_LENGTH),
    issue: validIssue,
    accepted: validAccepted,
    status: STATUS_FILTERS.find((option) => option === status) ?? null,
    type: URL_TYPES.find((option) => option === type) ?? null,
    indexability: INDEXABILITY_STATES.find((option) => option === indexability) ?? null,
    participation: PARTICIPATION_FILTERS.find((option) => option === participation) ?? null,
    intent: INDEX_INTENTS.find((option) => option === intent) ?? null,
    rule: rule && RULE_ID.test(rule) ? rule : null,
    url: url && isUrlHash(url) ? url : null,
  }
}

/** The filters that narrow a list, as opposed to where it starts from and how it is shown. */
export const FILTER_KEYS = [
  'state',
  'issue',
  'accepted',
  'search',
  'status',
  'type',
  'indexability',
  'participation',
  'intent',
  'rule',
] as const
export type FilterKey = (typeof FILTER_KEYS)[number]

/** Why a filter in the address is not doing anything to the list, and what to say about it. */
export type NotApplied =
  /** The list is of external URLs, which are not audited and have no type. */
  | 'external'
  /** The view has a single type: there is nothing to pick. */
  | 'view'
  /** The crawl has no audit data (yet): its URLs have no state to filter by. */
  | 'no-audit-data'

const AUDIT_FILTERS: readonly FilterKey[] = ['indexability', 'participation', 'intent', 'rule']

const isSet = (query: Pick<DetailQuery, FilterKey>, key: FilterKey) =>
  key === 'search' ? query.search !== '' : query[key] !== null

/** Whether a filter says anything about the URLs of a view; what to say if not. */
function blockedByView(view: CrawlUrlView, key: FilterKey): NotApplied | null {
  if (key === 'type') return viewHasTypes(view) ? null : view === 'external' ? 'external' : 'view'
  if (AUDIT_FILTERS.includes(key)) return viewIsAudited(view) ? null : 'external'
  return null
}

/**
 * Which groups of filters can say anything about the list, and why not if they cannot: the ones on
 * the audit (technical state, audit, expectation, rule) and the type. They are shown disabled with
 * the reason, rather than removed, so nothing around them moves.
 */
export function filterAvailability(
  view: CrawlUrlView,
  context: { auditData: boolean },
): { audit: NotApplied | null; type: NotApplied | null } {
  return {
    audit: blockedByView(view, 'indexability') ?? (context.auditData ? null : 'no-audit-data'),
    type: blockedByView(view, 'type'),
  }
}

/**
 * The filters in the query that cannot apply, and why. They are kept in the address (a link made
 * before they stopped applying still shows what it was), but never sent to the database: an audit
 * filter on external URLs, or on a crawl with no audit data, would only come back empty, which
 * reads as "no such URLs" when the truth is that nothing was asked of them.
 */
export function unappliedFilters(
  query: Pick<DetailQuery, 'view' | FilterKey>,
  context: { auditData: boolean },
): Partial<Record<FilterKey, NotApplied>> {
  const availability = filterAvailability(query.view, context)
  const unapplied: Partial<Record<FilterKey, NotApplied>> = {}
  for (const key of FILTER_KEYS) {
    if (!isSet(query, key)) continue
    const reason =
      key === 'type' ? availability.type : AUDIT_FILTERS.includes(key) ? availability.audit : null
    if (reason) unapplied[key] = reason
  }
  return unapplied
}

/** What a query asks the database for: the view and the filters that apply, nothing else. */
export function listingOf(
  query: Pick<DetailQuery, 'view' | FilterKey>,
  unapplied: Partial<Record<FilterKey, NotApplied>>,
): Omit<CrawlUrlQuery, 'crawlId'> {
  const applies = (key: FilterKey) => !unapplied[key]
  return {
    view: query.view,
    ...(query.state ? { state: query.state } : {}),
    ...(query.search ? { search: query.search } : {}),
    ...(query.issue ? { issue: query.issue } : {}),
    ...(query.accepted ? { accepted: query.accepted } : {}),
    ...(query.status && applies('status') ? { status: query.status } : {}),
    ...(query.type && applies('type') ? { type: query.type } : {}),
    ...(query.indexability && applies('indexability') ? { indexability: query.indexability } : {}),
    ...(query.participation && applies('participation')
      ? { participation: query.participation }
      : {}),
    ...(query.intent && applies('intent') ? { intent: query.intent } : {}),
    ...(query.rule && applies('rule') ? { rule: query.rule } : {}),
  }
}

/** The filters set in a query, in the order they are listed. */
export const activeFilters = (query: Pick<DetailQuery, FilterKey>): FilterKey[] =>
  FILTER_KEYS.filter((key) => isSet(query, key))

/** What removes one filter, or all of them: the view stays, and so do the order and the crawl. */
export function withoutFilter(key: FilterKey | 'all'): Partial<DetailQuery> {
  const cleared: Pick<DetailQuery, FilterKey> = {
    state: null,
    issue: null,
    accepted: null,
    search: '',
    status: null,
    type: null,
    indexability: null,
    participation: null,
    intent: null,
    rule: null,
  }
  const changes: Partial<DetailQuery> =
    key === 'all' ? cleared : ({ [key]: cleared[key] } as Partial<DetailQuery>)
  return { ...changes, page: 1, url: null }
}

/**
 * The address of the detail page for a query, with `changes` applied. Defaults are left out.
 *
 * - Choosing a view leaves the issue: an issue is a way of listing every view at once.
 * - An issue is written without a view, since it always means all of them.
 * - A filter that cannot apply to the view is left out, so that a link to another view never
 *   carries something that would only list nothing. The search, the order and the filters that do
 *   apply stay.
 */
export function detailHref(
  host: string,
  query: DetailQuery,
  changes: Partial<DetailQuery> = {},
): string {
  const next = { ...query, ...changes }
  if (changes.view !== undefined && changes.issue === undefined) next.issue = null
  if (changes.view !== undefined && changes.accepted === undefined) next.accepted = null
  // Asking for one kind of finding leaves the other: they exclude each other.
  if (changes.issue) next.accepted = null
  if (changes.accepted) next.issue = null
  const view = next.issue || next.accepted ? 'all' : next.view
  const kept = (key: FilterKey) => blockedByView(view, key) === null
  const params = new URLSearchParams()
  if (next.state) params.set('state', next.state)
  if (next.crawl) params.set('crawl', next.crawl)
  if (!next.issue && !next.accepted && view !== 'pages') params.set('view', view)
  if (next.search) params.set('q', next.search)
  if (next.issue) params.set('issue', next.issue)
  if (next.accepted) params.set('accepted', next.accepted)
  if (next.status) params.set('status', next.status)
  if (next.type && kept('type')) params.set('type', next.type)
  if (next.indexability && kept('indexability')) params.set('indexability', next.indexability)
  if (next.participation && kept('participation')) params.set('audit', next.participation)
  if (next.intent && kept('intent')) params.set('intent', next.intent)
  if (next.rule && kept('rule')) params.set('rule', next.rule)
  if (next.sort) {
    params.set('sort', next.sort)
    if (next.direction === 'desc') params.set('dir', 'desc')
  }
  if (next.page > 1) params.set('page', String(next.page))
  if (next.url) params.set('url', next.url)
  const search = params.toString()
  return `/domains/${host}/urls${search ? `?${search}` : ''}`
}

/**
 * The address of a CSV export of what the table lists for a query: the same view, filters, search,
 * order and crawl as `detailHref` writes, without the page and the drawer, which are not part of
 * what is listed. Read back with `parseDetailQuery`, so the file and the table never disagree.
 */
export function exportHref(
  host: string,
  query: DetailQuery,
  kind: 'pages' | 'findings' | 'links' | 'redirects',
): string {
  const search = detailHref(host, query, { page: 1, url: null }).split('?')[1]
  return `/domains/${host}/urls/export/${kind}${search ? `?${search}` : ''}`
}

/** The direction a column header should sort in when clicked: asc, then desc, then back to default. */
export function nextSort(
  query: Pick<DetailQuery, 'sort' | 'direction'>,
  column: CrawlUrlSort,
): Pick<DetailQuery, 'sort' | 'direction'> {
  if (query.sort !== column) return { sort: column, direction: 'asc' }
  if (query.direction === 'asc') return { sort: column, direction: 'desc' }
  return { sort: null, direction: 'asc' }
}
