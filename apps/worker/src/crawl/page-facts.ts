import { crawlUrlHash, type CrawlPageFacts, type DeclaredCanonical } from '@seotools/core'
import type { ExtractedLink } from './extract'
import { simhash } from './fingerprint'

/** What may be in a `<head>`. Anything else makes a browser end the head right there. */
const HEAD_ELEMENTS = new Set([
  'title',
  'meta',
  'link',
  'base',
  'style',
  'script',
  'noscript',
  'template',
])
/** What `<noscript>` may hold in a head. */
const HEAD_NOSCRIPT_ELEMENTS = new Set(['link', 'meta', 'style'])

/** Where the text is not the content of the page: code, or what every page repeats. */
const NOT_CONTENT = new Set([
  'head',
  'title',
  'script',
  'style',
  'noscript',
  'template',
  'textarea',
  'select',
  'svg',
  'nav',
  'header',
  'footer',
  'aside',
])

/** Link kinds that load a resource into the page, which is what mixed content is about. */
const RESOURCE_LINK_KINDS = new Set(['script', 'style', 'image', 'media', 'frame', 'head-link'])

const HEADING = /^h([1-6])$/
const MAX_INVALID_HEAD_ELEMENTS = 10
const MAX_TAG_NAME = 50
const MAX_CANONICALS = 10
const MAX_CANONICAL_LENGTH = 2048
/** More than any link text worth judging, and it bounds what is done with what a site wrote. */
const MAX_ANCHOR_TEXT = 200
/** Past this, a page adds nothing to the word count or the fingerprints that matters. */
const MAX_TEXT_CHARACTERS = 2_000_000
const LONG_HEADING = 70
const LONG_ALT = 100
/** Less text than this is too little to call two pages copies of each other. */
const MIN_WORDS_TO_COMPARE = 20
const MIN_WORDS_FOR_SIMHASH = 50
/** A real page can mention these words. One that says little else is a "not found" page. */
const NOT_FOUND_MAX_WORDS = 300

const NOT_FOUND_PHRASES = [
  'not found',
  "doesn't exist",
  'does not exist',
  'no longer available',
  'no encontrada',
  'no encontrado',
  'no existe',
  'no se ha encontrado',
  'no se encontró',
  'non trouvée',
  'introuvable',
  'nicht gefunden',
  'non trovata',
  'não encontrada',
]

/** Link text that says nothing about the target. */
const VAGUE_ANCHORS = new Set([
  'click here',
  'click',
  'here',
  'this',
  'this page',
  'this link',
  'link',
  'more',
  'read more',
  'learn more',
  'see more',
  'view more',
  'more info',
  'continue',
  'continue reading',
  'details',
  'aquí',
  'aqui',
  'haz clic aquí',
  'haz click aquí',
  'pincha aquí',
  'clic aquí',
  'click aquí',
  'este enlace',
  'enlace',
  'más',
  'mas',
  'leer más',
  'leer mas',
  'ver más',
  'ver mas',
  'saber más',
  'saber mas',
  'más información',
  'mas información',
  'seguir leyendo',
  'continuar',
  'detalles',
])

/** Whether a response leaves out the headers that a server should send for every page. */
export function missingSecurityHeaders(headers: Record<string, string>, https: boolean): string[] {
  const missing: string[] = []
  if (https && !headers['strict-transport-security']) missing.push('Strict-Transport-Security')
  const csp = headers['content-security-policy']
  if (!csp) missing.push('Content-Security-Policy')
  if (!headers['x-content-type-options']) missing.push('X-Content-Type-Options')
  // `frame-ancestors` does the same job.
  if (!headers['x-frame-options'] && !csp?.toLowerCase().includes('frame-ancestors')) {
    missing.push('X-Frame-Options')
  }
  if (!headers['referrer-policy']) missing.push('Referrer-Policy')
  return missing
}

function isLocalhost(url: string): boolean {
  const { hostname } = new URL(url)
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  )
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Lowercase, without the punctuation around it: `Read more »` is `read more`. */
const anchorKey = (text: string) =>
  collapse(text)
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

