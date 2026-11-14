import { selectDocument } from './document-basis'
import type { VitalMetrics } from '@seotools/core'
import {
  assessIndexability,
  ISSUE_BASIS,
  PAGE_ISSUE_IDS,
  isPageLocalIssue,
  compileAuditSnapshot,
  crawlFileKindOf,
  defaultResolution,
  crawlUrlHash,
  stripIgnoredParameters,
  isInternalUrl,
  MAX_EVIDENCE_ITEMS,
  isRobotsAllowed,
  parseRobots,
  type AuditParticipation,
  type AuditResolver,
  type AuditRule,
  type AuditSnapshot,
  type CrawlPageFacts,
  type HreflangEntry,
  type RecordedIntent,
  type Indexability,
  type ParsedRobots,
  type ResolvedConditions,
} from '@seotools/core'
import type { Crawl, CrawlUrl, CrawlUrlView, CrawlUrlRender, Database } from '@seotools/db'
import { parseRobotsSitemaps } from './extract'
import { findNearDuplicates } from './fingerprint'
import { emptyPageFacts } from './page-facts'

const BATCH = 1000
/** Link kinds that load a resource into the page. `head-link` is left out: it says nothing of what it is. */
const EMBED_KINDS: ReadonlySet<string> = new Set(['image', 'script', 'style', 'media', 'frame'])
/** What an external server answers to a crawler that it would not answer to a person. */
export const REFUSES_BOTS = new Set([401, 403, 405, 406, 429, 451])
const VIEWS: readonly CrawlUrlView[] = ['pages', 'other', 'external']
/** The bot robots.txt and meta robots are read for, with `*` as its fallback. */
const SEARCH_BOT = 'Googlebot'
const MAX_REDIRECT_HOPS = 30

const ROBOTS_DIRECTIVES = new Set([
  'all',
  'index',
  'follow',
  'none',
  'noindex',
  'nofollow',
  'noarchive',
  'nosnippet',
  'noimageindex',
  'notranslate',
  'indexifembedded',
  'max-snippet',
  'max-image-preview',
  'max-video-preview',
  'unavailable_after',
])

/**
 * The directives a value of `<meta name="robots">` or `X-Robots-Tag` holds, as `name` or `name:value`
 * in lowercase. Those an `X-Robots-Tag` aims at another bot (`bingbot: noindex`) are left out.
 */
export function parseRobotsDirectives(values: readonly (string | null | undefined)[]): Set<string> {
  const directives = new Set<string>()
  for (const value of values) {
    const raws = (value ?? '').toLowerCase().split(',')
    for (let i = 0; i < raws.length; i++) {
      let token = (raws[i] ?? '').trim()
      // A date like `Mon, 25 Jun 2030 15:00:00 GMT` has a comma of its own.
      if (token.startsWith('unavailable_after') && DATE_TAIL.test(raws[i + 1] ?? '')) {
        token = `${token},${raws[i + 1]}`.trim()
        i++
      }
      let colon = token.indexOf(':')
      if (colon !== -1 && !ROBOTS_DIRECTIVES.has(token.slice(0, colon).trim())) {
        if (token.slice(0, colon).trim() !== SEARCH_BOT.toLowerCase()) continue
        token = token.slice(colon + 1).trim()
        colon = token.indexOf(':')
      }
      const name = (colon === -1 ? token : token.slice(0, colon)).trim()
      if (!ROBOTS_DIRECTIVES.has(name)) continue
      directives.add(colon === -1 ? name : `${name}:${token.slice(colon + 1).trim()}`)
    }
  }
  return directives
}

/** What follows the comma after the weekday in an RFC 822 or RFC 850 date. */
const DATE_TAIL = /^\s*\d{1,2}[-\s][a-z]{3}[-\s]\d{2,4}/

/**
 * When an `unavailable_after` directive of a set says the page stops being shown, or `null` if it
 * has none or what it holds is not a date.
 */
