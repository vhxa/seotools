import { z } from 'zod'
import { parseAuditSelector } from './audit'
import { INDEXNOW_KEY, OPTIONAL_CRAWL_FILES, type OptionalCrawlFile } from './files'

/**
 * How pages are fetched. Only `http` is implemented; the other two are shown disabled in the UI
 * until a headless browser ships, and `CRAWL_RENDERING_AVAILABLE` is what the server action checks.
 */
export const CRAWL_RENDERING_MODES = ['http', 'headless', 'both'] as const
export type CrawlRenderingMode = (typeof CRAWL_RENDERING_MODES)[number]
export const CRAWL_RENDERING_AVAILABLE: readonly CrawlRenderingMode[] = ['http']

export interface CrawlSettings {
  includePrefixes: string[]
  excludePrefixes: string[]
  maxDepth: number | null
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
  /**
   * Days the compact history of older crawls (what each URL was, its findings) is kept once their
   * results per URL are removed. `null` keeps it always.
   */
  historyDays: number | null
  /** Crawl files that are not requested unless asked for. */
  optionalFiles: OptionalCrawlFile[]
  /** The file holding it cannot be found without knowing it. `null`: not checked. */
  indexNowKey: string | null
}

export const DEFAULT_CRAWL_SETTINGS: CrawlSettings = {
  includePrefixes: [],
  excludePrefixes: [],
  maxDepth: null,
  renderingMode: 'http',
  userAgent: null,
  concurrency: 2,
  requestsPerSecond: 5,
  timeoutMs: 30_000,
  maxRetries: 2,
  maxUrls: 100_000,
  // The latest crawl and the one before it, which is what a comparison needs.
  retainCrawls: 2,
  historyDays: 30,
  optionalFiles: [],
  indexNowKey: null,
}

export const CRAWL_SETTINGS_LIMITS = {
  concurrency: { min: 1, max: 20 },
  requestsPerSecond: { min: 1, max: 100 },
  timeoutSeconds: { min: 1, max: 120 },
  maxRetries: { min: 0, max: 5 },
  maxUrls: { min: 1, max: 10_000_000 },
  retainCrawls: { min: 1, max: 1000 },
  historyDays: { min: 1, max: 3650 },
  userAgentLength: 255,
} as const

const between = ({ min, max }: { min: number; max: number }) => z.number().int().min(min).max(max)

/** What an HTTP header value may hold: printable ASCII, so no header injection. */
const USER_AGENT = /^[\x20-\x7e]+$/

const prefixesSchema = z
  .array(z.string())
  .max(100)
  .transform((values, ctx) => {
    const paths: string[] = []
    for (const value of values) {
      const parsed = parseAuditSelector({ kind: 'prefix', value, query: 'any' }, 'example.com')
      if (!parsed.ok || parsed.selector.kind !== 'prefix') {
        ctx.addIssue({ code: 'custom', message: 'Invalid path prefix' })
        return z.NEVER
      }
      paths.push(parsed.selector.path)
    }
    return [...new Set(paths)]
  })

/** Seeds bypass scope and depth; all other URLs remain visible even when not requested. */
export function crawlSkipReason(
  url: string,
  depth: number,
  settings: Pick<CrawlSettings, 'includePrefixes' | 'excludePrefixes' | 'maxDepth'>,
): 'excluded' | 'depth' | undefined {
  const path = new URL(url).pathname
  const covers = (prefix: string) =>
    prefix === '/' || path === prefix || path.startsWith(`${prefix}/`)
  if (
    settings.excludePrefixes.some(covers) ||
    (settings.includePrefixes.length > 0 && !settings.includePrefixes.some(covers))
  )
    return 'excluded'
  if (settings.maxDepth !== null && depth > settings.maxDepth) return 'depth'
}

export const crawlSettingsSchema = z.object({
  includePrefixes: prefixesSchema.default([]),
  excludePrefixes: prefixesSchema.default([]),
  maxDepth: z.number().int().min(1).max(100).nullable().default(null),
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
  historyDays: between(CRAWL_SETTINGS_LIMITS.historyDays).nullable(),
  optionalFiles: z.array(z.enum(OPTIONAL_CRAWL_FILES)),
  indexNowKey: z.string().regex(INDEXNOW_KEY).nullable(),
})

const CRAWLER_HOMEPAGE = 'https://github.com/vhxa/seotools'

/** The User-Agent a domain crawls with unless its settings override it. */
export function defaultCrawlerUserAgent(version?: string): string {
  return `SeoToolsBot/${version || 'dev'} (+${CRAWLER_HOMEPAGE})`
}