function readsLikeNotFound(title: string | null, h1: string | null, text: string): boolean {
  const headline = `${title ?? ''} ${h1 ?? ''}`.toLowerCase()
  if (/\b404\b/.test(headline)) return true
  const body = text.toLowerCase()
  return NOT_FOUND_PHRASES.some((phrase) => headline.includes(phrase) || body.includes(phrase))
}

/**
 * Gathers what the checks for issues need while the HTML parser goes through a page. Nothing here
 * decides what is wrong: it only counts what is there, so that changing a check does not mean
 * crawling again. It follows what a browser does with a head and only looks at tags actually
 * written, since the parser does not add the ones a browser would imply.
 */
export class PageFactsCollector {
  /** `before`: nothing has ended the head yet, whether or not a `<head>` tag opened it. */
  private headState: 'before' | 'in' | 'after' = 'before'
  private firstElement: string | null = null
  private notContentDepth = 0
  private codeDepth = 0
  private svgDepth = 0
  private noscriptDepth = 0
  private templateDepth = 0
  private previousHeading = 1
  private heading: { text: string; level: number } | null = null
  private headingDepth = 0
  private anchor: { text: string; named: boolean } | null = null
  private anchorDepth = 0
  private jsonLd: string | null = null
  private textLength = 0
  private readonly text: string[] = []
  private readonly invalidHead = new Set<string>()

  readonly facts: CrawlPageFacts = {
    heads: 0,
    bodies: 0,
    headNotFirst: false,
    invalidHeadElements: [],
    titles: 0,
    titlesOutsideHead: 0,
    descriptions: 0,
    descriptionsOutsideHead: 0,
    robotsOutsideHead: 0,
    canonicals: [],
    refresh: null,
    h1s: 0,
    h2s: 0,
    emptyHeadings: 0,
    longHeadings: 0,
    headingLevelSkipped: false,
    words: 0,
    textHash: null,
    textSimhash: null,
    placeholderText: false,
    notFoundText: false,
    imagesNoAlt: 0,
    imagesEmptyAlt: 0,
    imagesNoSize: 0,
    imagesLongAlt: 0,
    jsonLdInvalid: 0,
    structuredData: 0,
    localhostLinks: 0,
    uncrawlableLinks: 0,
    emptyAnchors: 0,
    vagueAnchors: 0,
    insecureForms: 0,
    unsafeBlankLinks: 0,
    protocolRelative: 0,
    mixedContent: 0,
    missingSecurityHeaders: [],
  }

  constructor(
    private readonly pageUrl: string,
    /** Resolves against the page and its `<base>`. */
    private readonly resolve: (raw: string) => string | null,
  ) {}

  /** Whether what is being parsed now is in the head, written with a `<head>` tag or not. */
  get inHead() {
    return this.headState !== 'after'
  }

  open(name: string, attributes: Record<string, string>) {
    this.trackHead(name)
    if (NOT_CONTENT.has(name)) this.notContentDepth++
    if (name === 'script' || name === 'style') this.codeDepth++
    if (name === 'svg') this.svgDepth++
    if (attributes.itemscope !== undefined || attributes.typeof !== undefined) {
      this.facts.structuredData++
    }

    switch (name) {
      case 'title':
        if (this.svgDepth === 0) this.count('titles', 'titlesOutsideHead')
        break
      case 'meta':
        this.onMeta(attributes)
        break
      case 'link':
        this.onLink(attributes)
        break
      case 'img':
        this.onImage(attributes)
        break
      case 'a':
      case 'area':
        this.onAnchor(name, attributes)
        break
      case 'form':
        this.onForm(attributes)
        break
      case 'script':
        if ((attributes.type ?? '').toLowerCase() === 'application/ld+json') {
          this.facts.structuredData++
          this.jsonLd = ''
        }
        break
    }

    const level = HEADING.exec(name)?.[1]
    if (level) {
      if (this.headingDepth === 0) this.heading = { text: '', level: Number(level) }
      this.headingDepth++
    }
  }

  onText(chunk: string) {
    if (this.jsonLd !== null) this.jsonLd += chunk
    if (this.codeDepth > 0) return
    if (this.heading) this.heading.text += chunk
    if (this.anchor && this.anchor.text.length < MAX_ANCHOR_TEXT) this.anchor.text += chunk
    if (this.notContentDepth === 0 && this.textLength < MAX_TEXT_CHARACTERS) {
      this.text.push(chunk)
      this.textLength += chunk.length
    }
  }

