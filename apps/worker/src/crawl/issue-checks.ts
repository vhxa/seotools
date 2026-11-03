import {
  HREFLANG_SOURCES,
  PAGE_ISSUE_IDS,
  type CrawlPageFacts,
  type HreflangEntry,
  type IndexabilityBlocker,
  type PageIssueId,
} from '@seotools/core'
import { isValidHreflang } from './language-codes'
import {
  comparable,
  followRedirects,
  isGuess,
  unavailableAfter,
  type AuditedUrl,
  type Site,
} from './site-audit'

/** Whether a URL has the issue. A list says so too, unless empty, and is what the issue details. */
type Check = (url: AuditedUrl, site: Site) => boolean | string[]

const TITLE_MAX = 60
const TITLE_MIN = 30
const DESCRIPTION_MAX = 155
const DESCRIPTION_MIN = 70
const THIN_CONTENT_WORDS = 200
/** Under this much text, a page has no use for subsections. */
const SUBSECTIONS_MIN_WORDS = 300
const URL_MAX = 115
const CLICK_DEPTH_MAX = 3
const DOCUMENT_MAX_BYTES = 2 * 1024 * 1024
const IMAGE_MAX_BYTES = 100 * 1024
const SITEMAP_MAX_ENTRIES = 50_000
const SITEMAP_MAX_BYTES = 50 * 1024 * 1024

/** Servers often refuse bots with these while the page works fine for people. */
const REFUSES_BOTS = new Set([401, 403, 405, 406, 429, 451])

/**
 * A URL whose expectation can be judged: a page that answered successfully and that the crawler did
 * not only try on its own. Resources, redirects, failures and guesses have no expectation to meet.
 */
const judgeable = (url: AuditedUrl, site: Site) => url.contentPage && !isGuess(url, site)

/** The issue applies to pages that answered and were parsed, not to redirects or failures. */
const onPage =
  (test: (url: AuditedUrl, facts: CrawlPageFacts, site: Site) => boolean | string[]): Check =>
  (url, site) =>
    url.contentPage && url.facts ? test(url, url.facts, site) : false

/** The issue is about how a URL of the site answered, which only matters if it is not a guess. */
const answer =
  (test: (url: AuditedUrl, site: Site) => boolean): Check =>
  (url, site) =>
    url.internal && url.url.state === 'done' && !isGuess(url, site) && test(url, site)

const statusIn = (url: AuditedUrl, min: number, max: number) =>
  url.url.statusCode !== null && url.url.statusCode >= min && url.url.statusCode <= max

/** The values given to a directive that has them, e.g. `max-snippet:20` gives `['20']`. */
const valuesOf = (directives: ReadonlySet<string>, name: string) =>
  [...directives].flatMap((directive) =>
    directive.startsWith(`${name}:`) ? [directive.slice(name.length + 1)] : [],
  )

const blank = (text: string | null | undefined) => !text || text.trim() === ''

const sourcesOf = (entries: readonly HreflangEntry[]) =>
  HREFLANG_SOURCES.filter((source) => entries.some((entry) => entry.source === source))

/** The hreflang issue is about some of a page's entries: the sources of those are its detail. */
const hreflang =
  (test: (url: AuditedUrl, entries: HreflangEntry[], site: Site) => HreflangEntry[]): Check =>
  (url, site) => {
    if (!url.contentPage || url.hreflang.length === 0) return false
    return sourcesOf(test(url, url.hreflang, site))
  }

/** The entries pointing at a URL of the site that `test` says is wrong. */
const hreflangTargets =
  (test: (target: AuditedUrl, page: AuditedUrl) => boolean) =>
  (page: AuditedUrl, entries: HreflangEntry[], site: Site) =>
    entries.filter((entry) => {
      const target = site.get(entry.url)
      return target !== undefined && target !== page && target.internal && test(target, page)
    })

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

const SEARCH_PATH = new Set(['search', 'buscar', 'busqueda', 'b%c3%basqueda', 'suche', 'recherche'])
const SEARCH_PARAMETERS = new Set(['s', 'q', 'query', 'search', 'keyword', 'keywords'])

