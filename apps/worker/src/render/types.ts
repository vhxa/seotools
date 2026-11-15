import type { RenderOmitReason } from '@seotools/core'
import type { FetchedResponse } from '../crawl/fetcher'
import type { Requester } from '../crawl/requester'
import type { RenderResourceCache } from './cache'

export interface RenderInput {
  url: string
  host: string
  ignoredParameters?: readonly string[]
  document: FetchedResponse
  userAgent: string
  requester: Requester
  cache: RenderResourceCache
  allowedByRobots: (url: string) => boolean | 'unknown'
  extraOmittedHosts?: readonly string[]
  waitMs?: number
  signal: AbortSignal
}
export interface RenderOutcome {
  status: 'rendered' | 'failed'
  failure?: { code: 'load-timeout' | 'crashed' | 'serialization' | 'navigation'; message: string }
  settled: boolean
  /** A main-frame navigation to a different crawl identity ended this observation. */
  redirected: boolean
  finalUrl: string
  html: string
  truncated: boolean
  durationMs: number
  requests: {
    made: number
    cached: number
    failedCount: number
    omittedCount: number
    blockedByRobotsCount: number
    refusedCount: number
    failed: { url: string; code: string }[]
    omitted: {
      url: string
      reason: RenderOmitReason | 'scheme' | 'limit' | 'redirect' | 'method'
    }[]
    blockedByRobots: string[]
    refused: string[]
  }
  scriptErrors: { count: number; first: string[] }
}
export class BrowserUnavailableError extends Error {
  override name = 'BrowserUnavailableError'
}
export class RenderInterruptedError extends Error {}