export function unavailableAfter(directives: ReadonlySet<string>): Date | null {
  for (const directive of directives) {
    if (!directive.startsWith('unavailable_after:')) continue
    const time = Date.parse(directive.slice('unavailable_after:'.length))
    if (!Number.isNaN(time)) return new Date(time)
  }
  return null
}

export interface AuditedUrl {
  /** Immutable served projection, for explicit HTML/response checks. */
  served?: AuditedUrl
  documentObservation?: 'complete' | 'redirected' | 'unobserved'
  documentUnobserved?: string[]
  blockersKnown?: boolean
  canonicalKnown?: boolean
  /** The URL's render observation; never substituted for its served facts. */
  render?: CrawlUrlRender
  vitals?: VitalMetrics
  url: CrawlUrl
  internal: boolean
  /** What the crawl recorded from its HTML. `null` if it is not a page, or from before the checks. */
  facts: CrawlPageFacts | null
  /** A page that answered successfully, the only kind whose content means anything. */
  contentPage: boolean
  parsed: URL
  directives: ReadonlySet<string>
  noindex: boolean
  nofollow: boolean
  /** Its canonical says another URL is the one to index. */
  canonicalised: boolean
  robotsBlocked: boolean
  /**
   * What the crawl saw of whether it can be indexed (`assessIndexability`): a technical state, apart
   * from the audit, from what is expected of the URL and from whether it is indexed.
   */
  indexability: Indexability
  /** Technically indexable: a page that answered with nothing in the way. */
  indexable: boolean
  /** Audited, or left out of the audit by a rule or an exception. Only internal URLs can be. */
  participation: AuditParticipation
  /** Left out of the audit: it is crawled and its data is kept, but it has no findings of its own. */
  excluded: boolean
  /** The rule that decided `participation`; `null` for the default. */
  participationRule: AuditRule | null
  /**
   * What the user expects of its indexation: what a rule or an exception says, and `indexable` when
   * none does (`none` only for a configuration from before that default). Never evidence of what a
   * search engine did.
   */
  intent: RecordedIntent
  /** The rule that decided it. `null`: the expectation is the default. */
  intentRule: AuditRule | null
  /**
   * What rules ask of each condition (`noindex`, `nofollow`, `robots`, `sitemap`), each decided on its
   * own. `null`: no rule does, and the generic findings apply as they always did.
   */
  conditions: ResolvedConditions
  /**
   * The page was read whole (its answer, headers and HTML), so a directive it does not declare is
   * proven absent. Without it, a missing directive is unknown.
   */
  directivesKnown: boolean
  /** The robots.txt of its origin answered, or is not there: a block, or its absence, is proven. */
  robotsKnown: boolean
  /**
   * Whether a search engine has it in its index. The crawl cannot say: it takes a source that does,
   * such as Search Console. `null`: unknown, which is what every URL is until there is one.
   */
  indexed: boolean | null
  /** Its hreflang entries, wherever they were declared. */
  hreflang: HreflangEntry[]
  /** Links from other URLs of the site, not counting redirects. */
  linksIn: number
  htmlAnchorsIn: number
  htmlInternalAnchorsOut: number
  renderedAnchorsFrom: string[]
  renderedLinksTo: string[]
  renderedAnchorsOut: number
  anchorsIn: number
  /** Anchors in that a search engine would follow. */
  followedAnchorsIn: number
  /** Anchors in that come from pages a search engine would index. */
  anchorsFromIndexable: number
  /**
   * Sitemaps that list it: a `<loc>`, or a line of a text sitemap. An alternate or an image named by
   * an entry does not list it.
   */
  sitemaps: number
  /**
   * Sitemaps that name it in a way the crawl did not record: it comes from a crawl that stored every
   * URL of a sitemap alike, and the URL is one of the alternates a sitemap declared, so it may be
   * listed or may only be an alternate. Never counted as listed, never as absent.
   */
  sitemapsAmbiguous: number
  /** HTML anchors to other URLs of the site; rendered-only anchors belong to the site graph. */
  internalAnchorsOut: number
  nofollowAnchorsOut: number
  /** The URLs of the site its anchors link to. */
  linksTo: AuditedUrl[]
  /**
   * What it loads (images, scripts, stylesheets, media, frames) that was requested and failed: how
   * many, once each, and the first `MAX_EVIDENCE_ITEMS` as a sample. Bounded, because a site with
   * a broken resource that every page loads would otherwise keep it once per page.
   */
  failedEmbeds: { total: number; sample: AuditedUrl[] }
  /** Clicks from the home page. `null`: following links does not get here. */
  clickDepth: number | null
}

