import { ISSUE_BASIS } from '@seotools/core'
import {
  AUDIT_CONDITIONS,
  HREFLANG_SOURCES,
  MAX_EVIDENCE_ITEMS,
  PAGE_ISSUE_IDS,
  resolveThresholds,
  type AuditThresholds,
  type AuditSnapshot,
  type FindingDismissal,
  boundedText,
  boundedUrl,
  parseIssueEvidence,
  type AuditCondition,
  type CanonicalEvidence,
  type CrawlPageFacts,
  type DeclaredCanonical,
  type HreflangEntry,
  type ImageProblem,
  type IndexabilityBlocker,
  type IssueEvidence,
  type LinkProblem,
  type PageIssueId,
} from '@seotools/core'
import type { FindingAcceptance } from '@seotools/core/crawl/acceptance'
import { renderDifferenceChecks } from './render-differences'
import { graphAbsenceKnown } from './observed-inputs'
import { judgeable, presenceOf } from './conditions'
import { MAX_NEAR_PARTNERS } from './fingerprint'
import { isValidHreflang, isWellFormedLanguageTag } from './language-codes'
import {
  excusedBlockers,
  excusesInlinks,
  excusesMissingReturn,
  expectedOutAcceptance,
  isExpectedOut,
  relationAcceptance,
  relationsApply,
} from './relations'
import {
  comparable,
  followRedirects,
  isGuess,
  REFUSES_BOTS,
  unavailableAfter,
  type AuditedUrl,
  type Site,
} from './site-audit'

/**
 * A finding that comes with evidence, which is what an object says. Without `evidence` it is a
 * finding the crawl cannot back up: the page was parsed before that was kept.
 */
interface Found {
  details?: string[]
  evidence?: IssueEvidence
}

/**
 * Whether a URL has the issue. A list says so too, unless empty, and is what the issue details; an
 * object does, and is what backs it up.
 */
type Verdict = boolean | string[] | Found
export type Check = (url: AuditedUrl, site: Site) => Verdict

/** The figures of the configuration being applied (`AUDIT_THRESHOLDS`), resolved once per config. */
const resolved = new WeakMap<object, AuditThresholds>()
function figures(site: Pick<Site, 'config'>): AuditThresholds {
  let values = resolved.get(site.config)
  if (!values) {
    values = resolveThresholds(site.config.thresholds)
    resolved.set(site.config, values)
  }
  return values
}
/** Under this much text, a page has no use for subsections. */
const SUBSECTIONS_MIN_WORDS = 300
const DOCUMENT_MAX_BYTES = 2 * 1024 * 1024
const SITEMAP_MAX_ENTRIES = 50_000
const SITEMAP_MAX_BYTES = 50 * 1024 * 1024

/** The issue applies to pages that answered and were parsed, not to redirects or failures. */
const onPage =
  (test: (url: AuditedUrl, facts: CrawlPageFacts, site: Site) => Verdict): Check =>
  (url, site) =>
    url.contentPage && url.facts ? test(url, url.facts, site) : false

/** The issue is about how a URL of the site answered, which only matters if it is not a guess. */
const answer =
  (test: (url: AuditedUrl, site: Site) => boolean): Check =>
  (url, site) =>
    url.internal && url.url.state === 'done' && !isGuess(url, site) && test(url, site)

/** The URL has to have the condition, and the crawl read enough to say it does not. */
const requiredMissing =
  (condition: AuditCondition): Check =>
  (url, site) =>
    url.conditions[condition].requirement === 'required' &&
    judgeable(url, site) &&
    presenceOf(condition, url, site) === 'absent'

const statusIn = (url: AuditedUrl, min: number, max: number) =>
  url.url.statusCode !== null && url.url.statusCode >= min && url.url.statusCode <= max

/** The values given to a directive that has them, e.g. `max-snippet:20` gives `['20']`. */
const valuesOf = (directives: ReadonlySet<string>, name: string) =>
  [...directives].flatMap((directive) =>
    directive.startsWith(`${name}:`) ? [directive.slice(name.length + 1)] : [],
  )

const blank = (text: string | null | undefined) => !text || text.trim() === ''

/** A finding with its evidence. Evidence that does not check out is left out, not stored. */
const backedBy = (evidence: IssueEvidence): Found => {
  const checked = parseIssueEvidence(evidence)
  return checked ? { evidence: checked } : {}
}

/** Most pages of a long list to look at for ones to show: the rest is only counted. */
const MAX_SCANNED = 50

/**
 * The finding that a page shares what makes it a duplicate with other pages, and which they are.
 * `group` holds the audited indexable pages that share it (`Site.titles` and the rest), so a page
 * left out of the audit is never named as a copy, and is not counted in the total.
 */
function duplicates(self: AuditedUrl, group: readonly AuditedUrl[] | undefined): Verdict {
  if (!group || group.length < 2) return false
  const others = group.length - (self.excluded ? 0 : 1)
  const urls: string[] = []
  for (let i = 0; i < group.length && i < MAX_SCANNED && urls.length < MAX_EVIDENCE_ITEMS; i++) {
    const url = boundedUrl(group[i]!.url.url)
    if (group[i] !== self && url) urls.push(url)
  }
  return backedBy({ kind: 'related-urls', total: others, urls })
}

/** The declarations of a page's canonical that `pick` says are the problem. */
function declarations(facts: CrawlPageFacts, pick: (declared: DeclaredCanonical) => boolean) {
  const picked = facts.canonicals.filter(pick)
  const items: CanonicalEvidence[] = picked.slice(0, MAX_EVIDENCE_ITEMS).map((declared) => ({
    raw: boundedText(declared.raw),
    url: boundedUrl(declared.url),
    inHead: declared.inHead,
    source: declared.source ?? null,
  }))
  return backedBy({ kind: 'canonicals', total: picked.length, items })
}

/** The elements of a page the crawl kept as examples of a problem, if it kept any. */
const imageProblem = (problem: ImageProblem, total: (facts: CrawlPageFacts) => number): Check =>
  onPage((_, facts) => {
    const count = total(facts)
    if (count === 0) return false
    const items = facts.evidence?.images?.[problem]
    return items ? backedBy({ kind: 'images', total: count, items }) : {}
  })

const linkProblem = (problem: LinkProblem, total: (facts: CrawlPageFacts) => number): Check =>
  onPage((_, facts) => {
    const count = total(facts)
    if (count === 0) return false
    const items = facts.evidence?.links?.[problem]
    return items ? backedBy({ kind: 'links', total: count, items }) : {}
  })

const sourcesOf = (entries: readonly HreflangEntry[]) =>
  HREFLANG_SOURCES.filter((source) => entries.some((entry) => entry.source === source))

/** The hreflang issue is about some of a page's entries: the sources of those are its detail. */
const hreflang =
  (test: (url: AuditedUrl, entries: HreflangEntry[], site: Site) => HreflangEntry[]): Check =>
  (url, site) => {
    if (!url.contentPage || url.hreflang.length === 0) return false
    return sourcesOf(test(url, url.hreflang, site))
  }

