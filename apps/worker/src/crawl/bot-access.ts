import {
  defaultCrawlerUserAgent,
  isInternalUrl,
  normalizeCrawlUrl,
  type Logger,
} from '@seotools/core'
import { BOT_USER_AGENTS, botAccessVerdict } from '@seotools/core/bot-access'
import type { BotTestResult, Database } from '@seotools/db'
import { JobDeferredError, JobInterruptedError } from '../types'
import { siteHeaders } from './credentials'
import { FetchError, type Fetcher, type FetcherConfig } from './fetcher'
import { createRequester } from './requester'
import { RETRY_BASE_MS } from './requests'

export interface BotTestOptions {
  db: Database
  log: Logger
  signal: AbortSignal
  createFetcher: (config: Omit<FetcherConfig, 'allowPrivateNetworks'>) => Fetcher
  settingsSecret?: string
  appVersion?: string
  paused?: boolean
  retryBaseMs?: number
}

/** Sequential homepage requests, persisted individually so a retry never repeats a saved result. */
export async function runBotTest(runId: string, options: BotTestOptions) {
  const { db, signal, log } = options
  const run = await db.botTests.get(runId)
  if (!run?.activeKey) return
  const domain = await db.domains.get(run.domainId)
  if (!domain || domain.archivedAt) return
  if (options.paused) throw new JobDeferredError(30_000, 'Automation is paused')
  const check = async () => {
    if (signal.aborted) throw new JobInterruptedError()
    if (!(await db.botTests.get(runId))?.activeKey || (await db.domains.get(domain.id))?.archivedAt)
      return false
    if (await db.crawls.active(domain.id))
      throw new JobDeferredError(30_000, 'A crawl of the domain is active')
    return true
  }
  if (!(await check())) return
  await db.botTests.markRunning(runId)
  const settings = await db.crawls.settings(domain.id)
  const headers = await siteHeaders(db, domain.id, domain.host, options.settingsSecret)
  // Custom request headers may contain a UA too. It must not override the identity being tested.
  if (headers) {
    headers.headers = Object.fromEntries(
      Object.entries(headers.headers).filter(([name]) => name.toLowerCase() !== 'user-agent'),
    )
  }
  const stored = new Map(
    (await db.botTests.results(runId)).map((result) => [result.botToken, result]),
  )
  let currentFetcher: Fetcher | undefined
  // One requester owns the rate limit across every bot and every redirect, even as the UA changes.
  const proxy: Fetcher = {
    fetch: (url, config) => currentFetcher!.fetch(url, config),
    close() {},
  }
  const requester = createRequester({
    fetcher: proxy,
    settings,
    signal,
    retryBaseMs: options.retryBaseMs ?? RETRY_BASE_MS,
    log,
  })
  const identities = [
    {
      token: 'baseline',
      userAgent: settings.userAgent ?? defaultCrawlerUserAgent(options.appVersion),
    },
    ...BOT_USER_AGENTS,
  ]
  for (const identity of identities) {
    if (stored.has(identity.token)) continue
    if (!(await check())) return
    currentFetcher = options.createFetcher({
      siteHeaders: headers,
      userAgent: identity.userAgent,
      timeoutMs: settings.timeoutMs,
      concurrency: settings.concurrency,
    })
    let url = `https://${domain.host}/`
    const started = Date.now()
    let result: BotTestResult = {
      runId,
      botToken: identity.token,
      statusCode: null,
      finalUrl: null,
      responseTimeMs: null,
      bytes: null,
      errorCode: null,
      verdict: 'unknown',
      reasons: [],
    }
    try {
      const seen = new Set<string>()
      for (;;) {
        if (!(await check())) return
        if (seen.has(url) || seen.size >= 10)
          throw new FetchError('REDIRECT_LIMIT', 'Redirect limit reached')
        seen.add(url)
        const response = await requester.fetchWithRetries(url, { readBody: 'auto' })
        if (response instanceof FetchError) throw response
        result = {
          ...result,
          statusCode: response.statusCode,
          finalUrl: url,
          bytes: response.bytes,
          responseTimeMs: Date.now() - started,
        }
        if (![301, 302, 303, 307, 308].includes(response.statusCode) || !response.headers.location)
          break
        const next = normalizeCrawlUrl(response.headers.location, url)
        // Like the crawler, record external redirects without fetching the external page.
        if (!next) throw new FetchError('INVALID_REDIRECT', 'Invalid redirect')
        if (!isInternalUrl(next, domain.host)) {
          result.finalUrl = next
          break
        }
        url = next
      }
    } catch (error) {
      if (signal.aborted) throw new JobInterruptedError()
      if (!(error instanceof FetchError)) throw error
      result = {
        ...result,
        statusCode: null,
        finalUrl: null,
        bytes: null,
        errorCode: error.code,
        responseTimeMs: Date.now() - started,
      }
    } finally {
      currentFetcher.close()
    }
    if (!(await check())) return
    const baseline = stored.get('baseline')
    if (baseline) Object.assign(result, botAccessVerdict(baseline, result))
    await db.botTests.record(result)
    stored.set(identity.token, result)
  }
  if (await check()) await db.botTests.finish(runId, 'done')
}
