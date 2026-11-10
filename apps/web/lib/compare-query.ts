import {
  COMPARE_VIEWS,
  CRAWL_CHANGES,
  type CompareView,
  type CrawlChange,
} from '@seotools/core/crawl/compare'
import { isPageIssueId } from '@seotools/core/crawl/issues'
import { isCrawlId } from './pages-query'

/**
 * What the comparison of two crawls shows is kept in the address, like the pages table: it can be
 * shared and bookmarked, and the server applies it. Pure: the pickers (client components) and the
 * page (a server component) both use it.
 */

export const COMPARE_PAGE_SIZE = 50
const MAX_SEARCH_LENGTH = 200

export interface CompareQuery {
  /** The crawls to compare, by id. `null`: the newest, and the retained one before it. */
  from: string | null
  to: string | null
  change: CrawlChange
  view: CompareView
  page: number
  search: string
  /** For the findings: only the ones about this issue (an id from `PAGE_ISSUES`). */
  issue: string | null
}

type RawParams = Record<string, string | string[] | undefined>
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

const DEFAULT_CHANGE: CrawlChange = 'added'

/** Reads the address of the comparison, ignoring whatever is not valid instead of failing. */
export function parseCompareQuery(params: RawParams): CompareQuery {
  const from = first(params.from)
  const to = first(params.to)
  const issue = first(params.issue)
  return {
    from: from && isCrawlId(from) ? from : null,
    to: to && isCrawlId(to) ? to : null,
    change: CRAWL_CHANGES.find((change) => change === first(params.change)) ?? DEFAULT_CHANGE,
    view: COMPARE_VIEWS.find((view) => view === first(params.view)) ?? 'pages',
    page: Math.max(1, Math.floor(Number(first(params.page))) || 1),
    search: (first(params.q) ?? '').trim().slice(0, MAX_SEARCH_LENGTH),
    issue: issue && isPageIssueId(issue) ? issue : null,
  }
}

/** Whether the change lists findings, which is where narrowing by issue makes sense. */
export const isFindingChange = (change: CrawlChange) => change === 'gained' || change === 'lost'

/** The address of the comparison for a query, with `changes` applied. Defaults are left out. */
export function compareHref(
  host: string,
  query: CompareQuery,
  changes: Partial<CompareQuery> = {},
): string {
  const next = { ...query, ...changes }
  const params = new URLSearchParams()
  if (next.from) params.set('from', next.from)
  if (next.to) params.set('to', next.to)
  if (next.change !== DEFAULT_CHANGE) params.set('change', next.change)
  if (next.view !== 'pages') params.set('view', next.view)
  if (next.search) params.set('q', next.search)
  if (next.issue && isFindingChange(next.change)) params.set('issue', next.issue)
  if (next.page > 1) params.set('page', String(next.page))
  const search = params.toString()
  return `/domains/${host}/crawls/compare${search ? `?${search}` : ''}`
}