/**
 * The entries pointing at a URL of the site that `test` says is wrong. What the page and the URL it
 * points at declare of their own indexation is for `test` to weigh (see `relations.ts`).
 */
const hreflangTargets =
  (test: (target: AuditedUrl, page: AuditedUrl, site: Site) => boolean) =>
  (page: AuditedUrl, entries: HreflangEntry[], site: Site) =>
    entries.filter((entry) => {
      const target = site.get(entry.url)
      return target !== undefined && target !== page && target.internal && test(target, page, site)
    })

/**
 * What is wrong with a URL an hreflang entry points at, and when that is no news under the policy of
 * `relations.ts`. Apart, so that the check and what is accepted say the same thing of each entry.
 */
const HREFLANG_RELATIONS = {
  'hreflang-no-return': {
    wrong: (target: AuditedUrl, page: AuditedUrl, site: Site) =>
      target.contentPage &&
      target.documentObservation !== 'unobserved' &&
      target.documentObservation !== 'redirected' &&
      page.blockersKnown !== false &&
      !target.hreflang.some(
        (entry) => identityOf(site, entry.url) === identityOf(site, page.url.url),
      ),
    excused: excusesMissingReturn,
    blockers: (target: AuditedUrl): readonly IndexabilityBlocker[] => target.indexability.blockers,
  },
  'hreflang-non-canonical': {
    wrong: (target: AuditedUrl) => target.contentPage && target.canonicalised,
    excused: (page: AuditedUrl, target: AuditedUrl, site: Site) =>
      excusedBlockers(page, target, site).has('canonical'),
    blockers: (): readonly IndexabilityBlocker[] => ['canonical'],
  },
  'hreflang-noindex': {
    wrong: (target: AuditedUrl) => target.contentPage && target.noindex,
    excused: (page: AuditedUrl, target: AuditedUrl, site: Site) =>
      excusedBlockers(page, target, site).has('noindex'),
    blockers: (): readonly IndexabilityBlocker[] => ['noindex'],
  },
} as const

const unexcused =
  (issue: keyof typeof HREFLANG_RELATIONS) =>
  (target: AuditedUrl, page: AuditedUrl, site: Site) => {
    const relation = HREFLANG_RELATIONS[issue]
    return (
      page.blockersKnown !== false &&
      relation.wrong(target, page, site) &&
      !relation.excused(page, target, site)
    )
  }

/** What the links that reach a URL say of it, whatever is expected of the URL. */
const INLINKS_WRONG = {
  'only-nofollow-inlinks': (url: AuditedUrl) => url.anchorsIn > 0 && url.followedAnchorsIn === 0,
  'only-noindex-inlinks': (url: AuditedUrl) => url.anchorsIn > 0 && url.anchorsFromIndexable === 0,
} as const

/** The blockers that say how the index treats a URL, as opposed to how the URL answers. */
const INDEXING_BLOCKERS: ReadonlySet<IndexabilityBlocker> = new Set([
  'noindex',
  'canonical',
  'robots',
])

/** A URL of the site that answered with an error, or did not answer: a broken reference. */
const fails = (target: AuditedUrl) =>
  target.url.state === 'done' && (target.url.error !== null || statusIn(target, 400, 599))

const redirects = (target: AuditedUrl) =>
  target.url.state === 'done' && target.url.kind === 'redirect'

/** What keeps a URL that answered from being indexed, leaving out how it answered. */
const indexingBlockers = (target: AuditedUrl) =>
  target.indexability.state === 'not-indexable'
    ? target.indexability.blockers.filter((blocker) => INDEXING_BLOCKERS.has(blocker))
    : []

/** The other URL of the site a page's canonical leads to, if the crawl knows it. */
function canonicalTarget(url: AuditedUrl, site: Site): AuditedUrl | null {
  const target = url.url.canonical ? site.get(url.url.canonical) : undefined
  return target && target !== url && target.internal ? target : null
}

/**
 * The URL a canonical leads to when it answered, but something in the index keeps it out: a
 * `noindex`, its own canonical elsewhere, a robots.txt block. A failing or redirecting one is a
 * broken reference (`canonical-broken`, `canonical-redirect`) instead.
 */
function notIndexableCanonical(url: AuditedUrl, site: Site): AuditedUrl | null {
  const target = canonicalTarget(url, site)
  return target && !fails(target) && !redirects(target) && indexingBlockers(target).length > 0
    ? target
    : null
}

/** The finding that a URL's reference leads to `target`, with it as the evidence. */
const pointsAt = (target: AuditedUrl, details?: string[]): Found => {
  const address = boundedUrl(target.url.url)
  return {
    ...backedBy({ kind: 'related-urls', total: 1, urls: address ? [address] : [] }),
    ...(details ? { details } : {}),
  }
}

/** The URLs of the site a page's anchors link to that `wrong` picks, once each, as evidence. */
const linkedTargets =
  (
    wrong: (target: AuditedUrl) => boolean,
    list: (url: AuditedUrl) => readonly AuditedUrl[] = (url) => url.linksTo,
  ): Check =>
  (url) => {
    if (!url.contentPage) return false
    const picked = new Set<AuditedUrl>()
    for (const target of list(url)) if (target !== url && wrong(target)) picked.add(target)
    if (picked.size === 0) return false
    const urls: string[] = []
    for (const target of picked) {
      if (urls.length >= MAX_EVIDENCE_ITEMS) break
      const address = boundedUrl(target.url.url)
      if (address) urls.push(address)
    }
    return backedBy({ kind: 'related-urls', total: picked.size, urls })
  }

/**
 * The image a page offers to be shared with, when the crawl requested it and it does not load: a
 * failure, or a redirect. One the crawl did not request (on another site) is not known to be broken.
 */
function brokenShareImage(url: AuditedUrl, facts: CrawlPageFacts, site: Site): Found | false {
  const address = facts.social?.image ?? facts.social?.twitterImage
  const target = address ? site.get(address) : undefined
  if (!target || target === url) return false
  const failed = target.internal
    ? fails(target)
    : fails(target) && !REFUSES_BOTS.has(target.url.statusCode ?? 0)
  return failed || redirects(target) ? pointsAt(target) : false
}

/** The Open Graph properties a page that has some of them lacks. */
const OG_REQUIRED = [
  ['og:title', 'title'],
  ['og:type', 'type'],
  ['og:image', 'image'],
  ['og:url', 'url'],
] as const

/** Whether `declared` is where the page says it lives: its canonical, or itself without one. */
const identityOf = (site: Site, url: string) => site.identity?.(url) ?? url
const ogUrlDiffers = (url: AuditedUrl, declared: string, site: Site) =>
  identityOf(site, declared) !== identityOf(site, url.url.canonical ?? url.url.url)

/** The typed nodes of a page's JSON-LD that lack what Google asks, as `Type: missing, …`. */
const structuredProblems = (facts: CrawlPageFacts, level: 'required' | 'recommended') =>
  (facts.structuredDataProblems ?? [])
    .filter((problem) => problem.level === level)
    .map((problem) => `${problem.type}: ${problem.missing.join(', ')}`)

