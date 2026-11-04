/**
 * What a list of the URLs of a crawl can be narrowed by, and what each choice means. Pure, so the
 * database layer that filters, the worker that loads a whole site and the pages that offer the
 * choices (client components included) agree on it.
 */
import type { CrawlUrlKind } from './types'

/**
 * The views the pages offer, each one a plain statement about what the crawl recorded:
 * - `pages`: URLs of the site that answered with HTML.
 * - `resources`: URLs of the site that answered with anything else: images, CSS, PDFs, robots.txt…
 * - `redirects`: URLs of the site that answered with a 3xx.
 * - `external`: URLs on other sites.
 * - `all`: every URL the crawl recorded, whatever it turned out to be, including the ones of the
 *   site that never answered or were never requested (kind `unknown`), which no other view lists.
 */
export const URL_VIEWS = ['pages', 'resources', 'redirects', 'external', 'all'] as const

/**
 * Every view the database understands. `other` is the URLs of the site that are not pages
 * (redirects, resources and the ones that never answered): addresses made when that was a view of
 * its own still work, and the worker loads a whole site through it.
 */
export const CRAWL_URL_VIEWS = [...URL_VIEWS, 'other'] as const
export type CrawlUrlView = (typeof CRAWL_URL_VIEWS)[number]

/**
 * The types (`CrawlUrlKind`) a URL of the site can have in each view. Only URLs of the site have
 * one: external URLs are recorded and checked for a status, never typed, so a type filter leaves
 * them out and the `external` view has none to pick from.
 */
export const VIEW_KINDS: Record<CrawlUrlView, readonly CrawlUrlKind[]> = {
  pages: ['page'],
  resources: ['resource'],
  redirects: ['redirect'],
  other: ['redirect', 'resource', 'unknown'],
  external: [],
  all: ['page', 'redirect', 'resource', 'unknown'],
}

/** Whether choosing the type of a URL tells anything in a view: it needs more than one to pick. */
export const viewHasTypes = (view: CrawlUrlView) => VIEW_KINDS[view].length > 1

/**
 * Whether the view can hold URLs of the site, which are the only ones the audit looks at: external
 * URLs have no audit state, so an audit filter on a list of nothing else can only come back empty.
 */
export const viewIsAudited = (view: CrawlUrlView) => view !== 'external'

/** Every type a URL can have, in the order they are offered. */
export const URL_TYPES = [
  'page',
  'redirect',
  'resource',
  'unknown',
] as const satisfies readonly CrawlUrlKind[]
export const isUrlType = (value: unknown): value is CrawlUrlKind =>
  typeof value === 'string' && (URL_TYPES as readonly string[]).includes(value)

/**
 * The HTTP status filters: a class of status codes, or `none` for a URL with no status at all
 * (never requested, or the request failed before an answer). `none` is a state of its own, never
 * read as a success or as an error.
 */
export const STATUS_FILTERS = ['2xx', '3xx', '4xx', '5xx', 'none'] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]
export const isStatusFilter = (value: unknown): value is StatusFilter =>
  typeof value === 'string' && (STATUS_FILTERS as readonly string[]).includes(value)

/** The status codes a class covers, `min` included and `max` excluded. `none` has no codes. */
export function statusRange(filter: Exclude<StatusFilter, 'none'>): { min: number; max: number } {
  const hundred = Number(filter[0]) * 100
  return { min: hundred, max: hundred + 100 }
}