  close(name: string) {
    if (NOT_CONTENT.has(name) && this.notContentDepth > 0) this.notContentDepth--
    if ((name === 'script' || name === 'style') && this.codeDepth > 0) this.codeDepth--
    if (name === 'svg' && this.svgDepth > 0) this.svgDepth--
    if (name === 'noscript' && this.noscriptDepth > 0) this.noscriptDepth--
    if (name === 'template' && this.templateDepth > 0) this.templateDepth--
    if (name === 'head' && this.headState === 'in') this.headState = 'after'

    if (name === 'script' && this.jsonLd !== null) {
      try {
        JSON.parse(this.jsonLd)
      } catch {
        this.facts.jsonLdInvalid++
      }
      this.jsonLd = null
    }
    if (HEADING.test(name) && this.headingDepth > 0 && --this.headingDepth === 0) this.endHeading()
    if ((name === 'a' || name === 'area') && this.anchorDepth > 0 && --this.anchorDepth === 0) {
      this.endAnchor()
    }
  }

  /** Whatever the document holds, once it has all been parsed. */
  finish(page: { title: string | null; h1: string | null; links: ExtractedLink[] }) {
    const { facts } = this
    facts.invalidHeadElements = [...this.invalidHead].slice(0, MAX_INVALID_HEAD_ELEMENTS)
    facts.headNotFirst = facts.heads > 0 && this.firstElement !== 'head'

    const text = collapse(this.text.join(' '))
    const words = text.split(' ').filter((word) => /[\p{L}\p{N}]/u.test(word))
    const normalized = words.join(' ').toLowerCase()
    facts.words = words.length
    facts.placeholderText = normalized.includes('lorem ipsum')
    if (words.length >= MIN_WORDS_TO_COMPARE) facts.textHash = crawlUrlHash(normalized)
    if (words.length >= MIN_WORDS_FOR_SIMHASH) facts.textSimhash = simhash(words)
    facts.notFoundText =
      words.length <= NOT_FOUND_MAX_WORDS && readsLikeNotFound(page.title, page.h1, normalized)

    const https = this.pageUrl.startsWith('https:')
    for (const { url, kind } of page.links) {
      if (isLocalhost(url)) facts.localhostLinks++
      if (https && url.startsWith('http:') && RESOURCE_LINK_KINDS.has(kind)) facts.mixedContent++
    }
    return facts
  }

  /** A URL in an attribute, before it gets resolved. */
  sawUrl(raw: string, kind: ExtractedLink['kind']) {
    if (raw.trim().startsWith('//') && RESOURCE_LINK_KINDS.has(kind)) this.facts.protocolRelative++
  }

  private count(total: 'titles' | 'descriptions', outside: keyof CrawlPageFacts) {
    this.facts[total]++
    if (!this.inHead) (this.facts[outside] as number)++
  }

  private trackHead(name: string) {
    if (name !== 'html' && this.firstElement === null) this.firstElement = name
    const inTemplate = this.templateDepth > 0
    if (name === 'template') this.templateDepth++
    if (name === 'head') {
      this.facts.heads++
      if (this.headState === 'before') this.headState = 'in'
      return
    }
    if (name === 'body') {
      this.facts.bodies++
      this.headState = 'after'
      return
    }
    if (name === 'html' || this.headState === 'after' || inTemplate) return
    if (this.noscriptDepth > 0) {
      // A browser that runs scripts reads this as text: it does not end the head, but search
      // engines that do not run them will see the element all the same.
      if (!HEAD_NOSCRIPT_ELEMENTS.has(name)) {
        this.invalidHead.add(`noscript > ${name.slice(0, MAX_TAG_NAME)}`)
      }
      return
    }
    if (name === 'noscript') this.noscriptDepth++
    if (HEAD_ELEMENTS.has(name)) return
    // With no `<head>` tag, the first element of the body is what ends the head, and it is valid.
    if (this.headState === 'in') this.invalidHead.add(name.slice(0, MAX_TAG_NAME))
    this.headState = 'after'
  }

