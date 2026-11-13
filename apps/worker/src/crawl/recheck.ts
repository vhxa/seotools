import {
  URL_SCOPED_ISSUES,
  canSettleIssue,
  compileAuditSnapshot,
  crawlUrlHash,
  isInternalUrl,
  parseRobots,
  stripIgnoredParameters,
  type AuditResolver,
  type AuditSnapshot,
  type CrawlLinkKind,
  type CrawlUrlSource,
  type PageIssueId,
  type VerificationOutcome,
} from '@seotools/core'
import type { CrawlUrl, CrawlUrlResult } from '@seotools/db'
import { conditionStatesOf } from './conditions'
import {
  CHECKS,
  applyFindingDismissals,
  applyAuditPolicyKeeping,
  type Finding,
} from './issue-checks'
import { SiteContextError } from './site-context'
import { auditUrl, type AuditedUrl, type RobotsFile, type Site } from './site-audit'

export { SiteContextError }

const refuse = (what: string) => () => {
  throw new SiteContextError(what)
}

/** What of a URL's place in the site is only known by looking at the whole site. */
const SITE_FIELDS = [
  'anchorsIn',
  'htmlAnchorsIn',
  'renderedAnchorsFrom',
  'renderedLinksTo',
  'renderedAnchorsOut',
  'followedAnchorsIn',
  'anchorsFromIndexable',
  'sitemaps',
  'sitemapsAmbiguous',
  'linksTo',
  'clickDepth',
] as const

/**
 * The URL as a recheck knows it: its own answer, and nothing the last crawl said about the rest of
 * the site. Fields that come from the link graph or the sitemaps throw when read, so that a check
 * that needs them cannot quietly run on zeros.
 */
function withoutSiteContext(url: AuditedUrl): AuditedUrl {
  for (const field of SITE_FIELDS) {
    Object.defineProperty(url, field, { get: refuse(`the ${field} of a URL`), configurable: true })
  }
  return url
}

/**
 * A site that knows nothing but the time, the configuration and whether the site answers at all.
 * Every other part of it throws when read.
 */
function siteOfARecheck(input: { now: Date; config: AuditSnapshot; answered: boolean }): Site {
  const site = { now: input.now, config: input.config, answered: input.answered } as Site
  const unknown: Record<string, string> = {
    urls: 'the other URLs of the site',
    titles: 'the titles of the other pages',
    descriptions: 'the descriptions of the other pages',
    h1s: 'the headings of the other pages',
    texts: 'the texts of the other pages',
    nearDuplicates: 'the texts of the other pages',
    sitemapCoverage: 'the sitemaps',
    linksComplete: 'all internal links',
    htmlLinksComplete: 'all HTML links',
    rendersUnobserved: 'render coverage',
  }
  for (const [field, what] of Object.entries(unknown)) {
    Object.defineProperty(site, field, { get: refuse(what) })
  }
  site.get = refuse('the other URLs of the site')
  return site
}

/** What a recheck has besides the URLs themselves. */
export interface RecheckContext {
  renderedBase?: boolean
  identity?: (url: string) => string
  host: string
  now: Date
  /** The audit configuration in force when the recheck ran. */
  config: AuditSnapshot
  resolver: AuditResolver
  /** `robots.txt` as it answered to this recheck, by origin; an origin that was not asked is absent. */
  robots: ReadonlyMap<string, RobotsFile>
  /**
   * Whether the site answered at the last full crawl. Only used to tell a URL the crawler merely
   * tried from one that is linked: see `linksIn`.
   */
  answered: boolean
}

export function recheckContext(input: {
  renderedBase?: boolean
  ignoredParameters?: readonly string[]
  host: string
  now: Date
  config: AuditSnapshot
  /**
   * What each origin's `robots.txt` answered to the recheck: its status (`null`: no answer) and its
   * text (`null`: none). What the status settles is `robotsConclusive`.
   */
  robotsTexts: ReadonlyMap<string, { status: number | null; text: string | null }>
  answered: boolean
}): RecheckContext {
  const robots = new Map<string, RobotsFile>()
  for (const [origin, { status, text }] of input.robotsTexts) {
    robots.set(origin, { parsed: text !== null ? parseRobots(text) : null, status })
  }
  return {
    identity: (url) => stripIgnoredParameters(url, input.ignoredParameters ?? [], input.host),
    renderedBase: input.renderedBase,
    host: input.host,
    now: input.now,
    config: input.config,
    resolver: compileAuditSnapshot(input.config, input.host),
    robots,
    answered: input.answered,
  }
}

/**
 * Counts the anchors a page has to other URLs of the site the way a crawl stores them (once per
 * target and kind, never the page itself), so the two agree on `no-outgoing-links`.
 */