export interface Site {
  /** When the audit happens, for what depends on the date. */
  now: Date
  /** The audit configuration this analysis applies, whole: no URL is judged by another version. */
  config: AuditSnapshot
  urls: AuditedUrl[]
  identity?: (url: string) => string
  get(url: string): AuditedUrl | undefined
  /** Whether any URL of the site answered as a page, unlike a site that is down. */
  answered: boolean
  /**
   * Whether the sitemaps were all read, so that a URL none of them lists is proven to be out of
   * them. `unknown`: one could not be read, the crawl stopped at its URL limit, or a robots.txt did
   * not answer; presence in a sitemap is still proven by what was read.
   */
  sitemapCoverage: SitemapCoverage
  /** A completed crawl was not cut at its URL limit. */
  htmlLinksComplete: boolean
  documentUnobserved?: ReadonlySet<string>
  rendersUnobserved: number
  renderCoverage: NonNullable<AuditSnapshot['renderCoverage']>
  linksComplete: boolean
  /**
   * The indexable pages that share each value, in URL order, which is what makes one a duplicate:
   * only values that several pages share are here. Pages left out of the audit are not in them: they
   * would make audited pages look like copies, and be listed as the copy.
   */
  titles: Map<string, AuditedUrl[]>
  descriptions: Map<string, AuditedUrl[]>
  h1s: Map<string, AuditedUrl[]>
  texts: Map<string, AuditedUrl[]>
  /** For each page that has near copies, some of them (`MAX_NEAR_PARTNERS`), in URL order. */
  nearDuplicates: ReadonlyMap<AuditedUrl, readonly AuditedUrl[]>
}

