/**
 * Whether a URL can be indexed, judged from what one crawl saw of it. It is a technical state, kept
 * apart from everything else on purpose:
 * - it does not depend on the audit: an excluded page is as indexable as it is, and a page with no
 *   findings may not be indexable at all;
 * - it is not what the user expects (`IndexIntent`);
 * - it is not whether a search engine has the URL in its index, which a crawl cannot know.
 *
 * Pure, so the worker (checks and totals) and the pages that show it agree on what it means.
 */
import type { CrawlUrlKind, CrawlUrlState } from './types'

export const INDEXABILITY_STATES = ['indexable', 'not-indexable', 'unknown'] as const
export type IndexabilityState = (typeof INDEXABILITY_STATES)[number]

/**
 * What can stand in the way of indexing a URL.
 * - `noindex`: a robots meta tag or `X-Robots-Tag` says so.
 * - `canonical`: its canonical points at another URL, which is the one meant to be indexed.
 * - `robots`: robots.txt blocks the crawlers. That keeps them from reading the page, not from
 *   listing the URL, so it is no proof that the URL is out of the index.
 * - `redirect`: it answers with a redirect, so the page is the one it leads to.
 * - `http-error`: it answers with an error status.
 */
export const INDEXABILITY_BLOCKERS = [
  'noindex',
  'canonical',
  'robots',
  'redirect',
  'http-error',
] as const
export type IndexabilityBlocker = (typeof INDEXABILITY_BLOCKERS)[number]

export interface IndexabilityInput {
  state: CrawlUrlState
  kind: CrawlUrlKind
  statusCode: number | null
  noindex: boolean
  /** Its canonical says another URL is the one to index. */
  canonicalised: boolean
  robotsBlocked: boolean
  documentKnown?: boolean
  clientRedirect?: boolean
}

export interface Indexability {
  state: IndexabilityState
  /** Why it is not indexable; empty otherwise. */
  blockers: IndexabilityBlocker[]
}

/**
 * - `unknown` when the crawl cannot tell: the URL was not requested, the request failed, or it is
 *   not a page and nothing in what it answered keeps it out. Never read as "not indexable", and never
 *   as meeting an expectation.
 * - `not-indexable` when something known stands in the way (see `INDEXABILITY_BLOCKERS`).
 * - `indexable` for a page that answered successfully with nothing in the way.
 */
export function assessIndexability(input: IndexabilityInput): Indexability {
  if (input.state !== 'done' || input.statusCode === null) return { state: 'unknown', blockers: [] }

  const blockers: IndexabilityBlocker[] = []
  if (input.clientRedirect || (input.statusCode >= 300 && input.statusCode < 400))
    blockers.push('redirect')
  else if (input.statusCode >= 400) blockers.push('http-error')
  if (input.noindex) blockers.push('noindex')
  if (input.canonicalised) blockers.push('canonical')
  if (input.robotsBlocked) blockers.push('robots')

  if (blockers.length > 0) return { state: 'not-indexable', blockers }
  return {
    state: input.kind === 'page' && input.documentKnown !== false ? 'indexable' : 'unknown',
    blockers: [],
  }
}
