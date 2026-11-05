import { defaultCrawlerUserAgent, type Logger } from '@seotools/core'
import type { Database } from '@seotools/db'
import type { Fetcher, FetcherConfig } from '../crawl/fetcher'
import { findFavicon } from './find'

/** How long an icon is trusted before the site is asked again. Icons rarely change. */
export const FAVICON_REFRESH_INTERVAL_MS = 24 * 60 * 60_000
/** When a site could not be reached: soon, but not so often that an outage becomes traffic. */
export const FAVICON_RETRY_INTERVAL_MS = 60 * 60_000
/** Domains checked per pass. The rest wait for the next one. */
const BATCH = 20
/** The icon is secondary: a slow site must not hold up the domains behind it. */
const MAX_TIMEOUT_MS = 15_000

export interface FaviconRefresher {
  /** Checks the domains that are due. A pass already running is not started twice. */
  tick(): Promise<void>
  /** Gives up what is in flight and waits for it to stop, so the database can be closed. */
  stop(): Promise<void>
}

/**
 * Keeps the icon of every domain up to date: new domains are checked at once, the others once
 * a day. It is not a job of the queue: nothing depends on its outcome, and a missed pass is made
 * up for by the next one.
 */
export function createFaviconRefresher(options: {
  db: Database
  log: Logger
  createFetcher: (config: Omit<FetcherConfig, 'allowPrivateNetworks'>) => Fetcher
  /** `SEOTOOLS_PAUSE_AUTOMATION`: a pass does nothing. */
  paused?: boolean
  appVersion?: string
  now?: () => Date
}): FaviconRefresher {
  const { db, log, createFetcher } = options
  const now = options.now ?? (() => new Date())
  const stopping = new AbortController()
  let running: Promise<void> | null = null

  async function check(domain: { id: string; host: string }) {
    const settings = await db.crawls.settings(domain.id)
    const fetcher = createFetcher({
      userAgent: settings.userAgent ?? defaultCrawlerUserAgent(options.appVersion),
      timeoutMs: Math.min(settings.timeoutMs, MAX_TIMEOUT_MS),
      concurrency: 1,
    })
    let search
    try {
      search = await findFavicon({ host: domain.host, fetcher, signal: stopping.signal })
    } finally {
      fetcher.close()
    }

    const checkedAt = now()
    if (search.kind === 'unreachable') {
      await db.favicons.defer({
        domainId: domain.id,
        nextCheckAt: new Date(checkedAt.getTime() + FAVICON_RETRY_INTERVAL_MS),
      })
    } else {
      await db.favicons.save({
        domainId: domain.id,
        icon: search.kind === 'found' ? search.icon : null,
        nextCheckAt: new Date(checkedAt.getTime() + FAVICON_REFRESH_INTERVAL_MS),
      })
    }
    log.info(
      {
        host: domain.host,
        outcome: search.kind,
        ...(search.kind === 'found' ? { source: search.icon.sourceUrl } : {}),
      },
      'favicon checked',
    )
  }

  async function pass() {
    for (const domain of await db.favicons.due({ now: now(), limit: BATCH })) {
      if (stopping.signal.aborted) return
      try {
        await check(domain)
      } catch (error) {
        if (stopping.signal.aborted) return
        log.error({ err: error, host: domain.host }, 'favicon check failed')
        // Whatever it was, do not hit the same wall again on the very next pass.
        await db.favicons
          .defer({
            domainId: domain.id,
            nextCheckAt: new Date(now().getTime() + FAVICON_RETRY_INTERVAL_MS),
          })
          .catch(() => {})
      }
    }
  }

  return {
    tick() {
      if (options.paused || stopping.signal.aborted) return Promise.resolve()
      running ??= pass()
        .catch((error) => log.error({ err: error }, 'favicon refresh failed'))
        .finally(() => {
          running = null
        })
      return running
    },
    async stop() {
      stopping.abort()
      await running
    },
  }
}