/** The form two titles, descriptions or headings are compared in. */
export const comparable = (text: string | null | undefined) =>
  (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Whether the crawler only requested a URL because it tries them on every site: the other schemes
 * and `www` of the home page, and the well-known files. Failing is not an issue for one of those,
 * unless something links to it or the site does not answer at all.
 */
export function isGuess(url: AuditedUrl, site: Site): boolean {
  const { source } = url.url
  const tried = source === 'seed' || crawlFileKindOf(source) !== null
  return tried && url.linksIn === 0 && site.answered
}

export type SitemapCoverage = 'complete' | 'unknown'

/** A `robots.txt` as it answered: what it says, and the status that tells whether it can be relied on. */
export interface RobotsFile {
  /** `null`: it had no text (not there, empty, or a request that failed). */
  parsed: ParsedRobots | null
  status: number | null
}

/**
 * Whether a `robots.txt` answer settles what it allows: it answered, or it is not there (a 4xx, which
 * means no restrictions). A server error, a timeout, a refusal to answer fast enough (429) or no
 * answer at all settle nothing: a block, or its absence, is not proven.
 */
export const robotsConclusive = (status: number | null) =>
  status !== null &&
  ((status >= 200 && status < 300) || (status >= 400 && status < 500 && status !== 429))

export function robotsOf(crawl: Pick<Crawl, 'robots'>): Map<string, RobotsFile> {
  const files = new Map<string, RobotsFile>()
  for (const [origin, file] of Object.entries(crawl.robots ?? {})) {
    files.set(origin, {
      parsed: file.body !== null ? parseRobots(file.body) : null,
      status: file.status,
    })
  }
  return files
}

/** What a URL is like to the audit: its answer, what is expected of it, and what stands in its way. */
export function auditUrl(
  url: CrawlUrl,
  robots: ReadonlyMap<string, RobotsFile>,
  resolver: AuditResolver,
  identity: (url: string) => string = (url) => url,
): AuditedUrl {
  const parsed = new URL(url.url)
  const internal = url.scope === 'internal'
  // Facts stored by an older crawl lack the fields added since: those read as not seen.
  const facts = internal && url.data?.facts ? { ...emptyPageFacts(), ...url.data.facts } : null
  const contentPage =
    internal &&
    url.kind === 'page' &&
    url.statusCode !== null &&
    url.statusCode >= 200 &&
    url.statusCode < 300
  const directives = parseRobotsDirectives([
    url.metaRobots,
    url.xRobotsTag,
    url.data?.botRobots?.[SEARCH_BOT.toLowerCase()],
  ])
  const noindex = directives.has('noindex') || directives.has('none')
  const nofollow = directives.has('nofollow') || directives.has('none')
  const canonicalised = url.canonical !== null && identity(url.canonical) !== identity(url.url)
  const fileOfTheCrawl = crawlFileKindOf(url.source) !== null
  const robotsFile = robots.get(parsed.origin)
  const parsedRobots = robotsFile?.parsed ?? undefined
  const robotsBlocked =
    internal &&
    !fileOfTheCrawl &&
    parsedRobots !== undefined &&
    !isRobotsAllowed(parsedRobots, SEARCH_BOT, parsed.pathname + parsed.search)
  const robotsKnown = internal && !fileOfTheCrawl && robotsConclusive(robotsFile?.status ?? null)
  const indexability = assessIndexability({
    state: url.state,
    kind: url.kind,
    statusCode: url.statusCode,
    noindex,
    canonicalised,
    robotsBlocked,
  })
  // Only the URLs of the site can be left out or have an intent: the rest is just recorded.
  const resolved = internal ? resolver.resolve(url.url) : null
  return {
    url,
    internal,
    facts,
    contentPage,
    parsed,
    directives,
    noindex,
    nofollow,
    canonicalised,
    robotsBlocked,
    indexability: internal ? indexability : { state: 'unknown', blockers: [] },
    indexable: internal && indexability.state === 'indexable',
    participation: resolved?.audit.value ?? 'audited',
    excluded: resolved?.audit.value === 'excluded',
    participationRule: resolved?.audit.rule ?? null,
    intent: resolved?.intent.value ?? 'none',
    intentRule: resolved?.intent.rule ?? null,
    conditions: resolved?.conditions ?? defaultResolution().conditions,
    directivesKnown: contentPage && facts !== null && url.data?.truncated !== true,
    robotsKnown,
    indexed: null,
    hreflang: url.data?.hreflang ? [...url.data.hreflang] : [],
    linksIn: 0,
    htmlAnchorsIn: 0,
    htmlInternalAnchorsOut: 0,
    renderedAnchorsFrom: [],
    renderedLinksTo: [],
    renderedAnchorsOut: 0,
    anchorsIn: 0,
    followedAnchorsIn: 0,
    anchorsFromIndexable: 0,
    sitemaps: 0,
    sitemapsAmbiguous: 0,
    internalAnchorsOut: 0,
    nofollowAnchorsOut: 0,
    linksTo: [],
    failedEmbeds: { total: 0, sample: [] },
    clickDepth: null,
  }
}

/** A requested URL that answered with an error or did not answer (bots refused elsewhere do not count). */
function embedFailed(target: AuditedUrl | undefined): target is AuditedUrl {
  if (!target || target.url.state !== 'done') return false
  const { error, statusCode } = target.url
  if (error !== null) return true
  if (statusCode === null || statusCode < 400 || statusCode > 599) return false
  return target.internal || !REFUSES_BOTS.has(statusCode)
}

/** Follows redirects and anchors from the home page, a redirect not being a click. */
function measureClickDepth(
  urls: readonly AuditedUrl[],
  byHash: ReadonlyMap<string, AuditedUrl>,
  identity: (url: string) => string,
) {
  let frontier = urls.filter((url) => url.url.source === 'seed')
  for (let depth = 0; frontier.length > 0; depth++) {
    const next: AuditedUrl[] = []
    // It grows as it is read: where a redirect leads is at the same depth.
    for (let i = 0; i < frontier.length; i++) {
      const url = frontier[i]!
      if (url.clickDepth !== null) continue
      url.clickDepth = depth
      const target = url.url.redirectTo
        ? byHash.get(crawlUrlHash(identity(url.url.redirectTo)))
        : undefined
      if (target) frontier.push(target)
      for (const linked of url.linksTo) next.push(linked)
    }
    frontier = next
  }
}

/**
 * A sitemap whose links were stored before the crawl recorded what each one was: every URL it found
 * is a link of the `sitemap` type, listed or only mentioned. Crawls since then say how many URLs the
 * file mentions without listing (`references`, even when none), which is what tells them apart.
 */
const storedAlike = (file: AuditedUrl) => {
  const size = file.url.data?.sitemapSize
  return size !== undefined && size.references === undefined
}

const byAddress = (a: AuditedUrl, b: AuditedUrl) =>
  a.url.url < b.url.url ? -1 : a.url.url > b.url.url ? 1 : 0

/** The pages that share each value of `key`, leaving out the empty ones and the values of one page. */
function sharedValues(urls: readonly AuditedUrl[], key: (url: AuditedUrl) => string | null) {
  const groups = new Map<string, AuditedUrl[]>()
  for (const url of urls) {
    const value = key(url)
    if (!value) continue
    const group = groups.get(value)
    if (group) group.push(url)
    else groups.set(value, [url])
  }
  for (const [value, group] of groups) {
    if (group.length < 2) groups.delete(value)
    // Sorted once here: a value that thousands of pages share is read once per page.
    else group.sort(byAddress)
  }
  return groups
}

/**
 * Everything known about a crawl, in memory: what each URL answered, and what can only be known by
 * looking at the rest of the site, such as who links to it. The URLs are bounded by the domain's
 * limit, and their stored data by what `PageFactsCollector` keeps of a page.
 *
 * `config` is the audit configuration to apply, which the caller chose: the current one for a new
 * crawl or a recalculation, the one the crawl was analysed with to repeat that analysis.
 */
export async function loadSite(
  db: Database,
  crawl: Crawl,
  config: AuditSnapshot,
  now = new Date(),
): Promise<Site> {
  const domain = await db.domains.get(crawl.domainId)
  if (!domain) throw new Error(`Domain ${crawl.domainId} not found`)
  // As the analysis that kept this configuration would resolve it: what it meant, and its languages.
  const resolver = compileAuditSnapshot(config, domain.host)
  const identity = (url: string) =>
    stripIgnoredParameters(url, crawl.ignoredParameters ?? [], domain.host)
  const robots = robotsOf(crawl)
  const urls: AuditedUrl[] = []
  const byHash = new Map<string, AuditedUrl>()
  const vitals = new Map(
    (await db.vitals.urls(crawl.id))
      .filter((row) => row.source === 'field' && row.formFactor === 'PHONE')
      .map((row) => [row.urlHash, row]),
  )
  for (const view of VIEWS) {
    for (let offset = 0; ; offset += BATCH) {
      const batch = await db.crawls.listUrls({ crawlId: crawl.id, view, limit: BATCH, offset })
      for (const row of batch) {
        const url = auditUrl(row, robots, resolver, identity)
        url.vitals = vitals.get(row.urlHash)
        urls.push(url)
        byHash.set(row.urlHash, url)
      }
      if (batch.length < BATCH) break
    }
  }

  const renders = new Map((await db.crawls.renders(crawl.id)).map((row) => [row.urlHash, row]))
  const internal = urls.filter((url) => url.internal)
  if (crawl.rendering?.mode === 'rendered') {
    for (const url of internal) selectDocument(url, renders.get(url.url.urlHash), identity)
  }
  // Links of the `sitemap` type from a sitemap parsed before the crawl told a listing from a mention,
  // by the URL they point at, and the URLs a sitemap declared as an alternate: only the ones in both
  // cannot be told apart, and they are settled once every alternate is known.
  const unattributed = new Map<AuditedUrl, number>()
  const alternates = new Set<string>()
  for (let start = 0; start < internal.length; start += BATCH) {
    const hashes = internal.slice(start, start + BATCH).map((url) => url.url.urlHash)
    // Every link of a source is in this batch, so what a page was seen to load is only kept until the
    // batch ends: what stays is its total and a sample.
    const failedEmbedsSeen = new Map<AuditedUrl, Set<AuditedUrl>>()
    const [links, declared] = await Promise.all([
      db.crawls.linksFrom(crawl.id, hashes),
      db.crawls.sitemapHreflangOf(crawl.id, hashes),
    ])
    for (const { sourceHash, targetHash, kind, rendered } of links) {
      // Only rendered anchors feed the audit graph; other rendered declarations stay stored
      // for render details and future checks, never as input to existing HTML checks.
      if (
        rendered &&
        (crawl.rendering?.mode !== 'rendered' ||
          renders.get(sourceHash)?.data.redirected === true ||
          (kind !== 'anchor' && kind !== 'anchor-nofollow'))
      )
        continue
      if (sourceHash === targetHash) continue
      const source = byHash.get(sourceHash)
      const target = byHash.get(targetHash)
      if (!source) continue
      if (EMBED_KINDS.has(kind) && target !== source && embedFailed(target)) {
        // Of the site, or of another that the crawl requested because an anchor links to it.
        let seen = failedEmbedsSeen.get(source)
        if (!seen) failedEmbedsSeen.set(source, (seen = new Set()))
        if (!seen.has(target)) {
          seen.add(target)
          source.failedEmbeds.total++
          if (source.failedEmbeds.sample.length < MAX_EVIDENCE_ITEMS) {
            source.failedEmbeds.sample.push(target)
          }
        }
      }
      if (!target?.internal) continue
      if (kind === 'sitemap') {
        if (storedAlike(source)) unattributed.set(target, (unattributed.get(target) ?? 0) + 1)
        else target.sitemaps++
      }
      if (kind !== 'redirect') target.linksIn++
      if (kind !== 'anchor' && kind !== 'anchor-nofollow') continue
      if (!rendered) {
        target.htmlAnchorsIn++
        source.htmlInternalAnchorsOut++
        // URL-scoped checks must agree with an HTML-only recheck in either crawl mode.
        source.internalAnchorsOut++
        if (kind === 'anchor-nofollow') source.nofollowAnchorsOut++
      } else {
        source.renderedAnchorsOut++
        if (source.renderedLinksTo.length < MAX_EVIDENCE_ITEMS)
          source.renderedLinksTo.push(target.url.url)
        if (target.renderedAnchorsFrom.length < MAX_EVIDENCE_ITEMS)
          target.renderedAnchorsFrom.push(source.url.url)
      }
      target.anchorsIn++
      if (kind === 'anchor' && !source.nofollow) target.followedAnchorsIn++
      if (source.indexable) target.anchorsFromIndexable++
      source.linksTo.push(target)
    }
    for (const { pageHash, lang, url } of declared) {
      byHash.get(pageHash)?.hreflang.push({ lang, url, source: 'sitemap' })
      alternates.add(crawlUrlHash(identity(url)))
    }
  }
  for (const [target, count] of unattributed) {
    // What a sitemap parsed before the origin was recorded says is all it can say: that it named the
    // URL. The crawl kept which URLs sitemaps declared as alternates (`crawl_sitemap_hreflang`), so
    // one of those cannot be told from a listing, and is not claimed either way. Anything else keeps
    // counting as listed, as it always did: the crawl never kept which images and videos a sitemap
    // named, and they are rarely pages (only a page can be judged for its listing).
    if (alternates.has(target.url.urlHash)) target.sitemapsAmbiguous += count
    else target.sitemaps += count
  }
  measureClickDepth(internal, byHash, identity)
  // The served projection was taken before the site was read: give it every site-wide count (links,
  // sitemaps, click depth), so response and HTML checks never read a count that was not computed.
  // The outgoing counts and failed embeds kept here are the HTML ones.
  for (const url of internal) {
    if (!url.served) continue
    Object.assign(url.served, {
      linksIn: url.linksIn,
      htmlAnchorsIn: url.htmlAnchorsIn,
      htmlInternalAnchorsOut: url.htmlInternalAnchorsOut,
      renderedAnchorsFrom: url.renderedAnchorsFrom,
      renderedLinksTo: url.renderedLinksTo,
      renderedAnchorsOut: url.renderedAnchorsOut,
      anchorsIn: url.anchorsIn,
      followedAnchorsIn: url.followedAnchorsIn,
      anchorsFromIndexable: url.anchorsFromIndexable,
      sitemaps: url.sitemaps,
      sitemapsAmbiguous: url.sitemapsAmbiguous,
      internalAnchorsOut: url.internalAnchorsOut,
      nofollowAnchorsOut: url.nofollowAnchorsOut,
      linksTo: url.linksTo,
      failedEmbeds: url.failedEmbeds,
      clickDepth: url.clickDepth,
      hreflang: [
        ...(url.served.url.data?.hreflang ?? []),
        ...url.hreflang.filter((entry) => entry.source === 'sitemap'),
      ],
    } satisfies Partial<AuditedUrl>)
  }
  if (crawl.rendering?.mode === 'rendered') {
    for (const url of internal) {
      const summary = url.render?.data.documentLinks
      if (url.documentObservation !== 'complete' || !summary) continue
      url.internalAnchorsOut = summary.internal
      url.nofollowAnchorsOut = summary.nofollow
      url.failedEmbeds = { total: 0, sample: [] }
      for (const address of summary.embeds) {
        const target = byHash.get(crawlUrlHash(identity(address)))
        if (!embedFailed(target)) continue
        url.failedEmbeds.total++
        if (url.failedEmbeds.sample.length < MAX_EVIDENCE_ITEMS)
          url.failedEmbeds.sample.push(target)
      }
    }
  }
  let rendersUnobserved = 0
  const renderCoverage = { failedOrMissing: 0, truncated: 0, unsettled: 0 }
  if (crawl.rendering?.mode === 'rendered') {
    for (const url of internal) {
      if (!url.contentPage) continue
      const render = renders.get(url.url.urlHash)
      url.render = render
      // A missing truncation flag in an older render is missing evidence, never proof of a whole page.
      const failedOrMissing = render?.status !== 'rendered' || render.truncated === null
      const truncated = url.url.data?.truncated === true || render?.truncated === true
      const unsettled =
        render?.status === 'rendered' && !render.settled && render.data.redirected !== true
      if (failedOrMissing) renderCoverage.failedOrMissing++
      if (truncated) renderCoverage.truncated++
      if (unsettled) renderCoverage.unsettled++
      if (failedOrMissing || truncated || unsettled) rendersUnobserved++
    }
  }

  // What pages are compared against each other: the audited ones that can be indexed. A page left
  // out of the audit stays in the site (links, canonicals, hreflang, redirects see it as it is) but
  // is not a copy of anything an audited page should answer for.
  const indexable = urls.filter(
    (url) =>
      url.indexable &&
      !url.excluded &&
      url.facts &&
      url.documentObservation !== 'unobserved' &&
      url.documentObservation !== 'redirected',
  )
  const comparableTexts = indexable.flatMap((url) => {
    const simhash = url.facts?.textSimhash
    return simhash ? [{ url, simhash, group: url.facts?.textHash ?? null }] : []
  })
  return {
    now,
    identity,
    config,
    urls,
    get: (url) => byHash.get(crawlUrlHash(identity(url))),
    answered: urls.some((url) => url.contentPage),
    sitemapCoverage: sitemapCoverageOf(crawl, domain.host, urls),
    htmlLinksComplete: crawl.status === 'completed',
    documentUnobserved: config.documentBasis
      ? new Set([
          ...internal.flatMap((url) =>
            url.documentObservation && url.documentObservation !== 'complete'
              ? PAGE_ISSUE_IDS.filter(
                  (id) => ISSUE_BASIS[id] === 'document' && !isPageLocalIssue(id),
                )
              : (url.documentUnobserved?.filter((id) => !isPageLocalIssue(id)) ?? []),
          ),
          ...(internal.some(
            (url) => url.blockersKnown === false && url.documentObservation !== 'redirected',
          )
            ? ['only-noindex-inlinks', 'links-to-canonicalised']
            : []),
        ])
      : undefined,
    rendersUnobserved,
    renderCoverage,
    linksComplete: crawl.status === 'completed' && rendersUnobserved === 0,
    titles: sharedValues(indexable, (url) => comparable(url.url.title)),
    descriptions: sharedValues(indexable, (url) => comparable(url.url.data?.description)),
    h1s: sharedValues(indexable, (url) => comparable(url.url.data?.h1?.[0])),
    texts: sharedValues(indexable, (url) => url.facts?.textHash ?? null),
    nearDuplicates: new Map(
      [...findNearDuplicates(comparableTexts)].map(([item, partners]) => [
        item.url,
        [...partners].map((partner) => partner.url).sort(byAddress),
      ]),
    ),
  }
}

/**
 * Whether every sitemap of the site was read, so that being in none of them can be told from not
 * knowing. It is not when:
 * - the crawl stopped at its URL limit: the links to the URLs it dropped were not kept;
 * - a robots.txt did not answer, so the sitemaps it declares are not known;
 * - robots.txt declares a sitemap off the site, which the crawl does not read;
 * - a sitemap file was not read whole: it was not requested, failed, is not a sitemap, or was cut.
 *   The usual names the crawler tries on every site (`/sitemap.xml`) say nothing when they are
 *   simply not there, or are not sitemaps.
 * A site with no sitemap at all, and robots.txt that said so, has none to list a URL: complete.
 */
export function sitemapCoverageOf(
  crawl: Pick<Crawl, 'status' | 'robots'>,
  host: string,
  urls: readonly AuditedUrl[],
): SitemapCoverage {
  if (crawl.status !== 'completed') return 'unknown'
  for (const [origin, file] of Object.entries(crawl.robots ?? {})) {
    // A redirect leads to the robots.txt of another origin, which has its own entry.
    const redirected = file.status !== null && file.status >= 300 && file.status < 400
    if (!redirected && !robotsConclusive(file.status)) return 'unknown'
    if (file.body === null) continue
    for (const sitemap of parseRobotsSitemaps(file.body, `${origin}/robots.txt`)) {
      if (!isInternalUrl(sitemap, host)) return 'unknown'
    }
  }
  for (const file of urls) {
    if (!file.internal || crawlFileKindOf(file.url.source) !== 'sitemap') continue
    const { state, statusCode, data, kind } = file.url
    if (state !== 'done') return 'unknown'
    if (data?.truncated) return 'unknown'
    if (data?.sitemapSize !== undefined) continue
    // A sitemap that moved is read where it landed.
    if (kind === 'redirect') continue
    // Only tried, because it is a usual name: nothing declared it, and it is simply not there (or not
    // a sitemap). One that robots.txt or another sitemap declared has to be a sitemap.
    const settled =
      statusCode !== null &&
      (statusCode === 404 || statusCode === 410 || (statusCode >= 200 && statusCode < 300))
    if (file.linksIn === 0 && settled) continue
    return 'unknown'
  }
  return 'complete'
}

/** How many hops following a redirect takes, and whether it never gets anywhere. */
export function followRedirects(start: AuditedUrl, site: Site): { hops: number; loop: boolean } {
  const seen = new Set<AuditedUrl>([start])
  let current = start
  let hops = 0
  while (current.url.redirectTo) {
    const next = site.get(current.url.redirectTo)
    hops++
    if (next?.url.kind !== 'redirect') return { hops, loop: false }
    if (seen.has(next) || hops >= MAX_REDIRECT_HOPS) return { hops, loop: true }
    seen.add(next)
    current = next
  }
  return { hops, loop: false }
}
