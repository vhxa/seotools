import { INDEX_INTENTS, type IndexIntent } from '@seotools/core/crawl/audit'
import { isPageIssueId } from '@seotools/core/crawl/issues'
import type { CrawlUrlSort, CrawlUrlView } from '@seotools/db'

/**
 * What the pages detail table shows is kept in the URL (`?view=…&q=…`), so that a filtered list
 * can be shared, bookmarked and linked to from the overview. Pure: the table (a client component)
 * and the page (a server component) both use it.
 */

export const PAGES_PAGE_SIZE = 50
export const DETAIL_VIEWS = [
  'pages',
  'other',
  'external',
] as const satisfies readonly CrawlUrlView[]
export const DETAIL_SORTS = [
  'url',
  'title',
  'status',
  'depth',
  'responseTime',
  'bytes',
] as const satisfies readonly CrawlUrlSort[]

export const PARTICIPATION_FILTERS = ['audited', 'excluded'] as const
export type ParticipationFilter = (typeof PARTICIPATION_FILTERS)[number]

const MAX_SEARCH_LENGTH = 200
/** The shape of a rule id: a UUID. */
const RULE_ID = /^[0-9a-f-]{36}$/i
/** The shape of `crawlUrlHash`: 32 hexadecimal characters. */
const URL_HASH = /^[0-9a-f]{32}$/
export const isUrlHash = (value: string) => URL_HASH.test(value)

export interface DetailQuery {
  view: CrawlUrlView
  page: number
  /** `null`: the default order, shallowest first. */
  sort: CrawlUrlSort | null
  direction: 'asc' | 'desc'
  search: string
  /** An id from `PAGE_ISSUES`. */
  issue: string | null
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
  const validIssue = issue && isPageIssueId(issue) ? issue : null
  return {
    // An issue picks its own URLs, in whichever view they are.
    view: validIssue
      ? 'pages'
      : (DETAIL_VIEWS.find((view) => view === first(params.view)) ?? 'pages'),
    page: Math.max(1, Math.floor(Number(first(params.page))) || 1),
    sort: DETAIL_SORTS.find((option) => option === sort) ?? null,
    direction: first(params.dir) === 'desc' ? 'desc' : 'asc',
    search: (first(params.q) ?? '').trim().slice(0, MAX_SEARCH_LENGTH),
    issue: validIssue,
    participation: PARTICIPATION_FILTERS.find((option) => option === participation) ?? null,
    intent: INDEX_INTENTS.find((option) => option === intent) ?? null,
    rule: rule && RULE_ID.test(rule) ? rule : null,
    url: url && isUrlHash(url) ? url : null,
  }
}

/** The address of the detail page for a query, with `changes` applied. Defaults are left out. */
export function detailHref(
  host: string,
  query: DetailQuery,
  changes: Partial<DetailQuery> = {},
): string {
  const next = { ...query, ...changes }
  const params = new URLSearchParams()
  if (next.view !== 'pages') params.set('view', next.view)
  if (next.search) params.set('q', next.search)
  if (next.view === 'pages' && next.issue) params.set('issue', next.issue)
  if (next.participation) params.set('audit', next.participation)
  if (next.intent) params.set('intent', next.intent)
  if (next.rule) params.set('rule', next.rule)
  if (next.sort) {
    params.set('sort', next.sort)
    if (next.direction === 'desc') params.set('dir', 'desc')
  }
  if (next.page > 1) params.set('page', String(next.page))
  if (next.url) params.set('url', next.url)
  const search = params.toString()
  return `/domains/${host}/pages/details${search ? `?${search}` : ''}`
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