  private onMeta(attributes: Record<string, string>) {
    const name = (attributes.name ?? '').toLowerCase()
    if (name === 'description') this.count('descriptions', 'descriptionsOutsideHead')
    if ((name === 'robots' || name.endsWith('bot')) && !this.inHead) {
      this.facts.robotsOutsideHead++
    }
  }

  private onLink(attributes: Record<string, string>) {
    const rel = (attributes.rel ?? '').toLowerCase().split(/\s+/)
    const raw = attributes.href
    if (!rel.includes('canonical') || raw === undefined) return
    if (this.facts.canonicals.length >= MAX_CANONICALS) return
    this.facts.canonicals.push({
      url: this.resolve(raw),
      raw: raw.slice(0, MAX_CANONICAL_LENGTH),
      inHead: this.inHead,
    })
  }

  private onImage(attributes: Record<string, string>) {
    const { alt, width, height } = attributes
    if (alt === undefined) this.facts.imagesNoAlt++
    else if (alt.trim() === '') this.facts.imagesEmptyAlt++
    else if (alt.length > LONG_ALT) this.facts.imagesLongAlt++
    if (width === undefined || height === undefined) this.facts.imagesNoSize++
    // An image is what a link or heading around it says.
    if (alt) {
      if (this.anchor && this.anchor.text.length < MAX_ANCHOR_TEXT) this.anchor.text += ` ${alt}`
      if (this.heading) this.heading.text += ` ${alt}`
    }
  }

  private onAnchor(name: string, attributes: Record<string, string>) {
    const href = attributes.href?.trim()
    const scripted = attributes.onclick !== undefined || attributes['ng-click'] !== undefined
    const routed = attributes.routerlink !== undefined || attributes['data-href'] !== undefined
    const asLink = attributes.role === 'link'
    if (href === undefined || href === '' || href === '#') {
      if (scripted || routed || asLink) this.facts.uncrawlableLinks++
      return
    }
    if (/^javascript:/i.test(href)) {
      this.facts.uncrawlableLinks++
      return
    }
    const url = this.resolve(href)
    if (!url) return
    if (this.anchorDepth === 0) {
      const named = Boolean(attributes['aria-label']?.trim() || attributes.title?.trim())
      this.anchor = { text: name === 'area' ? (attributes.alt ?? '') : '', named }
    }
    this.anchorDepth++
    if ((attributes.target ?? '').toLowerCase() === '_blank') {
      const rel = (attributes.rel ?? '').toLowerCase().split(/\s+/)
      const sameOrigin = new URL(url).origin === new URL(this.pageUrl).origin
      if (!sameOrigin && !rel.includes('noopener') && !rel.includes('noreferrer')) {
        this.facts.unsafeBlankLinks++
      }
    }
  }

  private onForm(attributes: Record<string, string>) {
    const action = attributes.action?.trim() ? this.resolve(attributes.action) : this.pageUrl
    if (action?.startsWith('http:')) this.facts.insecureForms++
  }

  private endHeading() {
    const heading = this.heading
    this.heading = null
    if (!heading) return
    if (heading.level === 1) this.facts.h1s++
    if (heading.level === 2) this.facts.h2s++
    const text = collapse(heading.text)
    if (text === '') this.facts.emptyHeadings++
    if (text.length > LONG_HEADING) this.facts.longHeadings++
    if (heading.level > this.previousHeading + 1) this.facts.headingLevelSkipped = true
    this.previousHeading = heading.level
  }

  private endAnchor() {
    const anchor = this.anchor
    this.anchor = null
    if (!anchor) return
    const key = anchorKey(anchor.text.slice(0, MAX_ANCHOR_TEXT))
    if (key === '' && !anchor.named) this.facts.emptyAnchors++
    if (VAGUE_ANCHORS.has(key)) this.facts.vagueAnchors++
  }
}

/** Adds to a page what its response declared, which is only known outside the HTML. */
export function withResponseFacts(
  facts: CrawlPageFacts,
  response: { canonical: DeclaredCanonical | null; refresh: string | null; missing: string[] },
): CrawlPageFacts {
  return {
    ...facts,
    canonicals: response.canonical ? [...facts.canonicals, response.canonical] : facts.canonicals,
    refresh: facts.refresh ?? response.refresh,
    missingSecurityHeaders: response.missing,
  }
}
