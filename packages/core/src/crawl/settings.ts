import { z } from 'zod'

/**
 * How pages are fetched. Only `http` is implemented; the other two are shown disabled in the UI
 * until a headless browser ships, and `CRAWL_RENDERING_AVAILABLE` is what the server action checks.
 */
export const CRAWL_RENDERING_MODES = ['http', 'headless', 'both'] as const
export type CrawlRenderingMode = (typeof CRAWL_RENDERING_MODES)[number]
export const CRAWL_RENDERING_AVAILABLE: readonly CrawlRenderingMode[] = ['http']

export interface CrawlSettings {
  renderingMode: CrawlRenderingMode
  /** `null` uses `defaultCrawlerUserAgent`. */
  userAgent: string | null
  /** Requests in flight at once for this domain. */
  concurrency: number
  requestsPerSecond: number
  timeoutMs: number
  /** Extra attempts after a network error, 429 or 503. */
  maxRetries: number
  /** Most URLs of the site a full crawl requests. `null` means no limit. */
  maxUrls: number | null
  /** Successful crawls of each type whose per-URL results are kept. `null` keeps them all. */
  retainCrawls: number | null
}

export const DEFAULT_CRAWL_SETTINGS: CrawlSettings = {
  renderingMode: 'http',
  userAgent: null,
  concurrency: 2,
  requestsPerSecond: 5,
  timeoutMs: 30_000,
  maxRetries: 2,
  maxUrls: 100_000,
  retainCrawls: 10,
}

export const CRAWL_SETTINGS_LIMITS = {
  concurrency: { min: 1, max: 20 },
  requestsPerSecond: { min: 1, max: 100 },
  timeoutSeconds: { min: 1, max: 120 },
  maxRetries: { min: 0, max: 5 },
  maxUrls: { min: 1, max: 10_000_000 },
  retainCrawls: { min: 1, max: 1000 },
  userAgentLength: 255,
} as const

const between = ({ min, max }: { min: number; max: number }) => z.number().int().min(min).max(max)

/** What an HTTP header value may hold: printable ASCII, so no header injection. */
const USER_AGENT = /^[\x20-\x7e]+$/

export const crawlSettingsSchema = z.object({
  renderingMode: z.enum(CRAWL_RENDERING_MODES),
  userAgent: z
    .string()
    .trim()
    .max(CRAWL_SETTINGS_LIMITS.userAgentLength)
    .regex(USER_AGENT)
    .nullable(),
  concurrency: between(CRAWL_SETTINGS_LIMITS.concurrency),
  requestsPerSecond: between(CRAWL_SETTINGS_LIMITS.requestsPerSecond),
  timeoutMs: z
    .number()
    .int()
    .min(CRAWL_SETTINGS_LIMITS.timeoutSeconds.min * 1000)
    .max(CRAWL_SETTINGS_LIMITS.timeoutSeconds.max * 1000),
  maxRetries: between(CRAWL_SETTINGS_LIMITS.maxRetries),
  maxUrls: between(CRAWL_SETTINGS_LIMITS.maxUrls).nullable(),
  retainCrawls: between(CRAWL_SETTINGS_LIMITS.retainCrawls).nullable(),
})

const CRAWLER_HOMEPAGE = 'https://github.com/botaroikawa/seotools'

/** The User-Agent a domain crawls with unless its settings override it. */
export function defaultCrawlerUserAgent(version?: string): string {
  return `SeoToolsBot/${version || 'dev'} (+${CRAWLER_HOMEPAGE})`
}
