import {
  AUDIT_CONDITIONS,
  type AuditCondition,
  type ConditionObservation,
  type ConditionStates,
} from '@seotools/core'
import { SiteContextError } from './site-context'
import { isGuess, type AuditedUrl, type Site } from './site-audit'

/**
 * A URL whose expectation can be judged: a page that answered successfully and that the crawler did
 * not only try on its own. Resources, redirects, failures and guesses have nothing to be required of.
 */
export const judgeable = (url: AuditedUrl, site: Site) => url.contentPage && !isGuess(url, site)

/**
 * Whether a URL has a condition, as far as the crawl can tell. Presence is proven by what was read;
 * absence only by input that was whole, so that what could not be read is never taken for missing:
 * - `noindex` / `nofollow`: a page that was parsed whole (its answer, headers and all of its HTML).
 * - `robots`: a robots.txt of the URL's origin that answered, or was not there (a 4xx).
 * - `sitemap`: every sitemap of the site was read, in a crawl that requested every URL it found
 *   (`Site.sitemapCoverage`). Listing is a `<loc>`: an alternate or an image an entry names is not
 *   listed, and a crawl that did not record which a sitemap did cannot say (`sitemapsAmbiguous`).
 * Anything that is not judgeable is `unknown`. Reading the sitemaps in a recheck throws
 * `SiteContextError`: a recheck does not read them.
 */
export function presenceOf(
  condition: AuditCondition,
  url: AuditedUrl,
  site: Site,
): ConditionObservation {
  if (!judgeable(url, site)) return 'unknown'
  switch (condition) {
    case 'noindex':
      return url.noindex ? 'present' : url.directivesKnown ? 'absent' : 'unknown'
    case 'canonical':
      return url.canonicalised ? 'present' : url.directivesKnown ? 'absent' : 'unknown'
    case 'unlinked':
      if (url.anchorsIn > 0) return 'absent'
      return site.linksComplete ? 'present' : 'unknown'
    case 'nofollow':
      return url.nofollow ? 'present' : url.directivesKnown ? 'absent' : 'unknown'
    case 'robots':
      return url.robotsBlocked ? 'present' : url.robotsKnown ? 'absent' : 'unknown'
    case 'sitemap':
      if (url.sitemaps > 0) return 'present'
      // Named by a sitemap that does not say whether it listed the URL: neither present nor absent.
      if (url.sitemapsAmbiguous > 0) return 'unknown'
      return site.sitemapCoverage === 'complete' ? 'absent' : 'unknown'
  }
}

/**
 * The conditions rules stated for a URL, with the rule that did and what the crawl saw. What a
 * recheck cannot see (the sitemaps) is not looked at: `observed` is `null`, not `unknown`.
 */
export function conditionStatesOf(url: AuditedUrl, site: Site): ConditionStates {
  const states: ConditionStates = {}
  for (const condition of AUDIT_CONDITIONS) {
    const { requirement, rule } = url.conditions[condition]
    if (requirement === null) continue
    let observed: ConditionObservation | null
    try {
      observed = presenceOf(condition, url, site)
    } catch (error) {
      if (!(error instanceof SiteContextError)) throw error
      observed = null
    }
    states[condition] = { requirement, rule: rule?.id ?? null, observed }
  }
  return states
}
