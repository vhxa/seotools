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

/** `internal` URLs get requested; `external` ones are only recorded, never fetched. */
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

/** How a URL entered the crawl. `robots` and `sitemap-file` are never counted as pages. */
export const CRAWL_URL_SOURCES = [
  'seed',
  'link',
  'redirect',
  'sitemap',
  'sitemap-file',
  'robots',
  'priority',
] as const
export type CrawlUrlSource = (typeof CRAWL_URL_SOURCES)[number]

/** Where in a page a link was found. */
export const CRAWL_LINK_KINDS = [
  'anchor',
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
  'other',
] as const
export type CrawlLinkKind = (typeof CRAWL_LINK_KINDS)[number]

/** Data extracted from a page that has no column of its own. */
export interface CrawlPageData {
  description?: string
  h1?: string[]
  hreflang?: { lang: string; url: string }[]
  /** Directives aimed at one bot, e.g. `<meta name="googlebot">`, by lowercase bot name. */
  botRobots?: Record<string, string>
  /** Set when the body was larger than the crawler reads: links past that point were not seen. */
  truncated?: boolean
}

/** robots.txt as served to the crawler, per origin. It is audit data: nothing is skipped for it. */
export type CrawlRobotsFiles = Record<string, { status: number | null; body: string | null }>
