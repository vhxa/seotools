import { normalizeCrawlUrl, type CrawlLinkKind } from '@seotools/core'
import { Parser } from 'htmlparser2'

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
  hreflang: { lang: string; url: string }[]
  links: ExtractedLink[]
}

const MAX_H1 = 10
const MAX_HREFLANG = 500

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
  const result: ExtractedHtml = {
    title: null,
    description: null,
    h1: [],
    metaRobots: null,
    botRobots: {},
    canonical: null,
    hreflang: [],
    links: [],
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
    const url = normalizeCrawlUrl(value, base)
    if (url) result.links.push({ url, kind })
  }

  const addCss = (css: string) => {
    for (const link of extractCssUrls(css, base)) result.links.push(link)
  }

  const onLink = (attributes: Record<string, string>) => {
    const rel = (attributes.rel ?? '').toLowerCase().split(/\s+/)
    const href = attributes.href
    if (rel.includes('canonical')) {
      add(href, 'canonical')
      const url = href === undefined ? null : normalizeCrawlUrl(href, base)
      if (url && !result.canonical) result.canonical = url
    } else if (rel.includes('alternate') && attributes.hreflang) {
      add(href, 'hreflang')
      const url = href === undefined ? null : normalizeCrawlUrl(href, base)
      if (url && result.hreflang.length < MAX_HREFLANG) {
        result.hreflang.push({ lang: attributes.hreflang, url })
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
      add(parseRefresh(content), 'meta')
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
        for (const [attribute, kind, list] of URL_ATTRIBUTES[name] ?? []) {
          const value = attributes[attribute]
          if (value === undefined) continue
          if (list) for (const url of parseSrcset(value)) add(url, kind)
          else add(value, kind)
        }
        if (attributes.style) addCss(attributes.style)
      },
      ontext(text) {
        if (title !== null) title += text
        if (h1 !== null) h1 += text
        if (rawText) rawText.text += text
      },
      onclosetag(rawName) {
        const name = rawName.toLowerCase()
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
              // Malformed JSON-LD is a finding for a future feature, not a crawl error.
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
  hreflang: { lang: string; url: string }[]
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
      parsed.hreflang.push({ lang: hreflang, url })
    } else {
      parsed.links.push({ url, kind: 'http-header' })
    }
  }
  return parsed
}

export interface ParsedSitemap {
  /** URLs of the site listed in the sitemap, including images, videos and hreflang alternates. */
  urls: string[]
  /** Further sitemaps, from a sitemap index. */
  sitemaps: string[]
}

const SITEMAP_ENTRY_LOCS = new Set(['image:loc', 'video:content_loc', 'video:player_loc'])

/** Parses an XML sitemap or sitemap index, or a plain-text sitemap (one URL per line). */
export function parseSitemap(content: string, base: string): ParsedSitemap {
  const parsed: ParsedSitemap = { urls: [], sitemaps: [] }
  const push = (into: string[], raw: string) => {
    const url = normalizeCrawlUrl(raw, base)
    if (url) into.push(url)
  }

  if (!content.trimStart().startsWith('<')) {
    for (const line of content.split(/\r?\n/)) {
      if (/^https?:\/\//i.test(line.trim())) push(parsed.urls, line)
    }
    return parsed
  }

  const stack: string[] = []
  let text = ''
  const parser = new Parser(
    {
      onopentag(rawName, attributes) {
        const name = rawName.toLowerCase()
        stack.push(name)
        text = ''
        if (name === 'xhtml:link' && attributes.href) push(parsed.urls, attributes.href)
      },
      ontext(chunk) {
        text += chunk
      },
      onclosetag(rawName) {
        const name = rawName.toLowerCase()
        stack.pop()
        const parent = stack[stack.length - 1]
        if (name === 'loc' && parent === 'sitemap') push(parsed.sitemaps, text)
        else if (name === 'loc' && parent === 'url') push(parsed.urls, text)
        else if (SITEMAP_ENTRY_LOCS.has(name)) push(parsed.urls, text)
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
