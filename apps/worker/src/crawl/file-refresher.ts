import { siteHeaders } from './credentials'
import { defaultCrawlerUserAgent, type Logger } from '@seotools/core'
import type { Database } from '@seotools/db'
import type { Fetcher, FetcherConfig } from './fetcher'
import { CRAWL_FILE_REFRESH_INTERVAL_MS, fetchCrawlFiles } from './files'

/** A check that could not finish is retried after this long. Also the wait after an outage. */
export const CRAWL_FILE_RETRY_INTERVAL_MS = 60 * 60_000
/** Domains looked at per pass. The rest wait for the next one. */
const BATCH = 20
/** Domains checked at once: a slow site must not hold up someone waiting on another one. */
const CONCURRENCY = 4

export interface CrawlFileRefresher {
  /** Checks the domains that are due. A pass already running is not started twice. */
  tick(): Promise<void>
  /** Gives up what is in flight and waits for it to stop, so the database can be closed. */
  stop(): Promise<void>
}

/**
 * Keeps the files of every domain current between crawls: new domains are checked at once, the
 * others once a day, or when someone asks. Like the favicon refresher it is not a job of the queue:
 * nothing depends on its outcome, and a missed pass is made up for by the next one.
 */
export function createCrawlFileRefresher(options: {
  db: Database
  log: Logger
  createFetcher: (config: Omit<FetcherConfig, 'allowPrivateNetworks'>) => Fetcher
  /** `SEOTOOLS_PAUSE_AUTOMATION`: a pass does nothing. */
  paused?: boolean
  appVersion?: string
  settingsSecret?: string
  now?: () => Date
  retryBaseMs?: number
}): CrawlFileRefresher {
  const { db, log, createFetcher } = options
  const now = options.now ?? (() => new Date())
  const stopping = new AbortController()
  let running: Promise<void> | null = null

  const after = (ms: number) => new Date(now().getTime() + ms)

  async function check(domain: { id: string; host: string }) {
    const claimed = await db.crawlFiles.claimCheck({
      domainId: domain.id,
      now: now(),
      retryAt: after(CRAWL_FILE_RETRY_INTERVAL_MS),
    })
    if (!claimed) return

    // A full crawl requests these same files, and ends by pushing this check back a day.
    if ((await db.crawls.active(domain.id))?.type === 'full') {
      await db.crawlFiles.deferCheck({
        domainId: domain.id,
        nextCheckAt: after(CRAWL_FILE_RETRY_INTERVAL_MS),
      })
      return
    }

    const startedAt = now()
    const settings = await db.crawls.settings(domain.id)
    const fetcher = createFetcher({
      siteHeaders: await siteHeaders(db, domain.id, domain.host, options.settingsSecret),
      userAgent: settings.userAgent ?? defaultCrawlerUserAgent(options.appVersion),
      timeoutMs: settings.timeoutMs,
      concurrency: 1,
    })
    let fetched
    try {
      fetched = await fetchCrawlFiles({
        host: domain.host,
        settings,
        fetcher,
        signal: stopping.signal,
        now,
        ...(options.retryBaseMs === undefined ? {} : { retryBaseMs: options.retryBaseMs }),
      })
    } finally {
      fetcher.close()
    }

    // Nothing answered: that says more about the connection than about the files, so keep them.
    const reachable = fetched.files.some((file) => file.statusCode !== null)
    if (reachable) {
      await db.crawlFiles.save(domain.id, fetched.files)
      await db.crawlFiles.prune({
        domainId: domain.id,
        before: startedAt,
        ...(fetched.capped ? { keepKinds: ['sitemap'] as const } : {}),
      })
    }
    await db.crawlFiles.finishCheck({
      domainId: domain.id,
      outcome: reachable ? 'ok' : 'unreachable',
      checkedAt: now(),
      nextCheckAt: after(reachable ? CRAWL_FILE_REFRESH_INTERVAL_MS : CRAWL_FILE_RETRY_INTERVAL_MS),
    })
    log.info(
      { host: domain.host, files: fetched.files.length, reachable, capped: fetched.capped },
      'crawl files checked',
    )
  }

  async function pass() {
    const due = await db.crawlFiles.dueChecks({ now: now(), limit: BATCH })
    const worker = async () => {
      for (let domain = due.shift(); domain; domain = due.shift()) {
        if (stopping.signal.aborted) return
        try {
          await check(domain)
        } catch (error) {
          if (stopping.signal.aborted) return
          // It stays claimed until the retry, so this does not hit the same wall on the next pass.
          log.error({ err: error, host: domain.host }, 'crawl file check failed')
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  }

  return {
    tick() {
      if (options.paused || stopping.signal.aborted) return Promise.resolve()
      running ??= pass()
        .catch((error) => log.error({ err: error }, 'crawl file refresh failed'))
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