/** A URL can have thousands of them, and looking for repeats is quadratic. */
const MAX_PATH_SEGMENTS = 50
const pathSegments = (url: AuditedUrl) =>
  url.parsed.pathname.split('/').filter(Boolean).slice(0, MAX_PATH_SEGMENTS)

/** `/a/a/` or `/a/b/a/b/`: what a relative link gone wrong produces, without end. */
function hasRepeatedSegments(segments: readonly string[]): boolean {
  for (let size = 1; size <= segments.length / 2; size++) {
    for (let start = 0; start + 2 * size <= segments.length; start++) {
      let same = true
      for (let i = 0; i < size && same; i++)
        same = segments[start + i] === segments[start + size + i]
      if (same) return true
    }
  }
  return false
}

const TRACKING_PARAMETERS = new Set([
  'gclid',
  'gbraid',
  'wbraid',
  'dclid',
  'fbclid',
  'msclkid',
  'ttclid',
  'twclid',
  'yclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
])
const parameterNames = (url: AuditedUrl) =>
  [...url.parsed.searchParams.keys()].map((name) => name.toLowerCase())

const hasTrackingParameters = (url: AuditedUrl) =>
  parameterNames(url).some((name) => name.startsWith('utm_') || TRACKING_PARAMETERS.has(name))

const SEARCH_PATH = new Set(['search', 'buscar', 'busqueda', 'b%c3%basqueda', 'suche', 'recherche'])
const SEARCH_PARAMETERS = new Set(['s', 'q', 'query', 'search', 'keyword', 'keywords'])

