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
}

/** Data extracted from a page that has no column of its own. */
export interface CrawlPageData {
  description?: string
  h1?: string[]
  hreflang?: HreflangEntry[]
  /** Directives aimed at one bot, e.g. `<meta name="googlebot">`, by lowercase bot name. */
  botRobots?: Record<string, string>
  /** Set when the body was larger than the crawler reads: links past that point were not seen. */
  truncated?: boolean
  /** Only pages parsed since these checks exist have them. */
  facts?: CrawlPageFacts
  /** On a sitemap: what it holds, to compare with the limits of the protocol. */
  sitemapSize?: { entries: number; bytes: number }
}

/** robots.txt as served to the crawler, per origin. It is audit data: nothing is skipped for it. */
export type CrawlRobotsFiles = Record<string, { status: number | null; body: string | null }>
