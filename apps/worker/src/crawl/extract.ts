import {
  normalizeCrawlUrl,
  type CrawlLinkKind,
  type CrawlPageFacts,
  type FeedSummary,
  type HreflangEntry,
  type OpenSearchSummary,
  type SitemapSummary,
} from '@seotools/core'
import { Parser } from 'htmlparser2'
import { PageFactsCollector } from './page-facts'

export interface ExtractedLink {
  url: string
  kind: CrawlLinkKind
}

export interface ExtractedHtml {
  title: string | null
  description: string | null
  h1: string[]
  /** Every `<meta name="robots">`, comma-separated. */
  metaRobots: string | null
  /** Directives aimed at one bot, e.g. `<meta name="googlebot">`, by lowercase bot name. */
  botRobots: Record<string, string>
  canonical: string | null
  hreflang: HreflangEntry[]
  /** What the page announces with `<link rel="alternate">`. They are in `links` as well. */
  feeds: string[]
  /** What the page announces with `<link rel="search">`. They are in `links` as well. */
  openSearch: string[]
  links: ExtractedLink[]
  /** What the checks for issues look at. */
  facts: CrawlPageFacts
}

const MAX_H1 = 10
const MAX_HREFLANG = 500
const MAX_ANNOUNCED_FILES = 10
const FEED_TYPE = /^application\/(rss|atom)\+xml\b/i
const OPENSEARCH_TYPE = /^application\/opensearchdescription\+xml\b/i

type AttributeRule = readonly [attribute: string, kind: CrawlLinkKind, list?: 'srcset']

/** Every attribute that holds a URL, per element. `<link>`, `<meta>` and `<form>` are handled apart. */
const URL_ATTRIBUTES: Record<string, readonly AttributeRule[]> = {
  a: [['href', 'anchor']],
  area: [['href', 'anchor']],
  script: [['src', 'script']],
  img: [
    ['src', 'image'],
    ['srcset', 'image', 'srcset'],
    ['data-src', 'image'],
    ['data-srcset', 'image', 'srcset'],
    ['data-lazy-src', 'image'],
    ['data-original', 'image'],
    ['longdesc', 'other'],
  ],
  source: [
    ['src', 'media'],
    ['srcset', 'media', 'srcset'],
    ['data-src', 'media'],
    ['data-srcset', 'media', 'srcset'],
  ],
  video: [
    ['src', 'media'],
    ['poster', 'image'],
  ],
  audio: [['src', 'media']],
  track: [['src', 'media']],
  embed: [['src', 'media']],
  object: [['data', 'media']],
  iframe: [
    ['src', 'frame'],
    ['data-src', 'frame'],
  ],
  frame: [['src', 'frame']],
  input: [['src', 'image']],
  body: [['background', 'image']],
  table: [['background', 'image']],
  td: [['background', 'image']],
  blockquote: [['cite', 'other']],
  q: [['cite', 'other']],
  del: [['cite', 'other']],
  ins: [['cite', 'other']],
  html: [['manifest', 'head-link']],
  image: [
    ['href', 'image'],
    ['xlink:href', 'image'],
  ],
  use: [
    ['href', 'image'],
    ['xlink:href', 'image'],
  ],
}

/** `<meta>` tags whose content is a URL. */
const META_URL =
  /^(og:(url|image|video|audio)(:url|:secure_url)?|twitter:(url|image|image:src|player|player:stream)|thumbnail|msapplication-(tileimage|config))$/

/** `<meta name>` values holding robots directives for one bot: `googlebot`, `bingbot`… */
const BOT_META = /^[a-z0-9-]*bot[a-z0-9-]*$/

const CSS_URL =
  /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The URLs of a `srcset`: comma-separated candidates of a URL and an optional descriptor. */
function parseSrcset(value: string): string[] {
  const urls: string[] = []
  for (const candidate of value.split(/,\s+/)) {
    const url = candidate.trim().split(/\s+/)[0]?.replace(/,$/, '')
    if (url) urls.push(url)
  }
  return urls
}

/** Absolute URLs anywhere in a parsed JSON-LD value. */
function collectAbsoluteUrls(value: unknown, into: string[]) {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) into.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) collectAbsoluteUrls(item, into)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectAbsoluteUrls(item, into)
  }
}

