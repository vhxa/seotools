import { z } from '../zod'
import { extractorsSchema, type Extractor } from './extraction'
import { parseAuditSelector } from './audit'
import { INDEXNOW_KEY, OPTIONAL_CRAWL_FILES, type OptionalCrawlFile } from './files'

/** Stored mode values: served HTML or HTML followed by JavaScript rendering. */
export const CRAWL_RENDERING_MODES = ['http', 'headless'] as const
export type CrawlRenderingMode = (typeof CRAWL_RENDERING_MODES)[number]
export const CRAWL_RENDERING_AVAILABLE: readonly CrawlRenderingMode[] = CRAWL_RENDERING_MODES

export interface CrawlSettings {
  collectVitals: boolean
  includePrefixes: string[]
  excludePrefixes: string[]
  ignoredParameters: string[]
  maxDepth: number | null
  renderWaitMs: number
  renderOmittedHosts: string[]
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
  /** Values read from every page with a CSS selector (`@seotools/core/crawl/extraction`). */
  extractors: Extractor[]
  /** Crawl files that are not requested unless asked for. */
  optionalFiles: OptionalCrawlFile[]
  /** The file holding it cannot be found without knowing it. `null`: not checked. */
  indexNowKey: string | null
}

export const DEFAULT_CRAWL_SETTINGS: CrawlSettings = {
  collectVitals: true,
  includePrefixes: [],
  excludePrefixes: [],
  ignoredParameters: [],
  maxDepth: null,
  renderingMode: 'http',
  renderWaitMs: 5000,
  renderOmittedHosts: [],
  userAgent: null,
  concurrency: 2,
  requestsPerSecond: 5,
  timeoutMs: 30_000,
  maxRetries: 2,
  maxUrls: 100_000,
  // The latest crawl and the one before it, which is what a comparison needs.
  retainCrawls: 2,
  historyDays: 30,
  extractors: [],
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

export const ignoredParametersSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[^=&?#*]+\*?$/),
  )
  .max(100)
  .transform((names) => [...new Set(names)])

export const crawlSettingsSchema = z.object({
  collectVitals: z.boolean().default(true),
  includePrefixes: prefixesSchema.default([]),
  excludePrefixes: prefixesSchema.default([]),
  ignoredParameters: ignoredParametersSchema.default([]),
  maxDepth: z.number().int().min(1).max(100).nullable().default(null),
  extractors: extractorsSchema.default([]),
  renderingMode: z.enum(CRAWL_RENDERING_MODES),
  renderWaitMs: z.number().int().min(1000).max(30000).default(5000),
  renderOmittedHosts: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .max(253)
        .refine((host) =>
          host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),
        ),
    )
    .max(50)
    .default([]),
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