/** What each issue of `PAGE_ISSUES` looks for. Each check says itself which URLs it applies to. */
export const CHECKS: Record<PageIssueId, Check> = {
  ...renderDifferenceChecks(figures),
  'lcp-poor': (url) => (url.vitals?.lcp ?? 0) > 4000,
  'inp-poor': (url) => (url.vitals?.inp ?? 0) > 500,
  'cls-poor': (url) => (url.vitals?.cls ?? 0) > 0.25,
  // --- what is expected of a URL's indexation, against what the crawl saw ---------------------
  // Only for pages that answered (not images, stylesheets, redirects or what the crawler only tried),
  // and only for the blockers that say something the page's other findings do not: an error response
  // has its own response-code finding, and not knowing (`unknown`) is not a finding. Nothing declared
  // means a page is expected to be indexable, and then its generic findings (`noindex`, a canonical
  // elsewhere, a robots.txt block) already say so: this one is for what the user stated.
  'expected-indexable-blocked': (url, site) =>
    url.intent === 'indexable' &&
    url.intentRule !== null &&
    judgeable(url, site) &&
    url.indexability.state === 'not-indexable'
      ? url.indexability.blockers.filter((blocker) => INDEXING_BLOCKERS.has(blocker))
      : false,
  'expected-not-indexable-but-indexable': (url, site) =>
    url.intent === 'not-indexable' &&
    judgeable(url, site) &&
    url.indexability.state === 'indexable',

  // --- what rules require or forbid of one directive or file ----------------------------------
  // Only for what a rule states, only for pages that answered, and only when the crawl could tell:
  // what was not read whole, or not at all, is not missing. The finding for a forbidden directive
  // or block is the generic one (`noindex`, `nofollow`, `robots-blocked`), which `applyAuditPolicy`
  // keeps where a rule forbids it.
  'noindex-required-missing': requiredMissing('noindex'),
  'nofollow-required-missing': requiredMissing('nofollow'),
  'robots-block-required-missing': requiredMissing('robots'),
  'sitemap-required-missing': requiredMissing('sitemap'),
  'canonical-required-missing': requiredMissing('canonical'),
  'unlinked-required-missing': requiredMissing('unlinked'),
  'canonical-forbidden-present': (url, site) =>
    url.conditions.canonical.requirement === 'forbidden' &&
    judgeable(url, site) &&
    presenceOf('canonical', url, site) === 'present',
  'sitemap-forbidden-present': (url, site) =>
    url.conditions.sitemap.requirement === 'forbidden' &&
    judgeable(url, site) &&
    presenceOf('sitemap', url, site) === 'present',

  // --- response codes ------------------------------------------------------
  'no-response': answer((url) => url.url.error !== null),
  'server-error': answer((url) => statusIn(url, 500, 599)),
  'client-error': answer((url) => statusIn(url, 400, 499)),
  'redirect-loop': answer(
    (url, site) => url.url.kind === 'redirect' && followRedirects(url, site).loop,
  ),
  'soft-404-confirmed': onPage((_, facts) => facts.notFoundHeadline),
  'soft-404-possible': onPage((_, facts) => facts.notFoundText && !facts.notFoundHeadline),
  'redirect-chain': answer((url, site) => {
    if (url.url.kind !== 'redirect') return false
    const { hops, loop } = followRedirects(url, site)
    return !loop && hops > 1
  }),
  'refresh-redirect': onPage((_, facts) => facts.refresh !== null),
  'robots-blocked': answer((url) => url.robotsBlocked),
  'redirect-3xx': answer((url) => url.url.kind === 'redirect'),
  // Temporary, so search engines keep the old URL. Not a guess, which the crawler only tried.
  'redirect-temporary': answer(
    (url) =>
      url.url.kind === 'redirect' && (url.url.statusCode === 302 || url.url.statusCode === 307),
  ),
  // Read from the answer, never from facts: it exists in every crawl.
  'slow-response': (url, site) =>
    url.contentPage && (url.url.responseTimeMs ?? 0) > figures(site).responseTimeMaxMs,
  'broken-external-link': (url) =>
    !url.internal &&
    url.url.state === 'done' &&
    (url.url.error !== null ||
      (statusIn(url, 400, 599) && !REFUSES_BOTS.has(url.url.statusCode ?? 0))),

  // --- directives ----------------------------------------------------------
  'directive-outside-head': onPage((_, facts) => facts.robotsOutsideHead > 0),
  'directives-conflict': onPage(
    ({ directives: d }) =>
      ((d.has('noindex') || d.has('none')) && (d.has('index') || d.has('all'))) ||
      ((d.has('nofollow') || d.has('none')) && (d.has('follow') || d.has('all'))),
  ),
  'directives-conflict-snippets': onPage(({ directives }) => {
    const limits = valuesOf(directives, 'max-snippet')
    return (
      (directives.has('nosnippet') && limits.some((limit) => limit !== '0')) ||
      ['max-snippet', 'max-image-preview', 'max-video-preview'].some(
        (name) => valuesOf(directives, name).length > 1,
      )
    )
  }),
  // A robots.txt block keeps search engines from reading the page, so a noindex or a canonical
  // elsewhere it declares is never seen: the URL can stay listed, and its signals do not go where
  // the canonical says. Reported whatever is expected of the page.
  'directives-unreadable': onPage((url) => {
    if (!url.robotsBlocked) return false
    const unread = [
      ...(url.noindex ? ['noindex'] : []),
      ...(url.canonicalised ? ['canonical'] : []),
    ]
    return unread
  }),
  noindex: onPage((url) => url.noindex),
  nofollow: onPage((url) => url.nofollow),
  nosnippet: onPage(
    ({ directives }) => directives.has('nosnippet') || directives.has('max-snippet:0'),
  ),
  // `-1` places no limit.
  'max-snippet-limited': onPage(({ directives }) =>
    valuesOf(directives, 'max-snippet').some((limit) => Number(limit) > 0),
  ),
  noimageindex: onPage(({ directives }) => directives.has('noimageindex')),
  'unavailable-after-expired': onPage(({ directives }, _facts, site) => {
    const date = unavailableAfter(directives)
    return date !== null && date <= site.now
  }),
  'unavailable-after-future': onPage(({ directives }, _facts, site) => {
    const date = unavailableAfter(directives)
    return date !== null && date > site.now
  }),

  // --- canonicals ----------------------------------------------------------
  // Where the canonical leads. A failing or redirecting URL is a broken reference whatever either
  // end expects; one that cannot be indexed is not news where the page itself is expected out
  // (`excusedBlockers`), and the blockers listed are what keeps it out of the index.
  'canonical-broken': onPage((url, _, site) => {
    const target = canonicalTarget(url, site)
    return target && fails(target) ? pointsAt(target) : false
  }),
  'canonical-redirect': onPage((url, _, site) => {
    const target = canonicalTarget(url, site)
    return target && redirects(target) ? pointsAt(target) : false
  }),
  'canonical-outside-head': onPage((_, facts) =>
    facts.canonicals.some((c) => !c.inHead) ? declarations(facts, (c) => !c.inHead) : false,
  ),
  'canonical-conflict': onPage((_, facts) =>
    new Set(facts.canonicals.map((c) => c.url ?? c.raw)).size > 1
      ? declarations(facts, () => true)
      : false,
  ),
  'canonical-not-indexable': onPage((url, _, site) => {
    const target = notIndexableCanonical(url, site)
    if (!target || url.blockersKnown === false) return false
    const blockers = indexingBlockers(target)
    const excused = excusedBlockers(url, target, site)
    return blockers.every((blocker) => excused.has(blocker)) ? false : pointsAt(target, blockers)
  }),
  'canonical-fragment': onPage((_, facts) =>
    facts.canonicals.some((c) => c.raw.includes('#'))
      ? declarations(facts, (c) => c.raw.includes('#'))
      : false,
  ),
  'canonical-missing': onPage(
    (url, facts) => !url.noindex && facts.canonicals.length === 0 && url.url.canonical === null,
  ),
  'canonical-relative': onPage((_, facts) => {
    const relative = (c: DeclaredCanonical) => !/^https?:\/\//i.test(c.raw.trim())
    return facts.canonicals.some(relative) ? declarations(facts, relative) : false
  }),
  'canonical-repeated': onPage((_, facts) => {
    const values = facts.canonicals.map((c) => c.url ?? c.raw)
    if (new Set(values).size === values.length) return false
    // The declarations of a value that was declared more than once.
    return declarations(facts, (c) => values.filter((v) => v === (c.url ?? c.raw)).length > 1)
  }),

  // --- sitemaps ------------------------------------------------------------
  'sitemap-too-big': ({ internal, url }) => {
    const size = url.data?.sitemapSize
    return (
      internal &&
      size !== undefined &&
      (size.entries > SITEMAP_MAX_ENTRIES || size.bytes > SITEMAP_MAX_BYTES)
    )
  },
  // Listed is a `<loc>` (`AuditedUrl.sitemaps`): an alternate or an image that an entry names does not
  // list it, and a URL that only a sitemap of unrecorded origin names (`sitemapsAmbiguous`) is not
  // claimed to be listed. What keeps it from being indexable is what the crawl stored of it.
  // A sitemap lists a URL that fails or redirects (any file, pages or not), or a page that cannot be
  // indexed, with what keeps it out. Files that are not pages are not meant to be indexed as pages.
  'sitemap-broken': (url) => url.internal && url.sitemaps > 0 && fails(url),
  'sitemap-redirect': (url) => url.internal && url.sitemaps > 0 && redirects(url),
  'sitemap-not-indexable': (url) => {
    if (!url.internal || url.sitemaps === 0 || !url.contentPage) return false
    const blockers = indexingBlockers(url)
    return blockers.length > 0 ? blockers : false
  },
  'indexed-not-in-sitemap': (url) =>
    url.indexed === true && url.sitemaps === 0 && url.sitemapsAmbiguous === 0,
  // Indexable is not indexed: only what confirms it is, and nothing does yet.
  'indexable-not-in-sitemap': (url) =>
    url.indexable && url.indexed !== true && url.sitemaps === 0 && url.sitemapsAmbiguous === 0,

  // --- hreflang ------------------------------------------------------------
  'hreflang-unreachable': hreflang(hreflangTargets(fails)),
  'hreflang-redirect': hreflang(hreflangTargets(redirects)),
  // App policy: omit a missing return where either end is intentionally not indexable.
  // This does not establish whether a search engine indexed or read either URL.
  'hreflang-no-return': hreflang(hreflangTargets(unexcused('hreflang-no-return'))),
  'hreflang-invalid-code': hreflang((_, entries) =>
    entries.filter((entry) => !isValidHreflang(entry.lang)),
  ),
  'hreflang-outside-head': hreflang((_, entries) => entries.filter((entry) => entry.outsideHead)),
  'hreflang-non-canonical': hreflang(hreflangTargets(unexcused('hreflang-non-canonical'))),
  'hreflang-noindex': hreflang(hreflangTargets(unexcused('hreflang-noindex'))),
  'hreflang-same-language': hreflang((_, entries, site) => {
    const urls = new Map<string, Set<string>>()
    for (const { lang, url } of entries) {
      const key = lang.trim().toLowerCase()
      urls.set(key, (urls.get(key) ?? new Set()).add(identityOf(site, url)))
    }
    return entries.filter((entry) => (urls.get(entry.lang.trim().toLowerCase())?.size ?? 0) > 1)
  }),
  'hreflang-no-self': hreflang((url, entries, site) =>
    entries.some((entry) => identityOf(site, entry.url) === identityOf(site, url.url.url))
      ? []
      : entries,
  ),
  'hreflang-no-x-default': hreflang((_, entries) =>
    entries.some((entry) => entry.lang.trim().toLowerCase() === 'x-default') ? [] : entries,
  ),

  // --- title ---------------------------------------------------------------
  'title-missing': onPage((url) => blank(url.url.title)),
  'title-outside-head': onPage((_, facts) => facts.titlesOutsideHead > 0),
  'title-multiple': onPage((_, facts) => facts.titles > 1),
  'title-duplicate': onPage(
    (url, _, site) => url.indexable && duplicates(url, site.titles.get(comparable(url.url.title))),
  ),
  'title-too-long': onPage((url, _, site) => (url.url.title?.length ?? 0) > figures(site).titleMax),
  'title-too-short': onPage(
    (url, _, site) =>
      !blank(url.url.title) && (url.url.title?.length ?? 0) < figures(site).titleMin,
  ),

  // --- meta description ----------------------------------------------------
  'description-multiple': onPage((_, facts) => facts.descriptions > 1),
  'description-outside-head': onPage((_, facts) => facts.descriptionsOutsideHead > 0),
  'description-missing': onPage(({ url }) => blank(url.data?.description)),
  'description-duplicate': onPage(
    (url, _, site) =>
      url.indexable &&
      duplicates(url, site.descriptions.get(comparable(url.url.data?.description))),
  ),
  'description-too-long': onPage(
    ({ url }, _, site) => (url.data?.description?.length ?? 0) > figures(site).descriptionMax,
  ),
  'description-too-short': onPage(
    ({ url }, _, site) =>
      !blank(url.data?.description) &&
      (url.data?.description?.length ?? 0) < figures(site).descriptionMin,
  ),

  // --- headings ------------------------------------------------------------
  'h1-missing': onPage((_, facts) => facts.h1s === 0),
  'h1-multiple': onPage((_, facts) => facts.h1s > 1),
  'heading-empty': onPage((_, facts) => facts.emptyHeadings > 0),
  'heading-skipped-level': onPage((_, facts) => facts.headingLevelSkipped),
  'h2-missing': onPage((_, facts) => facts.h2s === 0 && facts.words >= SUBSECTIONS_MIN_WORDS),
  'h1-duplicate': onPage(
    (url, _, site) =>
      url.indexable && duplicates(url, site.h1s.get(comparable(url.url.data?.h1?.[0]))),
  ),
  'heading-too-long': onPage((_, facts) => facts.longHeadings > 0),

  'html-entities-as-text': onPage(({ url }) => {
    // These texts were decoded once at extraction. Bound each scan, not just the evidence.
    const fields = [
      { field: 'title' as const, text: url.title },
      { field: 'description' as const, text: url.data?.description },
      ...(url.data?.h1 ?? [])
        .slice(0, MAX_EVIDENCE_ITEMS)
        .map((text) => ({ field: 'h1' as const, text })),
    ]
    const items = fields.flatMap(({ field, text }) => {
      const value = text?.slice(0, 16_384)
      const match = value && /&(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i.exec(value)
      return match
        ? [{ field, text: boundedText(value!.slice(Math.max(0, match.index - 40))) }]
        : []
    })
    return items.length > 0 && backedBy({ kind: 'values', total: items.length, items })
  }),

  // --- content -------------------------------------------------------------
  'content-duplicate': onPage(
    (url, facts, site) =>
      url.indexable && facts.textHash !== null && duplicates(url, site.texts.get(facts.textHash)),
  ),
  'content-near-duplicate': onPage((url, _, site) => {
    const partners = site.nearDuplicates.get(url)
    if (!partners) return false
    const urls = partners.flatMap((partner) => boundedUrl(partner.url.url) ?? [])
    return backedBy({
      kind: 'related-urls',
      total: partners.length,
      ...(partners.length >= MAX_NEAR_PARTNERS ? { atLeast: true as const } : {}),
      urls: urls.slice(0, MAX_EVIDENCE_ITEMS),
    })
  }),
  'content-placeholder': onPage((_, facts) => facts.placeholderText),
  'content-thin': onPage((_, facts, site) => facts.words < figures(site).thinWords),

  // --- images --------------------------------------------------------------
  'img-no-alt': imageProblem('no-alt', (facts) => facts.imagesNoAlt),
  'img-empty-alt': imageProblem('empty-alt', (facts) => facts.imagesEmptyAlt),
  'img-too-heavy': (url, site) =>
    url.internal &&
    statusIn(url, 200, 299) &&
    (url.url.contentType ?? '').toLowerCase().startsWith('image/') &&
    (url.url.bytes ?? 0) > figures(site).imageMaxKb * 1024,
  'img-no-size': imageProblem('no-size', (facts) => facts.imagesNoSize),
  'img-long-alt': imageProblem('long-alt', (facts) => facts.imagesLongAlt),

  // --- structured data -----------------------------------------------------
  'json-ld-invalid': onPage((_, facts) => facts.jsonLdInvalid > 0),
  'no-structured-data': onPage((_, facts) => facts.structuredData === 0),
  'structured-data-required-missing': onPage((_, facts) => structuredProblems(facts, 'required')),
  'structured-data-recommended-missing': onPage((_, facts) =>
    structuredProblems(facts, 'recommended'),
  ),

  // --- social --------------------------------------------------------------
  // What the page says when shared. A page parsed before this was kept (`social` absent) is not
  // looked at: it never reads as having no tags.
  'og-missing': onPage(
    (_, facts) => facts.social !== undefined && facts.social.openGraphTags === 0,
  ),
  'og-incomplete': onPage((_, facts) => {
    const { social } = facts
    if (!social || social.openGraphTags === 0) return false
    return OG_REQUIRED.filter(([, field]) => social[field] === undefined).map(([name]) => name)
  }),
  'og-image-broken': onPage((url, facts, site) => brokenShareImage(url, facts, site)),
  'og-url-mismatch': onPage(
    (url, facts, site) =>
      facts.social?.url !== undefined && ogUrlDiffers(url, facts.social.url, site),
  ),
  'twitter-card-missing': onPage(
    (_, facts) => facts.social !== undefined && facts.social.twitterCard === undefined,
  ),

  // --- links ---------------------------------------------------------------
  'link-to-localhost': linkProblem('localhost', (facts) => facts.localhostLinks),
  'links-to-broken': linkedTargets(fails),
  // What a page loads that fails (the crawl kept only those), reported on the page that loads it.
  'resources-broken': (url) => {
    const { total, sample } = url.failedEmbeds
    if (!url.contentPage || total === 0) return false
    const urls: string[] = []
    for (const target of sample) {
      const address = boundedUrl(target.url.url)
      if (address) urls.push(address)
    }
    return backedBy({ kind: 'related-urls', total, urls })
  },
  'links-to-redirect': linkedTargets(redirects),
  'links-to-canonicalised': linkedTargets((target) => target.contentPage && target.canonicalised),
  'links-tracking-parameters': linkedTargets(hasTrackingParameters),
  'uncrawlable-links': linkProblem('uncrawlable', (facts) => facts.uncrawlableLinks),
  // What links to a URL expected to be out of the index does not matter to it (`excusesInlinks`).
  'only-nofollow-inlinks': onPage(
    (url, _, site) =>
      graphAbsenceKnown(site) &&
      INLINKS_WRONG['only-nofollow-inlinks'](url) &&
      !excusesInlinks(url, site),
  ),
  'only-noindex-inlinks': onPage(
    (url, _, site) =>
      graphAbsenceKnown(site) &&
      !site.documentUnobserved?.has('only-noindex-inlinks') &&
      INLINKS_WRONG['only-noindex-inlinks'](url) &&
      !excusesInlinks(url, site),
  ),
  // Found in a sitemap and nowhere else: no internal link was seen within the scope of the crawl.
  'linked-only-by-javascript': (url, site) =>
    site.config.rendering === 'rendered' &&
    site.rendersUnobserved === 0 &&
    site.htmlLinksComplete &&
    url.contentPage &&
    url.htmlAnchorsIn === 0 &&
    url.renderedAnchorsFrom.length > 0 &&
    backedBy({ kind: 'related-urls', total: url.anchorsIn, urls: url.renderedAnchorsFrom }),
  'links-only-after-rendering': onPage(
    (url, _, site) =>
      site.config.rendering === 'rendered' &&
      site.rendersUnobserved === 0 &&
      url.renderedAnchorsOut > 0 &&
      backedBy({ kind: 'related-urls', total: url.renderedAnchorsOut, urls: url.renderedLinksTo }),
  ),
  'orphan-in-sitemap': (url, site) =>
    (site.config.rendering !== 'rendered' || site.linksComplete) &&
    url.contentPage &&
    url.sitemaps > 0 &&
    url.anchorsIn === 0 &&
    url.url.source !== 'seed',
  'few-html-links': onPage(
    (url, _, site) =>
      url.indexable &&
      url.url.data?.truncated !== true &&
      url.htmlInternalAnchorsOut < figures(site).htmlLinksMin &&
      backedBy({
        kind: 'values',
        total: 1,
        items: [{ field: 'internal-links', text: String(url.htmlInternalAnchorsOut) }],
      }),
  ),
  'no-outgoing-links': onPage((url) => url.internalAnchorsOut === 0),
  'internal-nofollow-links': onPage((url) => url.nofollowAnchorsOut > 0),
  'deep-page': onPage(
    (url, _, site) =>
      graphAbsenceKnown(site) && (url.clickDepth ?? 0) > figures(site).clickDepthMax,
  ),
  'anchor-empty': linkProblem('empty-anchor', (facts) => facts.emptyAnchors),
  'anchor-vague': linkProblem('vague-anchor', (facts) => facts.vagueAnchors),

  // --- URLs ----------------------------------------------------------------
  'url-multiple-slashes': onPage(({ parsed }) => parsed.pathname.includes('//')),
  'url-spaces': onPage(({ parsed }) => (parsed.pathname + parsed.search).includes('%20')),
  'url-tracking': onPage(hasTrackingParameters),
  // Without the percent-encoding, whose hexadecimal digits are often in uppercase.
  'url-uppercase': onPage(({ parsed }) =>
    /[A-Z]/.test(parsed.pathname.replace(/%[0-9a-f]{2}/gi, '')),
  ),
  'url-repetitive-path': onPage((url) => hasRepeatedSegments(pathSegments(url))),
  'url-internal-search': onPage(
    (url) =>
      pathSegments(url).some((segment) => SEARCH_PATH.has(segment.toLowerCase())) ||
      parameterNames(url).some((name) => SEARCH_PARAMETERS.has(name)),
  ),
  'url-underscores': onPage(({ parsed }) => parsed.pathname.includes('_')),
  'url-too-long': onPage(({ url }, _, site) => url.url.length > figures(site).urlMax),

  // --- security ------------------------------------------------------------
  'http-url': onPage(({ parsed }) => parsed.protocol === 'http:'),
  'mixed-content': linkProblem('mixed-content', (facts) => facts.mixedContent),
  'insecure-form': linkProblem('insecure-form', (facts) => facts.insecureForms),
  'missing-security-header': onPage((_, facts) => facts.missingSecurityHeaders),
  'unsafe-cross-origin-links': linkProblem('unsafe-blank', (facts) => facts.unsafeBlankLinks),
  'protocol-relative': linkProblem('protocol-relative', (facts) => facts.protocolRelative),

  // --- HTML ----------------------------------------------------------------
  'invalid-head-elements': onPage((_, facts) => facts.invalidHeadElements.length > 0),
  // The same flaws as the warnings around it, once they have cost the page an indexing signal: a
  // browser ends the head early, and a robots meta, canonical or hreflang past that point is ignored.
  'html-structure-broken': onPage((url, facts) => {
    const flawed =
      facts.invalidHeadElements.length > 0 ||
      facts.headNotFirst ||
      facts.heads > 1 ||
      facts.bodies > 1
    const signalLost =
      facts.robotsOutsideHead > 0 ||
      facts.canonicals.some((canonical) => !canonical.inHead) ||
      url.hreflang.some((entry) => entry.outsideHead)
    return flawed && signalLost
  }),
  'multiple-head-or-body': onPage((_, facts) => facts.heads > 1 || facts.bodies > 1),
  'document-too-big': onPage(({ url }) => (url.bytes ?? 0) > DOCUMENT_MAX_BYTES),
  'content-before-head': onPage((_, facts) => facts.headNotFirst),
  // What the document declares. Pages parsed before it was kept (`document` absent) are not judged.
  'html-lang-missing': onPage((_, facts) => facts.document !== undefined && !facts.document.lang),
  // `lang=""` is valid HTML ("unknown language"), but it tells a screen reader and a search engine
  // nothing: it is read as missing (`html-lang-missing`), never as invalid.
  'html-lang-invalid': onPage(
    (_, facts) => !!facts.document?.lang && !isWellFormedLanguageTag(facts.document.lang),
  ),
  'viewport-missing': onPage(
    (_, facts) => facts.document !== undefined && !facts.document.viewport,
  ),
  // The header counts as much as the document does.
  'charset-missing': onPage(
    (url, facts) =>
      facts.document !== undefined &&
      !facts.document.charset &&
      !/charset\s*=/i.test((url.url.contentType ?? '').slice(0, 200)),
  ),
}

export type Finding = { issue: PageIssueId; details?: string[]; evidence?: IssueEvidence }

/** A finding a rule accepts, and the URL whose declaration does. */
export type AcceptedFinding = Finding & { by: AuditedUrl; acceptance: FindingAcceptance }

/**
 * The finding each blocker of indexation already has when nobody declared anything. A page the user
 * declared indexable gets one finding that names its blockers (`expected-indexable-blocked`), and
 * these are dropped for it: two findings for the same cause would count one problem twice.
 */
const INDEXING_FINDING_OF = {
  noindex: 'noindex',
  robots: 'robots-blocked',
} as const satisfies Partial<Record<IndexabilityBlocker, PageIssueId>>

/**
 * The generic finding each condition has for itself, which a rule that states the condition
 * replaces: `required` and `allowed` say that having it is fine, so the finding for having it is not
 * raised, and `required` raises one of its own for lacking it. `forbidden` keeps it: that is the
 * finding. Nothing else is here on purpose: a conflict of directives, a relation to other pages, an
 * inbound canonical or hreflang that points at a URL with the condition are other findings, and
 * stating the condition for the URL says nothing about them.
 */
const GENERIC_OF: Record<AuditCondition, readonly PageIssueId[]> = {
  canonical: [],
  unlinked: ['orphan-in-sitemap'],
  noindex: ['noindex'],
  nofollow: ['nofollow'],
  robots: ['robots-blocked'],
  // Being absent from a sitemap. Being listed while not indexable (`sitemap-not-indexable`) is a
  // conflict between the sitemap and the page, and stays.
  sitemap: ['indexable-not-in-sitemap', 'indexed-not-in-sitemap'],
}

/**
 * What is not a finding for a URL expected not to be indexable, because it is the expectation
 * itself: a `noindex`, a canonical elsewhere, and being indexable but absent from the sitemap, each
 * mapped to the condition that decides it when a rule states one (`undefined`: none does). A
 * `robots.txt` block is not here on purpose: it keeps crawlers from reading the page, and its
 * `noindex`, but not from listing the URL, so it says nothing about whether it stays out of the
 * index. Everything else keeps applying, directive conflicts and relations to other pages included.
 */
const EXPECTED_WHEN_NOT_INDEXABLE: ReadonlyMap<PageIssueId, AuditCondition | undefined> = new Map([
  ['noindex', 'noindex'],
  ['indexable-not-in-sitemap', 'sitemap'],
])

/**
 * The one place that decides which findings a URL keeps once its checks ran, so that no check
 * needs to know about exclusions, expectations or conditions:
 * - a URL left out of the audit has none of its own;
 * - a condition a rule states as `required` or `allowed` replaces its generic finding (see
 *   `GENERIC_OF`), and as `forbidden` keeps it, even where the expectation would have dropped it.
 *   Each condition is decided apart: `nofollow` allowed says nothing about `noindex`, a forbidden
 *   `sitemap` nothing about `robots`. An allowed condition never hides a conflict of directives,
 *   a link marked `rel="nofollow"` or what other pages say of the URL;
 * - what is expected of a URL's indexation drops the generic findings that are the expectation
 *   itself, for the conditions no rule states, and an explicit expectation of being indexable
 *   replaces the generic findings that would only repeat what it names.
 * The checks of other URLs have already looked at this one as it really is, whatever happens here.
 */
export function applyAuditPolicy(url: AuditedUrl, found: Finding[]): Finding[] {
  return auditPolicy(url, found).kept
}

/** `applyAuditPolicy`, and the findings of the URL itself that the rules take as expected. */
export function applyAuditPolicyKeeping(
  url: AuditedUrl,
  found: Finding[],
): { kept: Finding[]; accepted: AcceptedFinding[] } {
  return auditPolicy(url, found)
}

/** `applyAuditPolicy`, and the findings it takes as what a rule accepts. */
function auditPolicy(
  url: AuditedUrl,
  found: Finding[],
): { kept: Finding[]; accepted: AcceptedFinding[] } {
  if (url.excluded) return { kept: [], accepted: [] }
  const stated = (condition: AuditCondition) => url.conditions[condition].requirement
  const accepted: AcceptedFinding[] = []
  const accept = (finding: Finding, acceptance: FindingAcceptance) =>
    accepted.push({ ...finding, by: url, acceptance })
  const replaced = new Map<PageIssueId, AuditCondition>()
  for (const condition of AUDIT_CONDITIONS) {
    const requirement = stated(condition)
    // A sitemap that must not list the URL has nothing to say of the URL being out of it.
    if (
      requirement === 'allowed' ||
      requirement === 'required' ||
      (condition === 'sitemap' && requirement === 'forbidden')
    ) {
      for (const issue of GENERIC_OF[condition]) replaced.set(issue, condition)
    }
  }
  let kept = found.filter((finding) => {
    const condition = replaced.get(finding.issue)
    if (!condition) return true
    const { requirement, rule } = url.conditions[condition]
    if (requirement) {
      accept(finding, { kind: 'condition', condition, requirement, rule: rule?.id ?? null })
    }
    return false
  })
  if (url.intent === 'not-indexable') {
    kept = kept.filter((finding) => {
      if (!EXPECTED_WHEN_NOT_INDEXABLE.has(finding.issue)) return true
      const condition = EXPECTED_WHEN_NOT_INDEXABLE.get(finding.issue)
      if (condition !== undefined && stated(condition) !== null) return true
      accept(finding, { kind: 'expectation', rule: url.intentRule?.id ?? null })
      return false
    })
  } else if (url.intent === 'indexable') {
    // Not accepted: `expected-indexable-blocked` reports the same cause, in other words.
    const blocked = kept.find(({ issue }) => issue === 'expected-indexable-blocked')
    if (blocked) {
      const repeated = new Set<PageIssueId>(
        (blocked.details ?? []).flatMap(
          (blocker) => INDEXING_FINDING_OF[blocker as keyof typeof INDEXING_FINDING_OF] ?? [],
        ),
      )
      kept = kept.filter(({ issue }) => !repeated.has(issue))
    }
  }
  return { kept, accepted }
}

/**
 * The findings about other URLs that `relations.ts` excuses, which the checks therefore do not
 * report. Each is what the check would have said were it not for what a URL declares: an hreflang
 * finding can be partly reported and partly accepted, one target at a time.
 */
function acceptedRelations(url: AuditedUrl, site: Site): AcceptedFinding[] {
  if (url.excluded || !relationsApply(site) || !url.contentPage) return []
  const accepted = new Map<string, AcceptedFinding & { related: string[]; total: number }>()
  const add = (
    issue: PageIssueId,
    { by, acceptance }: Pick<AcceptedFinding, 'by' | 'acceptance'>,
    target: AuditedUrl | null,
  ) => {
    const key = `${issue}:${by.url.urlHash}`
    const entry = accepted.get(key) ?? { issue, by, acceptance, related: [], total: 0 }
    accepted.set(key, entry)
    if (!target) return
    entry.total++
    const address = boundedUrl(target.url.url)
    if (address && entry.related.length < MAX_EVIDENCE_ITEMS) entry.related.push(address)
  }

  const canonical = url.facts && notIndexableCanonical(url, site)
  if (canonical && url.blockersKnown !== false) {
    const blockers = indexingBlockers(canonical)
    const excused = excusedBlockers(url, canonical, site)
    if (blockers.every((blocker) => excused.has(blocker))) {
      add('canonical-not-indexable', relationAcceptance(url, canonical, blockers), canonical)
    }
  }

  for (const issue of Object.keys(HREFLANG_RELATIONS) as (keyof typeof HREFLANG_RELATIONS)[]) {
    const relation = HREFLANG_RELATIONS[issue]
    const seen = new Set<string>()
    for (const entry of url.hreflang) {
      const target = site.get(entry.url)
      if (!target || target === url || !target.internal || seen.has(entry.url)) continue
      seen.add(entry.url)
      if (
        url.blockersKnown === false ||
        !relation.wrong(target, url, site) ||
        !relation.excused(url, target, site)
      )
        continue
      // A missing return is excused as much by the page being expected out as by the target.
      add(issue, relationAcceptance(url, target, relation.blockers(target)), target)
    }
  }

  if (url.facts && graphAbsenceKnown(site) && isExpectedOut(url)) {
    for (const issue of Object.keys(INLINKS_WRONG) as (keyof typeof INLINKS_WRONG)[]) {
      if (!site.documentUnobserved?.has(issue) && INLINKS_WRONG[issue](url))
        add(issue, expectedOutAcceptance(url), null)
    }
  }

  return [...accepted.values()].map(({ related, total, ...finding }) => ({
    ...finding,
    ...(total > 0 ? { evidence: { kind: 'related-urls' as const, total, urls: related } } : {}),
  }))
}

/** The issues of a URL, in catalog order, with what each one details. */
export function detectIssues(url: AuditedUrl, site: Site): Finding[] {
  return detectFindings(url, site).found
}

/** What is pending on a URL, in catalog order, and apart what rules accept of what the crawl saw. */
export function detectFindings(
  url: AuditedUrl,
  site: Site,
): { found: Finding[]; accepted: AcceptedFinding[] } {
  const found: Finding[] = []
  const unknown = unknownIssuesOf(url, site)
  for (const issue of PAGE_ISSUE_IDS) {
    if (unknown.has(issue)) continue
    const subject =
      ISSUE_BASIS[issue] === 'html' || ISSUE_BASIS[issue] === 'response' ? (url.served ?? url) : url
    const result = CHECKS[issue](subject, site)
    // A check that has nothing to read gives no finding, never a failed analysis.
    if (!result) continue
    if (result === true) found.push({ issue })
    else if (Array.isArray(result)) {
      if (result.length > 0) found.push({ issue, details: result })
    } else {
      found.push({
        issue,
        ...(result.details ? { details: result.details } : {}),
        ...(result.evidence ? { evidence: result.evidence } : {}),
      })
    }
  }
  const { kept, accepted } = auditPolicy(url, found)
  return applyFindingDismissals(
    url,
    site,
    kept,
    [...accepted, ...acceptedRelations(url, site)].filter(({ issue }) => !unknown.has(issue)),
  )
}

/**
 * The findings whose presence the audit policy decides from another issue's result, and which are
 * therefore unknown when that issue is: an explicit expectation of being indexable reports the
 * blockers it names in `expected-indexable-blocked` and drops their generic findings
 * (`INDEXING_FINDING_OF`), so when that finding cannot be judged, nobody can tell whether the
 * generic ones would have been dropped. A generic finding a stated condition replaces (`GENERIC_OF`)
 * does not depend on it: the rule alone decides that. Exclusions, other expectations and dismissals
 * depend only on rules, never on another finding.
 */
export function dependentUnknowns(
  url: Pick<AuditedUrl, 'excluded' | 'intent' | 'intentRule' | 'conditions'>,
  unknown: ReadonlySet<string>,
): PageIssueId[] {
  if (url.excluded || url.intent !== 'indexable' || url.intentRule === null) return []
  if (!unknown.has('expected-indexable-blocked')) return []
  return Object.entries(INDEXING_FINDING_OF).flatMap(([condition, issue]) => {
    const requirement = url.conditions[condition as AuditCondition].requirement
    return requirement === 'allowed' || requirement === 'required' ? [] : [issue]
  })
}

/** What a URL's selected canonical decides: a check reading any of these reads the canonical. */
const CANONICAL_FIELDS: ReadonlySet<PropertyKey> = new Set([
  'canonicalised',
  'canonicalKnown',
  'blockersKnown',
  'indexability',
  'indexable',
])

/**
 * Whether judging `issue` on `url` reads the URL's selected canonical, directly or through its
 * indexability (which a canonical elsewhere blocks). Recorded while the check runs, so that no list
 * has to be kept by hand: a check that returns before reading it does not depend on it.
 */
function readsCanonical(issue: PageIssueId, url: AuditedUrl, site: Site): boolean {
  let read = false
  const address = new Proxy(url.url, {
    get(target, key, receiver) {
      if (key === 'canonical') read = true
      return Reflect.get(target, key, receiver) as unknown
    },
  })
  const subject = new Proxy(url, {
    get(target, key, receiver) {
      if (key === 'url') return address
      if (CANONICAL_FIELDS.has(key)) read = true
      return Reflect.get(target, key, receiver) as unknown
    },
  })
  try {
    CHECKS[issue](subject, site)
  } catch {
    return true
  }
  return read
}

const unknownIssues = new WeakMap<AuditedUrl, ReadonlySet<string>>()
const NONE: ReadonlySet<string> = new Set()

/**
 * The issues a URL of a rendered-basis analysis cannot be judged on in this crawl: those its
 * incomplete document leaves without input (`documentUnobserved` from `selectDocument`), every
 * document or graph check that reads its canonical or blockers when they are unknown (conflicting
 * or unresolved canonical declarations, an incomplete document), and the findings the audit policy
 * decides from one of those (`dependentUnknowns`). It has no finding and no accepted row for them,
 * and the list is stored with its audit state, so comparisons, alerts and rechecks read them as
 * unknown for this URL. HTML analyses have none: `documentObservation` is only set by
 * `selectDocument`.
 */
export function unknownIssuesOf(url: AuditedUrl, site: Site): ReadonlySet<string> {
  if (!url.documentObservation) return NONE
  const cached = unknownIssues.get(url)
  if (cached) return cached
  const unknown = new Set<string>(url.documentUnobserved)
  if (url.blockersKnown === false) {
    for (const issue of PAGE_ISSUE_IDS) {
      const basis = ISSUE_BASIS[issue]
      if (basis !== 'document' && basis !== 'graph') continue
      if (!unknown.has(issue) && readsCanonical(issue, url, site)) unknown.add(issue)
    }
  }
  for (const issue of dependentUnknowns(url, unknown)) unknown.add(issue)
  url.documentUnobserved = PAGE_ISSUE_IDS.filter((issue) => unknown.has(issue))
  unknownIssues.set(url, unknown)
  return unknown
}

const dismissalIndexes = new WeakMap<AuditSnapshot, ReadonlyMap<string, FindingDismissal>>()

export function applyFindingDismissals(
  url: AuditedUrl,
  site: Site,
  kept: Finding[],
  accepted: AcceptedFinding[],
): { found: Finding[]; accepted: AcceptedFinding[] } {
  let index = dismissalIndexes.get(site.config)
  if (!index) {
    index = new Map(
      (site.config.dismissals ?? []).map((row) => [row.issue + ':' + (row.urlHash ?? '*'), row]),
    )
    dismissalIndexes.set(site.config, index)
  }
  const pending: Finding[] = []
  for (const finding of kept) {
    const state =
      index.get(finding.issue + ':' + url.url.urlHash) ?? index.get(finding.issue + ':*')
    if (state?.state === 'dismissed' && !finding.issue.startsWith('expected-')) {
      accepted.push({
        ...finding,
        by: url,
        acceptance: {
          kind: 'dismissal',
          state: 'dismissed',
          scope: state.urlHash === null ? 'domain' : 'url',
          id: state.id,
          ...(state.setBy !== undefined ? { setBy: state.setBy } : {}),
          ...(state.setAt ? { setAt: state.setAt } : {}),
        },
      })
    } else pending.push(finding)
  }
  return { found: pending, accepted }
}
