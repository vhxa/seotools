import type { CrawlUrlSource } from './types'

/**
 * The files a site publishes for crawlers. They are stored per domain, with what the last request
 * for each one answered, whether a crawl or a refresh made that request.
 */
export const CRAWL_FILE_KINDS = [
  'robots',
  'sitemap',
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
export type CrawlFileKind = (typeof CRAWL_FILE_KINDS)[number]

/** Files only requested when a domain asks for them, each with a switch of its own. */
export const OPTIONAL_CRAWL_FILES = [
  'ads',
  'app-ads',
  'security',
  'humans',
  'feed',
  'opensearch',
] as const
export type OptionalCrawlFile = (typeof OPTIONAL_CRAWL_FILES)[number]

/**
 * Everything a domain can turn on, which is what gets a page and a sidebar entry of its own.
 * IndexNow is on while the domain has a key, since its file is named after it.
 */
export const EXTRA_CRAWL_FILES = [...OPTIONAL_CRAWL_FILES, 'indexnow'] as const
export type ExtraCrawlFileKind = (typeof EXTRA_CRAWL_FILES)[number]

export const isExtraCrawlFile = (value: string): value is ExtraCrawlFileKind =>
  (EXTRA_CRAWL_FILES as readonly string[]).includes(value)

/** The extra files a domain has turned on, in the order of `EXTRA_CRAWL_FILES`. */
export function enabledExtraFiles(settings: {
  optionalFiles: readonly string[]
  indexNowKey: string | null
}): ExtraCrawlFileKind[] {
  return EXTRA_CRAWL_FILES.filter((kind) =>
    kind === 'indexnow' ? settings.indexNowKey !== null : settings.optionalFiles.includes(kind),
  )
}

/** The key is part of the URL of its file, so it is restricted to what the IndexNow spec allows. */
export const INDEXNOW_KEY = /^[a-zA-Z0-9-]{8,128}$/

/** What is read of a file, sitemaps aside. Enough for any real file, and for noticing an oversize one. */
export const MAX_CRAWL_FILE_READ_BYTES = 2 * 1024 * 1024
/** What is kept of a file's text. Google ignores robots.txt past 500 KiB; the rest is just a preview. */
export const MAX_CRAWL_FILE_BODY_BYTES = 512 * 1024

export interface SitemapSummary {
  /** `null`: it answered, but what it holds is not a sitemap. */
  format: 'urlset' | 'index' | 'text' | null
  /** Entries it lists: pages for a `urlset`, sitemaps for an `index`. */
  entries: number
  /** The most recent `<lastmod>`, as ISO 8601. */
  lastModified: string | null
}

export interface FeedSummary {
  format: 'rss' | 'atom' | 'rdf'
  title: string | null
  items: number
  /** The most recent date of the feed or its items, as ISO 8601. */
  lastModified: string | null
}

export interface OpenSearchSummary {
  shortName: string | null
  description: string | null
  /** The search URL templates. */
  templates: string[]
}

/** What had to be worked out when the file was fetched, because its body is not always kept. */
export interface CrawlFileData {
  sitemap?: SitemapSummary
  feed?: FeedSummary
  opensearch?: OpenSearchSummary
}

const KIND_OF_SOURCE: Partial<Record<CrawlUrlSource, CrawlFileKind>> = {
  robots: 'robots',
  'sitemap-file': 'sitemap',
  llms: 'llms',
  'llms-full': 'llms-full',
  ads: 'ads',
  'app-ads': 'app-ads',
  security: 'security',
  humans: 'humans',
  feed: 'feed',
  opensearch: 'opensearch',
  indexnow: 'indexnow',
}

/** The crawl file a URL is, going by how it entered the crawl. */
export const crawlFileKindOf = (source: CrawlUrlSource): CrawlFileKind | null =>
  KIND_OF_SOURCE[source] ?? null

/** How a URL enters a crawl as this kind of file. A `sitemap` source is a URL listed in a sitemap. */
export const crawlFileSource = (kind: CrawlFileKind): CrawlUrlSource =>
  kind === 'sitemap' ? 'sitemap-file' : kind

const PATHS: Record<Exclude<CrawlFileKind, 'robots' | 'indexnow'>, string[]> = {
  sitemap: ['/sitemap.xml', '/sitemap_index.xml'],
  llms: ['/llms.txt'],
  'llms-full': ['/llms-full.txt'],
  ads: ['/ads.txt'],
  'app-ads': ['/app-ads.txt'],
  security: ['/.well-known/security.txt', '/security.txt'],
  humans: ['/humans.txt'],
  // Sites should announce these in their pages, which is looked for as well: these are the usual.
  feed: ['/feed', '/rss.xml', '/atom.xml'],
  opensearch: ['/opensearch.xml'],
}

export interface CrawlFileRequest {
  url: string
  kind: CrawlFileKind
}

/**
 * Every URL to ask for a domain's files at. Only robots.txt is requested over plain HTTP too: its
 * rules apply per origin, while the others live wherever the site does, and that is HTTPS.
 */
export function crawlFileRequests(
  host: string,
  settings: { optionalFiles: readonly OptionalCrawlFile[]; indexNowKey: string | null },
): CrawlFileRequest[] {
  const hosts = [host, `www.${host}`]
  const requests: CrawlFileRequest[] = []
  const add = (kind: CrawlFileKind, path: string) => {
    for (const name of hosts) requests.push({ url: `https://${name}${path}`, kind })
  }
  for (const name of hosts) {
    for (const scheme of ['https', 'http']) {
      requests.push({ url: `${scheme}://${name}/robots.txt`, kind: 'robots' })
    }
  }
  for (const kind of ['sitemap', 'llms', 'llms-full', ...settings.optionalFiles] as const) {
    for (const path of PATHS[kind]) add(kind, path)
  }
  if (settings.indexNowKey) add('indexnow', `/${settings.indexNowKey}.txt`)
  return requests
}

/** Whether a sitemap was only tried because of its usual name, so a 404 there says nothing. */
export function isDefaultSitemapUrl(url: string): boolean {
  return PATHS.sitemap.includes(new URL(url).pathname)
}

/**
 * What a request for a file came to.
 * - `ok`: it is there.
 * - `invalid`: it answered 200 with something else, like the HTML a site serves for any path.
 * - `redirect`: it moved. The target has a row of its own, if it is on the site.
 * - `missing`: 404 or 410.
 * - `access-denied`: 401 or 403.
 * - `http-error`: other 4xx.
 * - `unexpected-response`: other statuses without a usable file (including 204 and 304).
 * - `server-error`: 5xx.
 * - `unreachable`: no answer at all.
 */
export type CrawlFileState =
  | 'ok'
  | 'invalid'
  | 'redirect'
  | 'missing'
  | 'access-denied'
  | 'http-error'
  | 'unexpected-response'
  | 'server-error'
  | 'unreachable'

export function crawlFileState(file: {
  kind: CrawlFileKind
  statusCode: number | null
  body: string | null
  data: CrawlFileData | null
}): CrawlFileState {
  const status = file.statusCode
  if (status === null) return 'unreachable'
  if (status >= 500) return 'server-error'
  if (status >= 300 && status < 400 && status !== 304) return 'redirect'
  if (status === 404 || status === 410) return 'missing'
  if (status === 401 || status === 403) return 'access-denied'
  if (status >= 400) return 'http-error'
  if (status !== 200) return 'unexpected-response'
  switch (file.kind) {
    case 'sitemap':
      return file.data?.sitemap?.format ? 'ok' : 'invalid'
    case 'feed':
      return file.data?.feed ? 'ok' : 'invalid'
    case 'opensearch':
      return file.data?.opensearch ? 'ok' : 'invalid'
    default:
      return file.body === null ? 'invalid' : 'ok'
  }
}
