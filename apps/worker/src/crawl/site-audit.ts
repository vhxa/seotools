import {
  crawlFileKindOf,
  crawlUrlHash,
  isRobotsAllowed,
  parseRobots,
  type CrawlPageFacts,
  type HreflangEntry,
  type ParsedRobots,
} from '@seotools/core'
import type { Crawl, CrawlUrl, CrawlUrlView, Database } from '@seotools/db'
import { findNearDuplicates } from './fingerprint'

const BATCH = 1000
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
  indexable: boolean
  /**
   * Whether a search engine has it in its index. The crawl cannot say: it takes a source that does,
   * such as Search Console. `null`: unknown, which is what every URL is until there is one.
   */
  indexed: boolean | null
  /** Its hreflang entries, wherever they were declared. */
  hreflang: HreflangEntry[]
  /** Links from other URLs of the site, not counting redirects. */
  linksIn: number
  anchorsIn: number
  /** Anchors in that a search engine would follow. */
  followedAnchorsIn: number
  /** Anchors in that come from pages a search engine would index. */
  anchorsFromIndexable: number
  /** Sitemaps that list it. */
  sitemaps: number
  /** Anchors to other URLs of the site. */
  internalAnchorsOut: number
  nofollowAnchorsOut: number
  /** The URLs of the site its anchors link to. */
  linksTo: AuditedUrl[]
  /** Clicks from the home page. `null`: following links does not get here. */
  clickDepth: number | null
}

export interface Site {
  /** When the audit happens, for what depends on the date. */
  now: Date
  urls: AuditedUrl[]
  get(url: string): AuditedUrl | undefined
  /** Whether any URL of the site answered as a page, unlike a site that is down. */
  answered: boolean
  /** How many indexable pages share each value, which is what makes one a duplicate. */
  titles: Map<string, number>
  descriptions: Map<string, number>
  h1s: Map<string, number>
  texts: Map<string, number>
  nearDuplicates: ReadonlySet<AuditedUrl>
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

function robotsOf(crawl: Crawl) {
  const parsed = new Map<string, ParsedRobots>()
  for (const [origin, file] of Object.entries(crawl.robots ?? {})) {
    if (file.body !== null) parsed.set(origin, parseRobots(file.body))
  }
  return parsed
}

function audit(url: CrawlUrl, robots: ReadonlyMap<string, ParsedRobots>): AuditedUrl {
  const parsed = new URL(url.url)
  const internal = url.scope === 'internal'
  const facts = internal ? (url.data?.facts ?? null) : null
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
  const canonicalised = url.canonical !== null && url.canonical !== url.url
  const fileOfTheCrawl = crawlFileKindOf(url.source) !== null
  const parsedRobots = robots.get(parsed.origin)
  const robotsBlocked =
    internal &&
    !fileOfTheCrawl &&
    parsedRobots !== undefined &&
    !isRobotsAllowed(parsedRobots, SEARCH_BOT, parsed.pathname + parsed.search)
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
    indexable: contentPage && !noindex && !canonicalised && !robotsBlocked,
    indexed: null,
    hreflang: url.data?.hreflang ? [...url.data.hreflang] : [],
    linksIn: 0,
    anchorsIn: 0,
    followedAnchorsIn: 0,
    anchorsFromIndexable: 0,
    sitemaps: 0,
    internalAnchorsOut: 0,
    nofollowAnchorsOut: 0,
    linksTo: [],
    clickDepth: null,
  }
}

/** Follows redirects and anchors from the home page, a redirect not being a click. */
function measureClickDepth(urls: readonly AuditedUrl[], byHash: ReadonlyMap<string, AuditedUrl>) {
  let frontier = urls.filter((url) => url.url.source === 'seed')
  for (let depth = 0; frontier.length > 0; depth++) {
    const next: AuditedUrl[] = []
    // It grows as it is read: where a redirect leads is at the same depth.
    for (let i = 0; i < frontier.length; i++) {
      const url = frontier[i]!
      if (url.clickDepth !== null) continue
      url.clickDepth = depth
      const target = url.url.redirectTo ? byHash.get(crawlUrlHash(url.url.redirectTo)) : undefined
      if (target) frontier.push(target)
      for (const linked of url.linksTo) next.push(linked)
    }
    frontier = next
  }
}

function countValues(values: Iterable<string>) {
  const counts = new Map<string, number>()
  for (const value of values) {
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

/**
 * Everything known about a crawl, in memory: what each URL answered, and what can only be known by
 * looking at the rest of the site, such as who links to it. The URLs are bounded by the domain's
 * limit, and their stored data by what `PageFactsCollector` keeps of a page.
 */
export async function loadSite(db: Database, crawl: Crawl, now = new Date()): Promise<Site> {
  const robots = robotsOf(crawl)
  const urls: AuditedUrl[] = []
  const byHash = new Map<string, AuditedUrl>()
  for (const view of VIEWS) {
    for (let offset = 0; ; offset += BATCH) {
      const batch = await db.crawls.listUrls({ crawlId: crawl.id, view, limit: BATCH, offset })
      for (const row of batch) {
        const url = audit(row, robots)
        urls.push(url)
        byHash.set(row.urlHash, url)
      }
      if (batch.length < BATCH) break
    }
  }

  const internal = urls.filter((url) => url.internal)
  for (let start = 0; start < internal.length; start += BATCH) {
    const hashes = internal.slice(start, start + BATCH).map((url) => url.url.urlHash)
    const [links, alternates] = await Promise.all([
      db.crawls.linksFrom(crawl.id, hashes),
      db.crawls.sitemapHreflangOf(crawl.id, hashes),
    ])
    for (const { sourceHash, targetHash, kind } of links) {
      if (sourceHash === targetHash) continue
      const source = byHash.get(sourceHash)
      const target = byHash.get(targetHash)
      if (!source || !target?.internal) continue
      if (kind === 'sitemap') target.sitemaps++
      if (kind !== 'redirect') target.linksIn++
      if (kind !== 'anchor' && kind !== 'anchor-nofollow') continue
      target.anchorsIn++
      if (kind === 'anchor' && !source.nofollow) target.followedAnchorsIn++
      if (source.indexable) target.anchorsFromIndexable++
      source.internalAnchorsOut++
      if (kind === 'anchor-nofollow') source.nofollowAnchorsOut++
      source.linksTo.push(target)
    }
    for (const { pageHash, lang, url } of alternates) {
      byHash.get(pageHash)?.hreflang.push({ lang, url, source: 'sitemap' })
    }
  }
  measureClickDepth(internal, byHash)

  const indexable = urls.filter((url) => url.indexable && url.facts)
  const comparableTexts = indexable.flatMap((url) => {
    const simhash = url.facts?.textSimhash
    return simhash ? [{ url, simhash, group: url.facts?.textHash ?? null }] : []
  })
  return {
    now,
    urls,
    get: (url) => byHash.get(crawlUrlHash(url)),
    answered: urls.some((url) => url.contentPage),
    titles: countValues(indexable.map((url) => comparable(url.url.title))),
    descriptions: countValues(indexable.map((url) => comparable(url.url.data?.description))),
    h1s: countValues(indexable.map((url) => comparable(url.url.data?.h1?.[0]))),
    texts: countValues(indexable.map((url) => url.facts?.textHash ?? '')),
    nearDuplicates: new Set([...findNearDuplicates(comparableTexts)].map((item) => item.url)),
  }
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