export function createAnchorCounter(host: string, pageUrl: string) {
  const seen = new Set<string>()
  let internal = 0
  let nofollow = 0
  return {
    add(url: string, kind: CrawlLinkKind) {
      if (kind !== 'anchor' && kind !== 'anchor-nofollow') return
      if (url === pageUrl || !isInternalUrl(url, host)) return
      const key = `${kind}:${url}`
      if (seen.has(key)) return
      seen.add(key)
      internal++
      if (kind === 'anchor-nofollow') nofollow++
    },
    get internal() {
      return internal
    },
    get nofollow() {
      return nofollow
    },
  }
}

export interface RecheckedUrl {
  url: string
  source: CrawlUrlSource
  /** What it answered to the recheck, as a crawl would have kept it. */
  answer: CrawlUrlResult
  /**
   * Whether the last full crawl found a link to it. It decides only whether the crawler merely
   * tried the URL on its own (other schemes and `www` of the home page), which is not blamed for
   * failing. Nothing else of the link graph is used.
   */
  linksIn: number
  /** Anchors to other URLs of the site that the fresh page has: `createAnchorCounter`. */
  anchors: { internal: number; nofollow: number }
}

/**
 * What a recheck concludes about a URL: whether it is audited and what is expected of it under the
 * configuration in force, what it saw, and the findings among the issues that can be told from the
 * URL itself (`URL_SCOPED_ISSUES`). The checks are the ones of a full crawl, with the same audit
 * policy applied after them; the rest of the site is not available to them.
 *
 * An issue that needs the site is not in the findings and not in `unchecked`: it is not a recheck's
 * to say. One that was meant to be settled here and could not be (a check that reached for the
 * site) is in `unchecked`, so it is never read as absent.
 */
/**
 * The URL and the site a check is run against in a recheck: the fresh answer, and nothing of the
 * rest of the site (see `withoutSiteContext` and `siteOfARecheck`).
 */
export function recheckSubject(
  input: RecheckedUrl,
  context: RecheckContext,
): { url: AuditedUrl; site: Site } {
  const row: CrawlUrl = {
    ...input.answer,
    seq: null,
    foundFrom: null,
    foundKind: null,
    crawlId: 'recheck',
    url: input.url,
    urlHash: crawlUrlHash(input.url),
    scope: 'internal',
    source: input.source,
    depth: 0,
    state: 'done',
    fetchedAt: context.now,
  }
  const url = withoutSiteContext(auditUrl(row, context.robots, context.resolver, context.identity))
  url.linksIn = input.linksIn
  url.htmlInternalAnchorsOut = input.anchors.internal
  url.internalAnchorsOut = input.anchors.internal
  url.nofollowAnchorsOut = input.anchors.nofollow
  const site = siteOfARecheck({
    now: context.now,
    config: context.config,
    answered: context.answered,
  })
  site.identity = context.identity
  return { url, site }
}

export function evaluateRecheck(input: RecheckedUrl, context: RecheckContext): VerificationOutcome {
  const { url, site } = recheckSubject(input, context)
  const found: Finding[] = []
  const unchecked: PageIssueId[] = []
  for (const issue of URL_SCOPED_ISSUES) {
    if (!canSettleIssue(issue, context.renderedBase)) {
      unchecked.push(issue)
      continue
    }
    try {
      const result = CHECKS[issue](url, site)
      if (result === true) found.push({ issue })
      else if (Array.isArray(result)) {
        if (result.length > 0) found.push({ issue, details: result })
      } else if (result !== false) {
        found.push({ issue, ...(result.evidence ? { evidence: result.evidence } : {}) })
      }
    } catch (error) {
      if (!(error instanceof SiteContextError)) throw error
      unchecked.push(issue)
    }
  }

  if (context.renderedBase) url.documentObservation = 'unobserved'
  const policy = applyAuditPolicyKeeping(url, found)
  const { found: kept, accepted } = applyFindingDismissals(url, site, policy.kept, policy.accepted)
  return {
    audit: {
      participation: url.participation,
      participationRule: url.participationRule?.id ?? null,
      intent: url.intent,
      intentRule: url.intentRule?.id ?? null,
      // The sitemaps are not read by a recheck: what rules ask of them is stated, not observed.
      conditions: conditionStatesOf(url, site),
      indexability: url.indexability.state,
      blockers: url.indexability.blockers,
    },
    findings: kept,
    // Only what a rule says of this URL's own findings: what other URLs declare of it is relations,
    // which need the site and are not a recheck's to say.
    accepted: accepted.map(({ issue, details, acceptance }) => ({
      issue,
      ...(details ? { details } : {}),
      acceptance,
    })),
    unchecked,
  }
}
