import type { RenderOmitReason } from '@seotools/core'
import type { FetchedResponse } from '../crawl/fetcher'
import type { Requester } from '../crawl/requester'
import type { RenderResourceCache } from './cache'
import type { Slots } from './slots'

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
  /** The capture window in milliseconds, from the moment the DOM is parsed. */
  waitMs?: number
  /** For tests: how long the DOM may take to be parsed. */
  loadGraceMs?: number
  /** Subresource fetches the whole crawl may have at once (`6 × RENDER_CONCURRENCY`). */
  resourceSlots?: Slots
  /**
   * Ends fetches shared through the cache. They outlive the page that started them (another page
   * may be waiting for the same bundle), so they stop with the crawl, not with that page.
   */
  resourceSignal?: AbortSignal
  signal: AbortSignal
}
export interface RenderOutcome {
  status: 'rendered' | 'failed'
  failure?: { code: 'load-timeout' | 'crashed' | 'serialization' | 'navigation'; message: string }
  /** The network was quiet when the DOM was captured. */
  settled: boolean
  /** Requests still in flight when the DOM was captured. */
  pending: number
  /** From the DOM being parsed to its capture; `null` when the DOM was never parsed. */
  captureMs: number | null
  /** Browser snapshot delay beyond the chosen cutoff; null if no DOM was captured. */
  captureDelayMs: number | null
  /** A main-frame navigation to a different crawl identity ended this observation. */
  redirected: boolean
  finalUrl: string
  /** Address of the retained document after a same-document history change, for relative links. */
  documentUrl?: string
  html: string
  truncated: boolean
  durationMs: number
  /** Fingerprints of received inputs, for investigating differences between captures. */
  inputs?: {
    document: string
    resourceRequests: string
    resourceAnswers: string
    documentResponseMetadata: string
    resourceResponseMetadata: string
  }
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
