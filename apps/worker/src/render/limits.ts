import { MAX_BODY_BYTES } from '../crawl/fetcher'

export const RENDER_LIMITS = {
  requests: 300,
  urlChars: 2048,
  connectionMs: 10_000,
  protocolMs: 35_000,
  pageBytes: 30 * 1024 * 1024,
  resourceBytes: 5 * 1024 * 1024,
  requestBodyBytes: 1024 * 1024,
  domBytes: MAX_BODY_BYTES,
  cacheBytes: 64 * 1024 * 1024,
  diagnosticItems: 50,
  scriptErrors: 5,
  messageChars: 200,
  quietMs: 500,
  waitMs: 5000,
  maxWaitMs: 30_000,
  loadGraceMs: 25_000,
  probeTimeoutMs: 2000,
  checkIntervalMs: 5 * 60_000,
} as const

export const oneLine = (value: string) =>
  value.replace(/[\r\n\t]+/g, ' ').slice(0, RENDER_LIMITS.messageChars)

/** Keep a deterministic sample, including when requests complete in a different order. */
export function addSample<T>(list: T[], item: T, key: (value: T) => string) {
  list.push(item)
  list.sort((a, b) => key(a).localeCompare(key(b), 'en'))
  if (list.length > RENDER_LIMITS.diagnosticItems) list.pop()
}
