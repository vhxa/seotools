import { MAX_BODY_BYTES } from '../crawl/fetcher'

export const RENDER_LIMITS = {
  requests: 300,
  /** Bound interception bookkeeping independently of the subresource budget. */
  interceptions: 10_000,
  /** Subresources of one page fetched at the same time, like a browser's connections to a host. */
  pageResources: 6,
  urlChars: 2048,
  connectionMs: 10_000,
  protocolMs: 35_000,
  pageBytes: 30 * 1024 * 1024,
  resourceBytes: 5 * 1024 * 1024,
  // DOM: at most 10 MiB UTF-8, at worst 6x JSON escaping + protocol envelope < 64 MiB.
  // ws enforces this before JSON.parse or Puppeteer's eager postData decoding.
  cdpMessageBytes: 64 * 1024 * 1024,
  pageRequestBodyBytes: 5 * 1024 * 1024,
  requestBodyBytes: 1024 * 1024,
  domBytes: MAX_BODY_BYTES,
  cacheBytes: 64 * 1024 * 1024,
  diagnosticItems: 50,
  scriptErrors: 5,
  messageChars: 200,
  quietMs: 500,
  /** The capture window, from the moment the DOM is parsed: the domain's wait setting. */
  waitMs: 5000,
  maxWaitMs: 30_000,
  /** How long the DOM may take to be parsed (DOMContentLoaded). Past it, the render failed. */
  loadGraceMs: 25_000,
  probeTimeoutMs: 2000,
  checkIntervalMs: 5 * 60_000,
} as const

export const oneLine = (value: string) =>
  value.replace(/[\r\n\t]+/g, ' ').slice(0, RENDER_LIMITS.messageChars)

/** Keep a deterministic sample, including when requests complete in a different order. */
export function addSample<T>(
  list: T[],
  item: T,
  key: (value: T) => string,
  limit: number = RENDER_LIMITS.diagnosticItems,
) {
  list.push(item)
  list.sort((a, b) => key(a).localeCompare(key(b), 'en'))
  if (list.length > limit) list.pop()
}
