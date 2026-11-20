import { defaultCrawlerUserAgent, type CrawlSettings } from './settings'

/** Discovery and request settings captured when a crawl is queued. No request credentials. */
export interface CrawlDiscoverySettings {
  includePrefixes: string[]
  excludePrefixes: string[]
  maxDepth: number | null
  maxUrls: number | null
  userAgent: string | null
  requestCredentialsSet: boolean
  optionalFiles: CrawlSettings['optionalFiles']
  /** Public verification filename (without .txt). */
  indexNowKey: string | null
  concurrency: number
  requestsPerSecond: number
  timeoutMs: number
  maxRetries: number
}

export function snapshotCrawlDiscovery(
  settings: CrawlSettings,
  requestCredentialsSet: boolean,
  version?: string,
): CrawlDiscoverySettings {
  return {
    includePrefixes: settings.includePrefixes,
    excludePrefixes: settings.excludePrefixes,
    maxDepth: settings.maxDepth,
    maxUrls: settings.maxUrls,
    userAgent: settings.userAgent ?? (version ? defaultCrawlerUserAgent(version) : null),
    requestCredentialsSet,
    optionalFiles: settings.optionalFiles,
    indexNowKey: settings.indexNowKey,
    concurrency: settings.concurrency,
    requestsPerSecond: settings.requestsPerSecond,
    timeoutMs: settings.timeoutMs,
    maxRetries: settings.maxRetries,
  }
}

export interface CrawlDiscoveryInput {
  discoverySettings: CrawlDiscoverySettings | null
  rendering: { mode: 'html' | 'rendered'; waitMs: number; omittedHosts?: string[] } | null
  ignoredParameters?: string[]
}

const discoveryKeys = [
  'includePrefixes',
  'excludePrefixes',
  'maxDepth',
  'maxUrls',
  'userAgent',
  'requestCredentialsSet',
  'optionalFiles',
  'indexNowKey',
  'concurrency',
  'requestsPerSecond',
  'timeoutMs',
  'maxRetries',
] as const satisfies readonly (keyof CrawlDiscoverySettings)[]

type Assert<T extends true> = T
export type CrawlDiscoveryKeysCovered = Assert<
  Exclude<keyof CrawlDiscoverySettings, (typeof discoveryKeys)[number]> extends never ? true : false
>

export type CrawlDiscoveryDifference = {
  setting:
    | (typeof discoveryKeys)[number]
    | 'renderingMode'
    | 'renderWaitMs'
    | 'renderOmittedHosts'
    | 'ignoredParameters'
  status: 'different' | 'unknown'
}

/**
 * Reports changed and unknown fields, in stable order. A field absent on either side is unknown.
 * Empty lists and explicit null limits are known values. Lists are compared as sets.
 */
export function compareCrawlDiscovery(
  from: CrawlDiscoveryInput,
  to: CrawlDiscoveryInput,
): CrawlDiscoveryDifference[] {
  const differences: CrawlDiscoveryDifference[] = []
  function compare(
    setting: CrawlDiscoveryDifference['setting'],
    before: string | number | boolean | null | string[] | undefined,
    after: typeof before,
  ) {
    if (before === undefined || after === undefined) {
      differences.push({ setting, status: 'unknown' })
    } else if (Array.isArray(before) && Array.isArray(after)) {
      const left = new Set(before)
      const right = new Set(after)
      if (left.size !== right.size || [...left].some((item) => !right.has(item))) {
        differences.push({ setting, status: 'different' })
      }
    } else if (before !== after) {
      differences.push({ setting, status: 'different' })
    }
  }
  compare('renderingMode', from.rendering?.mode, to.rendering?.mode)
  compare('renderWaitMs', from.rendering?.waitMs, to.rendering?.waitMs)
  compare('renderOmittedHosts', from.rendering?.omittedHosts, to.rendering?.omittedHosts)
  compare('ignoredParameters', from.ignoredParameters, to.ignoredParameters)
  for (const key of discoveryKeys)
    compare(key, from.discoverySettings?.[key], to.discoverySettings?.[key])
  return differences
}