/** Extracts the data of an HTML document, and every URL referenced anywhere in it. */
export function extractHtml(html: string, pageUrl: string): ExtractedHtml {
  const collector = new PageFactsCollector(pageUrl, (raw) => normalizeCrawlUrl(raw, base))
  const result: ExtractedHtml = {
    title: null,
    description: null,
    h1: [],
    metaRobots: null,
    botRobots: {},
    canonical: null,
    hreflang: [],
    feeds: [],
    openSearch: [],
    links: [],
    facts: collector.facts,
  }
  let base = pageUrl
  let baseSet = false
  let title: string | null = null
  let h1: string | null = null
  let h1Depth = 0
  let svgDepth = 0
  let rawText: { kind: 'style' | 'json-ld'; text: string } | null = null
  const robots: string[] = []

  const add = (raw: string | undefined, kind: CrawlLinkKind) => {
    if (raw === undefined) return
    const value = raw.trim()
    // `#section` and an empty href point at the page itself: they are not links to anything.
    if (!value || value.startsWith('#')) return
    collector.sawUrl(value, kind)
    const url = normalizeCrawlUrl(value, base)
    if (url) result.links.push({ url, kind })
  }

  const addCss = (css: string) => {
    for (const link of extractCssUrls(css, base)) result.links.push(link)
  }

  const onLink = (attributes: Record<string, string>) => {
    const rel = (attributes.rel ?? '').toLowerCase().split(/\s+/)
    const href = attributes.href
    const announced = href === undefined ? null : normalizeCrawlUrl(href, base)
    const type = attributes.type ?? ''
    if (announced && rel.includes('alternate') && FEED_TYPE.test(type)) {
      if (result.feeds.length < MAX_ANNOUNCED_FILES) result.feeds.push(announced)
    }
    if (announced && rel.includes('search') && OPENSEARCH_TYPE.test(type)) {
      if (result.openSearch.length < MAX_ANNOUNCED_FILES) result.openSearch.push(announced)
    }
    if (rel.includes('canonical')) {
      add(href, 'canonical')
      const url = href === undefined ? null : normalizeCrawlUrl(href, base)
      if (url && !result.canonical) result.canonical = url
    } else if (rel.includes('alternate') && attributes.hreflang) {
      add(href, 'hreflang')
      const url = href === undefined ? null : normalizeCrawlUrl(href, base)
      if (url && result.hreflang.length < MAX_HREFLANG) {
        result.hreflang.push({
          lang: attributes.hreflang,
          url,
          source: 'html',
          ...(collector.inHead ? {} : { outsideHead: true }),
        })
      }
    } else if (rel.includes('stylesheet')) {
      add(href, 'style')
    } else {
      add(href, 'head-link')
    }
    if (attributes.imagesrcset) {
      for (const url of parseSrcset(attributes.imagesrcset)) add(url, 'head-link')
    }
  }

  const onMeta = (attributes: Record<string, string>) => {
    const name = (attributes.name ?? attributes.property ?? '').toLowerCase()
    const content = attributes.content
    if (content === undefined) return
    if ((attributes['http-equiv'] ?? '').toLowerCase() === 'refresh') {
      const target = parseRefresh(content)
      add(target, 'meta')
      if (target !== undefined) collector.facts.refresh ??= normalizeCrawlUrl(target, base)
    } else if (name === 'robots') {
      robots.push(collapse(content))
    } else if (name === 'description') {
      result.description ??= collapse(content)
    } else if (BOT_META.test(name)) {
      result.botRobots[name] = collapse(content)
    } else if (META_URL.test(name)) {
      add(content, 'meta')
    }
  }

  const parser = new Parser(
    {
      onopentag(rawName, attributes) {
        const name = rawName.toLowerCase()
        collector.open(name, attributes)
        if (name === 'svg') svgDepth++
        if (name === 'base' && !baseSet && attributes.href) {
          const resolved = normalizeCrawlUrl(attributes.href, base)
          if (resolved) {
            base = resolved
            baseSet = true
          }
        }
        if (name === 'link') onLink(attributes)
        if (name === 'meta') onMeta(attributes)
        if (name === 'form' && (attributes.method ?? 'get').toLowerCase() === 'get') {
          add(attributes.action, 'form')
        }
        if (name === 'title' && svgDepth === 0 && result.title === null) title = ''
        if (name === 'h1') {
          if (h1Depth === 0) h1 = ''
          h1Depth++
        }
        if (name === 'style') rawText = { kind: 'style', text: '' }
        if (name === 'script' && (attributes.type ?? '').toLowerCase() === 'application/ld+json') {
          rawText = { kind: 'json-ld', text: '' }
        }
        for (const [attribute, ruleKind, list] of URL_ATTRIBUTES[name] ?? []) {
          const value = attributes[attribute]
          if (value === undefined) continue
          const nofollow =
            ruleKind === 'anchor' &&
            (attributes.rel ?? '').toLowerCase().split(/\s+/).includes('nofollow')
          const kind = nofollow ? 'anchor-nofollow' : ruleKind
          if (list) for (const url of parseSrcset(value)) add(url, kind)
          else add(value, kind)
        }
        if (attributes.style) addCss(attributes.style)
      },
      ontext(text) {
        collector.onText(text)
        if (title !== null) title += text
        if (h1 !== null) h1 += text
        if (rawText) rawText.text += text
      },
      onclosetag(rawName) {
        const name = rawName.toLowerCase()
        collector.close(name)
        if (name === 'svg' && svgDepth > 0) svgDepth--
        if (name === 'title' && title !== null) {
          result.title = collapse(title)
          title = null
        }
        if (name === 'h1' && h1Depth > 0) {
          h1Depth--
          if (h1Depth === 0 && h1 !== null) {
            if (result.h1.length < MAX_H1) result.h1.push(collapse(h1))
            h1 = null
          }
        }
        if ((name === 'style' || name === 'script') && rawText) {
          const { kind, text } = rawText
          rawText = null
          if (kind === 'style') addCss(text)
          else {
            const urls: string[] = []
            try {
              collectAbsoluteUrls(JSON.parse(text), urls)
            } catch {
              // Malformed JSON-LD is an issue of the page (`jsonLdInvalid`), not a crawl error.
            }
            for (const url of urls) add(url, 'structured-data')
          }
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  )
  parser.write(html)
  parser.end()

  if (robots.length > 0) result.metaRobots = robots.join(', ')
  collector.finish({ title: result.title, h1: result.h1[0] ?? null, links: result.links })
  return result
}

/** The URL of a `Refresh` header or `<meta http-equiv="refresh">`: `5; url=/next`. */
export function parseRefresh(value: string): string | undefined {
  const match = /^\s*[\d.]+\s*[;,]\s*(?:url\s*=\s*)?(.+)$/i.exec(value)
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '')
}

/** URLs in a stylesheet: `url(...)` and `@import`. */
export function extractCssUrls(css: string, base: string): ExtractedLink[] {
  const links: ExtractedLink[] = []
  for (const match of css.matchAll(CSS_URL)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]
    if (!raw || raw.startsWith('#')) continue
    const url = normalizeCrawlUrl(raw, base)
    if (url) links.push({ url, kind: 'style' })
  }
  return links
}

export interface ParsedLinkHeader {
  links: ExtractedLink[]
  canonical: string | null
  hreflang: HreflangEntry[]
}

/** The RFC 8288 `Link` response header, which can declare canonicals and hreflangs too. */
export function parseLinkHeader(value: string, base: string): ParsedLinkHeader {
  const parsed: ParsedLinkHeader = { links: [], canonical: null, hreflang: [] }
  for (const match of value.matchAll(/<([^>]*)>((?:\s*;\s*[^,;=]+(?:=(?:"[^"]*"|[^,;]*))?)*)/g)) {
    const url = normalizeCrawlUrl(match[1] ?? '', base)
    if (!url) continue
    const parameters = new Map<string, string>()
    for (const parameter of (match[2] ?? '').matchAll(/;\s*([^=;\s]+)\s*=\s*("[^"]*"|[^;]*)/g)) {
      const key = parameter[1]?.toLowerCase()
      if (key) parameters.set(key, (parameter[2] ?? '').replace(/^"|"$/g, '').trim())
    }
    const rel = (parameters.get('rel') ?? '').toLowerCase().split(/\s+/)
    const hreflang = parameters.get('hreflang')
    if (rel.includes('canonical')) {
      parsed.links.push({ url, kind: 'canonical' })
      parsed.canonical ??= url
    } else if (rel.includes('alternate') && hreflang) {
      parsed.links.push({ url, kind: 'hreflang' })
      parsed.hreflang.push({ lang: hreflang, url, source: 'header' })
    } else {
      parsed.links.push({ url, kind: 'http-header' })
    }
  }
  return parsed
}

/**
 * A URL a sitemap names without listing it: the alternate of an entry (`xhtml:link`), or an image or
 * a video attached to it. Listing is what a `<loc>` does; these only hang off an entry.
 */
export interface SitemapReference {
  url: string
  /** `hreflang` for an alternate declaring a language, `image`, `media` for a video, else `other`. */
  kind: 'hreflang' | 'image' | 'media' | 'other'
}

export interface ParsedSitemap {
  /**
   * The URLs the sitemap lists: the `<loc>` of each `<url>`, or each line of a plain-text sitemap.
   * Nothing else is a listing. A URL that is only an alternate or an attachment of another entry is
   * in `references`, not here.
   */
  urls: string[]
  /** What entries point at without listing it. Still requested by the crawler, never "in the sitemap". */
  references: SitemapReference[]
  /** Further sitemaps, from a sitemap index. */
  sitemaps: string[]
  /** `null`: this is not a sitemap, whatever else it may be. */
  format: SitemapSummary['format']
  /** `<url>` or `<sitemap>` elements: unlike `urls`, it does not count images and alternates. */
  entries: number
  /** The most recent `<lastmod>`, as ISO 8601. */
  lastModified: string | null
  /** The hreflang alternates it declares for its pages. */
  hreflang: { page: string; lang: string; url: string }[]
}

/** The later of a date kept as ISO 8601 and one as a site wrote it, ignoring what is not a date. */
function newestDate(current: string | null, candidate: string): string | null {
  const time = Date.parse(candidate.trim())
  if (Number.isNaN(time)) return current
  return current !== null && Date.parse(current) >= time ? current : new Date(time).toISOString()
}

/** The elements that attach a URL to an entry of a sitemap, and what each one attaches. */
const SITEMAP_ATTACHMENTS = new Map<string, SitemapReference['kind']>([
  ['image:loc', 'image'],
  ['video:content_loc', 'media'],
  ['video:player_loc', 'media'],
])

/** Parses an XML sitemap or sitemap index, or a plain-text sitemap (one URL per line). */
export function parseSitemap(content: string, base: string): ParsedSitemap {
  const parsed: ParsedSitemap = {
    urls: [],
    references: [],
    sitemaps: [],
    format: null,
    entries: 0,
    lastModified: null,
    hreflang: [],
  }
  const push = (into: string[], raw: string) => {
    const url = normalizeCrawlUrl(raw, base)
    if (url) into.push(url)
  }

  if (!content.trimStart().startsWith('<')) {
    for (const line of content.split(/\r?\n/)) {
      if (/^https?:\/\//i.test(line.trim())) push(parsed.urls, line)
    }
    if (parsed.urls.length > 0) parsed.format = 'text'
    parsed.entries = parsed.urls.length
    return parsed
  }

  const stack: string[] = []
  let text = ''
  // A `<url>` lists its alternates in any order around its `<loc>`, which they belong to.
  let loc: string | null = null
  let alternates: { lang: string; url: string }[] = []
  const parser = new Parser(
    {
      onopentag(rawName, attributes) {
        const name = rawName.toLowerCase()
        if (stack.length === 0) {
          if (name === 'urlset') parsed.format = 'urlset'
          if (name === 'sitemapindex') parsed.format = 'index'
        }
        stack.push(name)
        text = ''
        if (name === 'xhtml:link' && attributes.href) {
          const url = normalizeCrawlUrl(attributes.href, base)
          if (url) {
            // An alternate is declared by an entry; it is not an entry. Listing it takes its own `<url>`.
            parsed.references.push({ url, kind: attributes.hreflang ? 'hreflang' : 'other' })
            if (attributes.hreflang) alternates.push({ lang: attributes.hreflang, url })
          }
        }
      },
      ontext(chunk) {
        text += chunk
      },
      onclosetag(rawName) {
        const name = rawName.toLowerCase()
        stack.pop()
        const parent = stack[stack.length - 1]
        if (name === 'loc' && parent === 'url') loc = normalizeCrawlUrl(text, base)
        if (name === 'url') {
          if (loc) {
            for (const alternate of alternates) parsed.hreflang.push({ page: loc, ...alternate })
          }
          loc = null
          alternates = []
        }
        if (name === 'loc' && parent === 'sitemap') push(parsed.sitemaps, text)
        else if (name === 'loc' && parent === 'url') push(parsed.urls, text)
        else if (SITEMAP_ATTACHMENTS.has(name)) {
          const url = normalizeCrawlUrl(text, base)
          if (url) parsed.references.push({ url, kind: SITEMAP_ATTACHMENTS.get(name)! })
        } else if (name === 'lastmod' && (parent === 'url' || parent === 'sitemap')) {
          parsed.lastModified = newestDate(parsed.lastModified, text)
        } else if (
          (name === 'url' && parent === 'urlset') ||
          (name === 'sitemap' && parent === 'sitemapindex')
        ) {
          parsed.entries++
        }
        text = ''
      },
    },
    { xmlMode: true, decodeEntities: true },
  )
  parser.write(content)
  parser.end()
  return parsed
}

/** The `Sitemap:` lines of a robots.txt, wherever they are in the file. */
export function parseRobotsSitemaps(robotsTxt: string, base: string): string[] {
  const urls: string[] = []
  for (const line of robotsTxt.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line)
    const url = match?.[1] ? normalizeCrawlUrl(match[1], base) : null
    if (url) urls.push(url)
  }
  return urls
}

const collapseOrNull = (text: string) => collapse(text) || null

/** What an RSS, Atom or RDF feed says of itself. `null` if the document is not a feed. */
export function parseFeed(content: string): FeedSummary | null {
  let summary: FeedSummary | null = null
  const stack: string[] = []
  let text = ''
  const parser = new Parser(
    {
      onopentag(rawName) {
        const name = rawName.toLowerCase()
        if (stack.length === 0) {
          const format =
            name === 'rss' ? 'rss' : name === 'feed' ? 'atom' : name === 'rdf:rdf' ? 'rdf' : null
          if (format) summary = { format, title: null, items: 0, lastModified: null }
        }
        stack.push(name)
        text = ''
      },
      ontext(chunk) {
        text += chunk
      },
      onclosetag(rawName) {
        const name = rawName.toLowerCase()
        stack.pop()
        const current = summary as FeedSummary | null
        if (current) {
          const parent = stack[stack.length - 1]
          if (name === 'item' || name === 'entry') current.items++
          if (name === 'title' && !current.title && (parent === 'channel' || parent === 'feed')) {
            current.title = collapseOrNull(text)
          }
          if (FEED_DATES.has(name)) current.lastModified = newestDate(current.lastModified, text)
        }
        text = ''
      },
    },
    { xmlMode: true, decodeEntities: true },
  )
  parser.write(content)
  parser.end()
  return summary
}

const FEED_DATES = new Set(['pubdate', 'lastbuilddate', 'updated', 'published', 'dc:date'])

const MAX_OPENSEARCH_TEMPLATES = 10

/** What an OpenSearch description says of itself. `null` if the document is not one. */
export function parseOpenSearch(content: string): OpenSearchSummary | null {
  let summary: OpenSearchSummary | null = null
  let depth = 0
  let text = ''
  const parser = new Parser(
    {
      onopentag(rawName, attributes) {
        const name = rawName.toLowerCase()
        if (depth === 0 && name.endsWith('opensearchdescription')) {
          summary = { shortName: null, description: null, templates: [] }
        }
        depth++
        text = ''
        const current = summary as OpenSearchSummary | null
        if (
          current &&
          name.endsWith('url') &&
          attributes.template &&
          current.templates.length < MAX_OPENSEARCH_TEMPLATES
        ) {
          current.templates.push(attributes.template)
        }
      },
      ontext(chunk) {
        text += chunk
      },
      onclosetag(rawName) {
        const name = rawName.toLowerCase()
        depth--
        const current = summary as OpenSearchSummary | null
        if (current && name.endsWith('shortname')) current.shortName = collapseOrNull(text)
        if (current && name.endsWith('description') && depth === 1) {
          current.description = collapseOrNull(text)
        }
        text = ''
      },
    },
    { xmlMode: true, decodeEntities: true },
  )
  parser.write(content)
  parser.end()
  return summary
}
