import {
  RELATIONS_SEMANTICS,
  semanticsOf,
  type IndexabilityBlocker,
  type Indexability,
} from '@seotools/core'
import type { AuditedUrl, Site } from './site-audit'

/**
 * When a URL points at another (a canonical, an hreflang), the finding sits on the one that points
 * (the origin) and is about the one it points at (the destination). Both have declared things of
 * their own indexation, and a finding that only repeats what the user declared is not news. This is
 * the one place that says which declared states excuse which findings, so that the checks stay
 * about what the crawl saw. Nothing here changes a fact: indexability, blockers and evidence are
 * what the crawl stored; a destination never becomes healthy, only expected.
 *
 * What a URL declares, per blocker of its indexation (`INDEXABILITY_BLOCKERS`):
 * - `noindex`: accepted by the `noindex` condition when a rule requires or allows it, or, when no
 *   rule states that condition, by an expectation of `not-indexable`. A `forbidden` noindex is not
 *   accepted whatever the expectation says: the condition decides its own state.
 * - `canonical` (its canonical is elsewhere): accepted by an expectation of `not-indexable`, which no
 *   condition covers.
 * - `robots` (blocked by robots.txt): accepted by the `robots` condition when required or allowed.
 *   An expectation of `not-indexable` does not accept it: a block keeps crawlers from reading a
 *   page, not from listing the URL, so it is no proof of being out of the index.
 * - `redirect`, `http-error`: never. A destination that redirects or fails is wrong whatever the
 *   user expects of its indexation.
 * Each blocker is accepted on its own: allowing a `noindex` says nothing about a robots.txt block
 * or a canonical elsewhere on the same URL.
 *
 * It is app policy, not an SEO fact: search engines ignore an hreflang to a `noindex` URL and a
 * canonical to one is a conflicting signal. The app takes what the user declared as the answer, and
 * reports it only where something else is wrong.
 *
 * A configuration of a meaning older than `RELATIONS_SEMANTICS` accepts none of it: an analysis is
 * read, and repeated, as it was made.
 */

export const relationsApply = (site: Pick<Site, 'config'>) =>
  semanticsOf(site.config) >= RELATIONS_SEMANTICS

type Declared = Pick<AuditedUrl, 'intent' | 'conditions'> & { indexability: Indexability }

/** The blockers of a URL's indexation that what is declared of it accepts. */
export function acceptedBlockers(url: Declared): ReadonlySet<IndexabilityBlocker> {
  const accepted = new Set<IndexabilityBlocker>()
  const { noindex, robots } = url.conditions
  if (
    noindex.requirement === null
      ? url.intent === 'not-indexable'
      : noindex.requirement !== 'forbidden'
  ) {
    accepted.add('noindex')
  }
  if (url.intent === 'not-indexable') accepted.add('canonical')
  if (robots.requirement === 'required' || robots.requirement === 'allowed') accepted.add('robots')
  return accepted
}

/**
 * The URL is out of the index, and everything that keeps it out is what was declared of it. A URL
 * the crawl could not judge (`unknown`), or that something unexpected also stands in the way of, is
 * not: expecting a noindex does not make a robots.txt block expected.
 */
export function isExpectedOut(url: Declared): boolean {
  if (url.indexability.state !== 'not-indexable') return false
  const accepted = acceptedBlockers(url)
  return url.indexability.blockers.every((blocker) => accepted.has(blocker))
}

/** The blockers that say how the index treats a URL, as opposed to how the URL answers. */
const INDEXING_BLOCKERS: readonly IndexabilityBlocker[] = ['noindex', 'canonical', 'robots']

/**
 * The blockers of `destination` that findings of `origin` about it do not report, because they are
 * expected: those its own declarations accept, and all of them (but for how it answers) when the
 * origin is itself expected to be out of the index, since search engines do not read what a URL
 * that is not indexed declares, and the destination's own findings stand on their own.
 * Always empty under a configuration older than `RELATIONS_SEMANTICS`.
 */
export function excusedBlockers(
  origin: AuditedUrl,
  destination: AuditedUrl,
  site: Pick<Site, 'config'>,
): ReadonlySet<IndexabilityBlocker> {
  if (!relationsApply(site)) return new Set()
  if (isExpectedOut(origin)) return new Set(INDEXING_BLOCKERS)
  const accepted = acceptedBlockers(destination)
  return new Set(INDEXING_BLOCKERS.filter((blocker) => accepted.has(blocker)))
}

/**
 * Whether the destination of an alternate not linking back is no news: either end is expected to be
 * out of the index, so search engines do not read the annotations of that end anyway.
 */
export function excusesMissingReturn(
  origin: AuditedUrl,
  destination: AuditedUrl,
  site: Pick<Site, 'config'>,
): boolean {
  return relationsApply(site) && (isExpectedOut(origin) || isExpectedOut(destination))
}

/**
 * Whether what a URL is told by the links that reach it is no news: it is expected to be out of the
 * index, so what links to it does not matter for it. An indexable URL that only noindex pages link to
 * stays reported, however expected those pages are: the links are what it has.
 */
export const excusesInlinks = (url: AuditedUrl, site: Pick<Site, 'config'>) =>
  relationsApply(site) && isExpectedOut(url)