/** What each issue of `PAGE_ISSUES` looks for. Each check says itself which URLs it applies to. */
export const CHECKS: Record<PageIssueId, Check> = {
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
      ? url.indexability.blockers.filter((blocker) => blocker in INDEXING_FINDING_OF)
      : false,
  'expected-not-indexable-but-indexable': (url, site) =>
    url.intent === 'not-indexable' &&
    judgeable(url, site) &&
    url.indexability.state === 'indexable',

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
  'broken-external-link': (url) =>
    !url.internal &&
    url.url.state === 'done' &&
    (url.url.error !== null ||
      (statusIn(url, 400, 599) && !REFUSES_BOTS.has(url.url.statusCode ?? 0))),

  // --- directives ----------------------------------------------------------
  'directive-outside-head': onPage((_, facts) => facts.robotsOutsideHead > 0),
  'directives-conflict': onPage(
    ({ noindex, nofollow, directives: d }) =>
      (noindex && (d.has('index') || d.has('all'))) ||
      (nofollow && (d.has('follow') || d.has('all'))),
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
  'canonical-outside-head': onPage((_, facts) => facts.canonicals.some((c) => !c.inHead)),
  'canonical-conflict': onPage(
    (_, facts) => new Set(facts.canonicals.map((c) => c.url ?? c.raw)).size > 1,
  ),
  'canonical-not-indexable': onPage((url, _, site) => {
    const target = url.url.canonical ? site.get(url.url.canonical) : undefined
    return (
      target !== undefined &&
      target !== url &&
      target.internal &&
      target.url.state === 'done' &&
      !target.indexable
    )
  }),
  'canonical-fragment': onPage((_, facts) => facts.canonicals.some((c) => c.raw.includes('#'))),
  'canonical-missing': onPage(
    (url, facts) => !url.noindex && facts.canonicals.length === 0 && url.url.canonical === null,
  ),
  canonicalised: onPage((url) => url.canonicalised),
  'canonical-relative': onPage((_, facts) =>
    facts.canonicals.some((c) => !/^https?:\/\//i.test(c.raw.trim())),
  ),
  'canonical-repeated': onPage((_, facts) => {
    const values = facts.canonicals.map((c) => c.url ?? c.raw)
    return new Set(values).size < values.length
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
  'sitemap-not-indexable': (url) => {
    if (!url.internal || url.sitemaps === 0 || url.url.state !== 'done') return false
    // Sitemaps list images and the like too, and those are not meant to be indexed as pages.
    if (url.url.kind === 'resource') return statusIn(url, 400, 599)
    return !url.indexable
  },
  'indexed-not-in-sitemap': (url) => url.indexed === true && url.sitemaps === 0,
  // Indexable is not indexed: only what confirms it is, and nothing does yet.
  'indexable-not-in-sitemap': (url) => url.indexable && url.indexed !== true && url.sitemaps === 0,

  // --- hreflang ------------------------------------------------------------
  'hreflang-unreachable': hreflang(
    hreflangTargets(
      (target) =>
        target.url.state === 'done' && (target.url.error !== null || statusIn(target, 400, 599)),
    ),
  ),
  'hreflang-redirect': hreflang(
    hreflangTargets((target) => target.url.state === 'done' && target.url.kind === 'redirect'),
  ),
  'hreflang-no-return': hreflang(
    hreflangTargets(
      (target, page) =>
        target.contentPage && !target.hreflang.some((entry) => entry.url === page.url.url),
    ),
  ),
  'hreflang-invalid-code': hreflang((_, entries) =>
    entries.filter((entry) => !isValidHreflang(entry.lang)),
  ),
  'hreflang-outside-head': hreflang((_, entries) => entries.filter((entry) => entry.outsideHead)),
  'hreflang-non-canonical': hreflang(
    hreflangTargets((target) => target.contentPage && target.canonicalised),
  ),
  'hreflang-noindex': hreflang(hreflangTargets((target) => target.contentPage && target.noindex)),
  'hreflang-same-language': hreflang((_, entries) => {
    const urls = new Map<string, Set<string>>()
    for (const { lang, url } of entries) {
      const key = lang.trim().toLowerCase()
      urls.set(key, (urls.get(key) ?? new Set()).add(url))
    }
    return entries.filter((entry) => (urls.get(entry.lang.trim().toLowerCase())?.size ?? 0) > 1)
  }),
  'hreflang-no-self': hreflang((url, entries) =>
    entries.some((entry) => entry.url === url.url.url) ? [] : entries,
  ),
  'hreflang-no-x-default': hreflang((_, entries) =>
    entries.some((entry) => entry.lang.trim().toLowerCase() === 'x-default') ? [] : entries,
  ),

  // --- title ---------------------------------------------------------------
  'title-missing': onPage((url) => blank(url.url.title)),
  'title-outside-head': onPage((_, facts) => facts.titlesOutsideHead > 0),
  'title-multiple': onPage((_, facts) => facts.titles > 1),
  'title-duplicate': onPage(
    (url, _, site) => url.indexable && (site.titles.get(comparable(url.url.title)) ?? 0) > 1,
  ),
  'title-too-long': onPage((url) => (url.url.title?.length ?? 0) > TITLE_MAX),
  'title-too-short': onPage(
    (url) => !blank(url.url.title) && (url.url.title?.length ?? 0) < TITLE_MIN,
  ),

  // --- meta description ----------------------------------------------------
  'description-multiple': onPage((_, facts) => facts.descriptions > 1),
  'description-outside-head': onPage((_, facts) => facts.descriptionsOutsideHead > 0),
  'description-missing': onPage(({ url }) => blank(url.data?.description)),
  'description-duplicate': onPage(
    (url, _, site) =>
      url.indexable && (site.descriptions.get(comparable(url.url.data?.description)) ?? 0) > 1,
  ),
  'description-too-long': onPage(
    ({ url }) => (url.data?.description?.length ?? 0) > DESCRIPTION_MAX,
  ),
  'description-too-short': onPage(
    ({ url }) =>
      !blank(url.data?.description) && (url.data?.description?.length ?? 0) < DESCRIPTION_MIN,
  ),

  // --- headings ------------------------------------------------------------
  'h1-missing': onPage((_, facts) => facts.h1s === 0),
  'h1-multiple': onPage((_, facts) => facts.h1s > 1),
  'heading-empty': onPage((_, facts) => facts.emptyHeadings > 0),
  'heading-skipped-level': onPage((_, facts) => facts.headingLevelSkipped),
  'h2-missing': onPage((_, facts) => facts.h2s === 0 && facts.words >= SUBSECTIONS_MIN_WORDS),
  'h1-duplicate': onPage(
    (url, _, site) => url.indexable && (site.h1s.get(comparable(url.url.data?.h1?.[0])) ?? 0) > 1,
  ),
  'heading-too-long': onPage((_, facts) => facts.longHeadings > 0),

  // --- content -------------------------------------------------------------
  'content-duplicate': onPage(
    (url, facts, site) =>
      url.indexable && facts.textHash !== null && (site.texts.get(facts.textHash) ?? 0) > 1,
  ),
  'content-near-duplicate': onPage((url, _, site) => site.nearDuplicates.has(url)),
  'content-placeholder': onPage((_, facts) => facts.placeholderText),
  'content-thin': onPage((_, facts) => facts.words < THIN_CONTENT_WORDS),

  // --- images --------------------------------------------------------------
  'img-no-alt': onPage((_, facts) => facts.imagesNoAlt > 0),
  'img-empty-alt': onPage((_, facts) => facts.imagesEmptyAlt > 0),
  'img-too-heavy': (url) =>
    url.internal &&
    statusIn(url, 200, 299) &&
    (url.url.contentType ?? '').toLowerCase().startsWith('image/') &&
    (url.url.bytes ?? 0) > IMAGE_MAX_BYTES,
  'img-no-size': onPage((_, facts) => facts.imagesNoSize > 0),
  'img-long-alt': onPage((_, facts) => facts.imagesLongAlt > 0),

  // --- structured data -----------------------------------------------------
  'json-ld-invalid': onPage((_, facts) => facts.jsonLdInvalid > 0),
  'no-structured-data': onPage((_, facts) => facts.structuredData === 0),

  // --- links ---------------------------------------------------------------
  'link-to-localhost': onPage((_, facts) => facts.localhostLinks > 0),
  'uncrawlable-links': onPage((_, facts) => facts.uncrawlableLinks > 0),
  'only-nofollow-inlinks': onPage((url) => url.anchorsIn > 0 && url.followedAnchorsIn === 0),
  'only-noindex-inlinks': onPage((url) => url.anchorsIn > 0 && url.anchorsFromIndexable === 0),
  // Found in a sitemap and nowhere else: no internal link was seen within the scope of the crawl.
  'orphan-in-sitemap': (url) =>
    url.contentPage && url.sitemaps > 0 && url.anchorsIn === 0 && url.url.source !== 'seed',
  'no-outgoing-links': onPage((url) => url.internalAnchorsOut === 0),
  'internal-nofollow-links': onPage((url) => url.nofollowAnchorsOut > 0),
  'deep-page': onPage((url) => (url.clickDepth ?? 0) > CLICK_DEPTH_MAX),
  'anchor-empty': onPage((_, facts) => facts.emptyAnchors > 0),
  'anchor-vague': onPage((_, facts) => facts.vagueAnchors > 0),

  // --- URLs ----------------------------------------------------------------
  'url-multiple-slashes': onPage(({ parsed }) => parsed.pathname.includes('//')),
  'url-spaces': onPage(({ parsed }) => (parsed.pathname + parsed.search).includes('%20')),
  'url-tracking': onPage((url) =>
    parameterNames(url).some((name) => name.startsWith('utm_') || TRACKING_PARAMETERS.has(name)),
  ),
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
  'url-too-long': onPage(({ url }) => url.url.length > URL_MAX),

  // --- security ------------------------------------------------------------
  'http-url': onPage(({ parsed }) => parsed.protocol === 'http:'),
  'mixed-content': onPage((_, facts) => facts.mixedContent > 0),
  'insecure-form': onPage((_, facts) => facts.insecureForms > 0),
  'missing-security-header': onPage((_, facts) => facts.missingSecurityHeaders),
  'unsafe-cross-origin-links': onPage((_, facts) => facts.unsafeBlankLinks > 0),
  'protocol-relative': onPage((_, facts) => facts.protocolRelative > 0),

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
}

export type Finding = { issue: PageIssueId; details?: string[] }

/**
 * The finding each blocker of indexation already has when nobody declared anything. A page the user
 * declared indexable gets one finding that names its blockers (`expected-indexable-blocked`), and
 * these are dropped for it: two findings for the same cause would count one problem twice.
 */
const INDEXING_FINDING_OF = {
  noindex: 'noindex',
  canonical: 'canonicalised',
  robots: 'robots-blocked',
} as const satisfies Partial<Record<IndexabilityBlocker, PageIssueId>>

/**
 * What is not a finding for a URL expected not to be indexable, because it is the expectation
 * itself: a `noindex`, a canonical elsewhere, and being indexable but absent from the sitemap. A
 * `robots.txt` block is not here on purpose: it keeps crawlers from reading the page, and its
 * `noindex`, but not from listing the URL, so it says nothing about whether it stays out of the
 * index. Everything else keeps applying, directive conflicts and relations to other pages included.
 */
const EXPECTED_WHEN_NOT_INDEXABLE: ReadonlySet<PageIssueId> = new Set([
  'noindex',
  'canonicalised',
  'indexable-not-in-sitemap',
])

/**
 * The one place that decides which findings a URL keeps once its checks ran, so that no check
 * needs to know about exclusions or expectations:
 * - a URL left out of the audit has none of its own;
 * - when the rule that decides its expectation accepts `nofollow`, the generic finding for its own
 *   `nofollow` is not raised. Nothing else is: not a conflict of directives, not a link marked
 *   `rel="nofollow"`, not what other pages say of it, and `noindex` is a different directive;
 * - what is declared of a URL's indexation replaces the generic findings that would only repeat it.
 * The checks of other URLs have already looked at this one as it really is, whatever happens here.
 */
export function applyAuditPolicy(url: AuditedUrl, found: Finding[]): Finding[] {
  if (url.excluded) return []
  let kept = url.acceptNofollow ? found.filter(({ issue }) => issue !== 'nofollow') : found
  if (url.intent === 'not-indexable') {
    kept = kept.filter(({ issue }) => !EXPECTED_WHEN_NOT_INDEXABLE.has(issue))
  } else if (url.intent === 'indexable') {
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
  return kept
}

/** The issues of a URL, in catalog order, with what each one details. */
export function detectIssues(url: AuditedUrl, site: Site): Finding[] {
  const found: Finding[] = []
  for (const issue of PAGE_ISSUE_IDS) {
    const result = CHECKS[issue](url, site)
    if (result === true) found.push({ issue })
    else if (Array.isArray(result) && result.length > 0) found.push({ issue, details: result })
  }
  return applyAuditPolicy(url, found)
}
