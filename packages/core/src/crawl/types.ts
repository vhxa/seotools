export const CRAWL_TYPES = ['full', 'priority'] as const
export type CrawlType = (typeof CRAWL_TYPES)[number]

export const CRAWL_STATUSES = [
  'pending',
  'running',
  /** Every URL found was requested. */
  'completed',
  /** Stopped at the domain's URL limit: there are URLs it never requested. */
  'incomplete',
  'failed',
  'cancelled',
] as const
export type CrawlStatus = (typeof CRAWL_STATUSES)[number]

export const CRAWL_TRIGGERS = ['manual', 'schedule'] as const
export type CrawlTrigger = (typeof CRAWL_TRIGGERS)[number]

/**
 * `internal` URLs get crawled. `external` ones are only recorded, except that a full crawl checks
 * once whether those that anchors link to still answer.
 */
export type CrawlUrlScope = 'internal' | 'external'
export type CrawlUrlState = 'queued' | 'done' | 'skipped'

/**
 * What a URL turned out to be. Only `page` counts towards the domain's pages.
 * - `page`: answered with HTML (whatever the status code, except a redirect).
 * - `redirect`: answered with a 3xx.
 * - `resource`: anything else that answered: images, CSS, PDFs, robots.txt, sitemaps…
 * - `unknown`: not requested yet, never answered, or external.
 */
export type CrawlUrlKind = 'page' | 'redirect' | 'resource' | 'unknown'

/**
 * How a URL entered the crawl. `robots`, `sitemap-file` and the rest of the crawl files
 * (`crawlFileKindOf`) are never counted as pages.
 */
export const CRAWL_URL_SOURCES = [
  'seed',
  'link',
  'redirect',
  'sitemap',
  'sitemap-file',
  'robots',
  'priority',
  'llms',
  'llms-full',
  'ads',
  'app-ads',
  'security',
  'humans',
  'feed',
  'opensearch',
  'indexnow',
] as const
export type CrawlUrlSource = (typeof CRAWL_URL_SOURCES)[number]

/** Where in a page a link was found. */
export const CRAWL_LINK_KINDS = [
  'anchor',
  /** An anchor marked `rel="nofollow"`. Followed all the same: this is audit data. */
  'anchor-nofollow',
  'canonical',
  'hreflang',
  'head-link',
  'script',
  'style',
  'image',
  'media',
  'frame',
  'form',
  'meta',
  'structured-data',
  'http-header',
  'redirect',
  'sitemap',
  'llms',
  'other',
] as const
export type CrawlLinkKind = (typeof CRAWL_LINK_KINDS)[number]

/**
 * The part of a page a link sits in, from the landmark around it: `<nav>`, `<header>`, `<footer>`,
 * `<main>`, `<aside>` or the ARIA role that means the same. Absent: none of them.
 */
export const LINK_REGIONS = ['nav', 'header', 'footer', 'main', 'aside'] as const
export type LinkRegion = (typeof LINK_REGIONS)[number]

/** Longest anchor text, element description and snippet kept for a link. */
export const LINK_CONTEXT_LIMITS = { text: 100, element: 80, snippet: 300 } as const

/**
 * Where a link was found in the page that has it, so that someone can find it in the HTML: what
 * the crawl read, bounded, never made up. Only the first occurrence of a link of a kind is kept.
 * - `text`: the anchor text (with the `alt` of images inside it), for anchors.
 * - `element`: the element that holds it, e.g. `a.dropdown-item[role=menuitem]`.
 * - `region`: the landmark it sits in.
 * - `snippet`: the opening tag as read, only where the link brings in query parameters the page
 *   itself does not have (where those parameters enter the site).
 */
export interface LinkContext {
  text?: string
  element?: string
  region?: LinkRegion
  snippet?: string
}

/** Where a hreflang was declared. */
export const HREFLANG_SOURCES = ['html', 'header', 'sitemap'] as const
export type HreflangSource = (typeof HREFLANG_SOURCES)[number]

export interface HreflangEntry {
  lang: string
  url: string
  source: HreflangSource
  /** In the body, where search engines ignore it. Only ever set for `html`. */
  outsideHead?: boolean
}

export interface DeclaredCanonical {
  /** `null`: what it holds is not a URL. */
  url: string | null
  /** As the site wrote it. */
  raw: string
  inHead: boolean
  /** Where it was declared. Absent in pages parsed before it was recorded. */
  source?: 'html' | 'header'
}

/**
 * Bounds on what a page's evidence keeps, since all of it is text a site wrote: each list holds at
 * most this many samples (the counters in `CrawlPageFacts` keep counting), and each piece of text
 * at most this many characters.
 */
export const MAX_EVIDENCE_ITEMS = 10
export const MAX_EVIDENCE_TEXT = 200
/** A URL longer than this is kept as text only, never as something to link to. */
export const MAX_EVIDENCE_URL = 2048

/** What is wrong with an `<img>` that evidence is kept for. */
export const IMAGE_PROBLEMS = ['no-alt', 'empty-alt', 'long-alt', 'no-size'] as const
export type ImageProblem = (typeof IMAGE_PROBLEMS)[number]

/** What is wrong with a link that evidence is kept for. */
export const LINK_PROBLEMS = [
  'localhost',
  'uncrawlable',
  'mixed-content',
  'protocol-relative',
  'insecure-form',
  'unsafe-blank',
  'empty-anchor',
  'vague-anchor',
] as const
export type LinkProblem = (typeof LINK_PROBLEMS)[number]

