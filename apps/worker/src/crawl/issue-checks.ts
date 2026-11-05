import {
  AUDIT_CONDITIONS,
  HREFLANG_SOURCES,
  MAX_EVIDENCE_ITEMS,
  PAGE_ISSUE_IDS,
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
import { judgeable, presenceOf } from './conditions'
import { MAX_NEAR_PARTNERS } from './fingerprint'
import { isValidHreflang } from './language-codes'
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
type Check = (url: AuditedUrl, site: Site) => Verdict

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
    wrong: (target: AuditedUrl, page: AuditedUrl) =>
      target.contentPage && !target.hreflang.some((entry) => entry.url === page.url.url),
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
    return relation.wrong(target, page) && !relation.excused(page, target, site)
  }

/** What the links that reach a URL say of it, whatever is expected of the URL. */
const INLINKS_WRONG = {
  'only-nofollow-inlinks': (url: AuditedUrl) => url.anchorsIn > 0 && url.followedAnchorsIn === 0,
  'only-noindex-inlinks': (url: AuditedUrl) => url.anchorsIn > 0 && url.anchorsFromIndexable === 0,
} as const

/** The URL of the site a page's canonical leads to, when that one cannot be indexed. */
function notIndexableCanonical(url: AuditedUrl, site: Site): AuditedUrl | null {
  const target = url.url.canonical ? site.get(url.url.canonical) : undefined
  return target &&
    target !== url &&
    target.internal &&
    target.indexability.state === 'not-indexable'
    ? target
    : null
}

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

  // --- what rules require or forbid of one directive or file ----------------------------------
  // Only for what a rule states, only for pages that answered, and only when the crawl could tell:
  // what was not read whole, or not at all, is not missing. The finding for a forbidden directive
  // or block is the generic one (`noindex`, `nofollow`, `robots-blocked`), which `applyAuditPolicy`
  // keeps where a rule forbids it.
  'noindex-required-missing': requiredMissing('noindex'),
  'nofollow-required-missing': requiredMissing('nofollow'),
  'robots-block-required-missing': requiredMissing('robots'),
  'sitemap-required-missing': requiredMissing('sitemap'),
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
  'canonical-outside-head': onPage((_, facts) =>
    facts.canonicals.some((c) => !c.inHead) ? declarations(facts, (c) => !c.inHead) : false,
  ),
  'canonical-conflict': onPage((_, facts) =>
    new Set(facts.canonicals.map((c) => c.url ?? c.raw)).size > 1
      ? declarations(facts, () => true)
      : false,
  ),
  // The canonical leads to a URL that cannot be indexed. Not news where every blocker is what was
  // declared of one end or the other (`excusedBlockers`); the blockers listed are all of them.
  'canonical-not-indexable': onPage((url, _, site) => {
    const target = notIndexableCanonical(url, site)
    if (!target) return false
    const excused = excusedBlockers(url, target, site)
    if (target.indexability.blockers.every((blocker) => excused.has(blocker))) return false
    const address = boundedUrl(target.url.url)
    return {
      ...backedBy({ kind: 'related-urls', total: 1, urls: address ? [address] : [] }),
      details: target.indexability.blockers,
    }
  }),
  'canonical-fragment': onPage((_, facts) =>
    facts.canonicals.some((c) => c.raw.includes('#'))
      ? declarations(facts, (c) => c.raw.includes('#'))
      : false,
  ),
  'canonical-missing': onPage(
    (url, facts) => !url.noindex && facts.canonicals.length === 0 && url.url.canonical === null,
  ),
  canonicalised: onPage((url) => url.canonicalised),
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
  'sitemap-not-indexable': (url) => {
    if (!url.internal || url.sitemaps === 0 || url.url.state !== 'done') return false
    // Sitemaps list files that are not pages too, and those are not meant to be indexed as pages.
    const flagged = url.url.kind === 'resource' ? statusIn(url, 400, 599) : !url.indexable
    if (!flagged) return false
    // Why, when the crawl knows: a URL that never answered has no blocker of its own to name.
    const { blockers } = url.indexability
    return blockers.length > 0 ? blockers : true
  },
  'indexed-not-in-sitemap': (url) =>
    url.indexed === true && url.sitemaps === 0 && url.sitemapsAmbiguous === 0,
  // Indexable is not indexed: only what confirms it is, and nothing does yet.
  'indexable-not-in-sitemap': (url) =>
    url.indexable && url.indexed !== true && url.sitemaps === 0 && url.sitemapsAmbiguous === 0,

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
  // App policy: omit a missing return where either end is intentionally not indexable.
  // This does not establish whether a search engine indexed or read either URL.
  'hreflang-no-return': hreflang(hreflangTargets(unexcused('hreflang-no-return'))),
  'hreflang-invalid-code': hreflang((_, entries) =>
    entries.filter((entry) => !isValidHreflang(entry.lang)),
  ),
  'hreflang-outside-head': hreflang((_, entries) => entries.filter((entry) => entry.outsideHead)),
  'hreflang-non-canonical': hreflang(hreflangTargets(unexcused('hreflang-non-canonical'))),
  'hreflang-noindex': hreflang(hreflangTargets(unexcused('hreflang-noindex'))),
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
    (url, _, site) => url.indexable && duplicates(url, site.titles.get(comparable(url.url.title))),
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
      url.indexable &&
      duplicates(url, site.descriptions.get(comparable(url.url.data?.description))),
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
    (url, _, site) =>
      url.indexable && duplicates(url, site.h1s.get(comparable(url.url.data?.h1?.[0]))),
  ),
  'heading-too-long': onPage((_, facts) => facts.longHeadings > 0),

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
  'content-thin': onPage((_, facts) => facts.words < THIN_CONTENT_WORDS),

  // --- images --------------------------------------------------------------
  'img-no-alt': imageProblem('no-alt', (facts) => facts.imagesNoAlt),
  'img-empty-alt': imageProblem('empty-alt', (facts) => facts.imagesEmptyAlt),
  'img-too-heavy': (url) =>
    url.internal &&
    statusIn(url, 200, 299) &&
    (url.url.contentType ?? '').toLowerCase().startsWith('image/') &&
    (url.url.bytes ?? 0) > IMAGE_MAX_BYTES,
  'img-no-size': imageProblem('no-size', (facts) => facts.imagesNoSize),
  'img-long-alt': imageProblem('long-alt', (facts) => facts.imagesLongAlt),

  // --- structured data -----------------------------------------------------
  'json-ld-invalid': onPage((_, facts) => facts.jsonLdInvalid > 0),
  'no-structured-data': onPage((_, facts) => facts.structuredData === 0),

  // --- links ---------------------------------------------------------------
  'link-to-localhost': linkProblem('localhost', (facts) => facts.localhostLinks),
  'uncrawlable-links': linkProblem('uncrawlable', (facts) => facts.uncrawlableLinks),
  // What links to a URL expected to be out of the index does not matter to it (`excusesInlinks`).
  'only-nofollow-inlinks': onPage(
    (url, _, site) => INLINKS_WRONG['only-nofollow-inlinks'](url) && !excusesInlinks(url, site),
  ),
  'only-noindex-inlinks': onPage(
    (url, _, site) => INLINKS_WRONG['only-noindex-inlinks'](url) && !excusesInlinks(url, site),
  ),
  // Found in a sitemap and nowhere else: no internal link was seen within the scope of the crawl.
  'orphan-in-sitemap': (url) =>
    url.contentPage && url.sitemaps > 0 && url.anchorsIn === 0 && url.url.source !== 'seed',
  'no-outgoing-links': onPage((url) => url.internalAnchorsOut === 0),
  'internal-nofollow-links': onPage((url) => url.nofollowAnchorsOut > 0),
  'deep-page': onPage((url) => (url.clickDepth ?? 0) > CLICK_DEPTH_MAX),
  'anchor-empty': linkProblem('empty-anchor', (facts) => facts.emptyAnchors),
  'anchor-vague': linkProblem('vague-anchor', (facts) => facts.vagueAnchors),

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
  canonical: 'canonicalised',
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
  ['canonicalised', undefined],
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
  if (canonical) {
    const { blockers } = canonical.indexability
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
      if (!relation.wrong(target, url) || !relation.excused(url, target, site)) continue
      // A missing return is excused as much by the page being expected out as by the target.
      add(issue, relationAcceptance(url, target, relation.blockers(target)), target)
    }
  }

  if (url.facts && isExpectedOut(url)) {
    for (const issue of Object.keys(INLINKS_WRONG) as (keyof typeof INLINKS_WRONG)[]) {
      if (INLINKS_WRONG[issue](url)) add(issue, expectedOutAcceptance(url), null)
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
  for (const issue of PAGE_ISSUE_IDS) {
    const result = CHECKS[issue](url, site)
    if (result === true) found.push({ issue })
    else if (Array.isArray(result)) {
      if (result.length > 0) found.push({ issue, details: result })
    } else if (result !== false) {
      found.push({
        issue,
        ...(result.details ? { details: result.details } : {}),
        ...(result.evidence ? { evidence: result.evidence } : {}),
      })
    }
  }
  const { kept, accepted } = auditPolicy(url, found)
  return { found: kept, accepted: [...accepted, ...acceptedRelations(url, site)] }
}