/** An `<img>` with a problem, as the page wrote it. */
export interface ImageEvidence {
  /** What it points at, as written (`data:` sources keep only their type). */
  src: string
  /** `src` as a URL the crawler could request. `null`: inline, empty or too long. */
  url: string | null
  /** Identify the element in the page's HTML. */
  id?: string
  class?: string
  /** Only kept when the alt text is the problem (too long). */
  alt?: string
}

/** A link with a problem. */
export interface LinkEvidence {
  /** What holds it: an anchor, the source of an image or script, a form action… */
  kind: CrawlLinkKind | 'form'
  /** Where it points, resolved. `null`: it points nowhere a request could go (`javascript:`). */
  url: string | null
  /** The attribute value as written, when that says more than `url` does. */
  raw?: string
  /** What the link says, for those the problem is about. */
  text?: string
  /** Why it cannot be crawled. Only for `uncrawlable`. */
  reason?: 'javascript-url' | 'scripted'
}

/**
 * Samples of what is wrong on a page, kept next to the counters of `CrawlPageFacts`: the counter
 * has the total, and this the first few. Only the problems the page has appear.
 */
export interface PageEvidenceFacts {
  images?: Partial<Record<ImageProblem, ImageEvidence[]>>
  links?: Partial<Record<LinkProblem, LinkEvidence[]>>
}

/** What the checks for issues look at, gathered while parsing a page. Counts unless it says not. */
export interface CrawlPageFacts {
  /** `<head>` and `<body>` tags actually written in the document. */
  heads: number
  bodies: number
  /** Something comes before the `<head>` tag. */
  headNotFirst: boolean
  /** Names of the elements in the head that do not belong there. */
  invalidHeadElements: string[]
  titles: number
  titlesOutsideHead: number
  descriptions: number
  descriptionsOutsideHead: number
  robotsOutsideHead: number
  canonicals: DeclaredCanonical[]
  /** Where `<meta http-equiv="refresh">` or the `Refresh` header send the page. */
  refresh: string | null
  h1s: number
  h2s: number
  emptyHeadings: number
  longHeadings: number
  /** A heading jumps more than one level down from the one before it. */
  headingLevelSkipped: boolean
  words: number
  /** Fingerprint of the text, to find exact copies. `null`: too little text to compare. */
  textHash: string | null
  /** Simhash of the text, to find near copies. `null`: too little text to compare. */
  textSimhash: string | null
  placeholderText: boolean
  /** Reads like a "not found" page, whatever the status code said. */
  notFoundText: boolean
  /** Says so in its title or main heading, which is stronger evidence than the text. */
  notFoundHeadline: boolean
  imagesNoAlt: number
  imagesEmptyAlt: number
  imagesNoSize: number
  imagesLongAlt: number
  jsonLdInvalid: number
  /** JSON-LD blocks and elements with microdata or RDFa. */
  structuredData: number
  localhostLinks: number
  uncrawlableLinks: number
  emptyAnchors: number
  vagueAnchors: number
  insecureForms: number
  unsafeBlankLinks: number
  protocolRelative: number
  mixedContent: number
  /** Names of the security headers the response did not have. */
  missingSecurityHeaders: string[]
  /**
   * Samples of the images and links the counters above count. Pages parsed before they were kept
   * do not have it: their findings have no examples to show, and none are made up.
   */
  evidence?: PageEvidenceFacts
}

/** A declared canonical, as shown with the finding it is the evidence of. */
export interface CanonicalEvidence {
  raw: string
  url: string | null
  inHead: boolean
  /** `null`: the crawl does not say where it was declared. */
  source: 'html' | 'header' | null
}

/**
 * What an issue found on a URL says to back it, kept with the finding (`ISSUE_EVIDENCE` says which
 * issues have it). Every list is bounded: `total` is how many there are, `items` the first few.
 * - `images`, `links`: the elements of the page, from what the crawl gathered (`PageEvidenceFacts`).
 * - `canonicals`: the declarations that make the finding.
 * - `related-urls`: the other pages of the crawl that share what makes this one a duplicate.
 */
export type IssueEvidence =
  | { kind: 'images'; total: number; items: ImageEvidence[] }
  | { kind: 'links'; total: number; items: LinkEvidence[] }
  | { kind: 'canonicals'; total: number; items: CanonicalEvidence[] }
  | {
      kind: 'related-urls'
      /** Other pages. A lower bound when `atLeast` is set: the search for them is capped. */
      total: number
      atLeast?: true
      urls: string[]
    }

/** Data extracted from a page that has no column of its own. */
export interface CrawlPageData {
  notRequested?: 'excluded' | 'depth'
  description?: string
  h1?: string[]
  hreflang?: HreflangEntry[]
  /** Directives aimed at one bot, e.g. `<meta name="googlebot">`, by lowercase bot name. */
  botRobots?: Record<string, string>
  /** Set when the body was larger than the crawler reads: links past that point were not seen. */
  truncated?: boolean
  /** Only pages parsed since these checks exist have them. */
  facts?: CrawlPageFacts
  /**
   * On a sitemap: what it holds, to compare with the limits of the protocol. `references` counts the
   * alternates, images and videos it names without listing them, and is only there when the crawl
   * kept the origin of each URL it found in the file: the links of a sitemap parsed before that are
   * all of the `sitemap` type, whether the URL was listed or only referenced.
   */
  sitemapSize?: { entries: number; bytes: number; references?: number }
}

/** robots.txt as served to the crawler, per origin. It is audit data: nothing is skipped for it. */
export type CrawlRobotsFiles = Record<string, { status: number | null; body: string | null }>
