import { type RenderStatus, isRobotsAllowed, parseRobots } from '@seotools/core'
import type { Crawl, CrawlUrlRender, Database } from '@seotools/db'
import type { RenderService } from '../render/service'
import { BrowserUnavailableError } from '../render/types'
import { abortableSleep } from './requests'
import { robotsConclusive } from './site-audit'

export class BrowserWaitExpiredError extends Error {
  override message = 'browser-unavailable'
}

/** One recovery wait and one cumulative, persisted allowance shared by every concurrent page. */
export function createBrowserRecovery(options: {
  crawl: Crawl
  db: Database
  service?: Pick<RenderService, 'check' | 'render'>
  signal: AbortSignal
  heartbeat: () => Promise<void>
  maxWaitMs?: number
  pollMs?: number
}) {
  let spent = options.crawl.browserWaitMs
  let pending: Promise<void> | undefined
  const max = options.maxWaitMs ?? 600_000
  async function check(): Promise<RenderStatus | undefined> {
    return options.service?.check()
  }
  async function boundedCheck(milliseconds: number) {
    return new Promise<RenderStatus | undefined>((resolve, reject) => {
      const abort = () =>
        finish(undefined, options.signal.reason ?? new DOMException('Stopped', 'AbortError'))
      const timer = setTimeout(() => finish(undefined, new BrowserWaitExpiredError()), milliseconds)
      const finish = (value?: RenderStatus, error?: unknown) => {
        clearTimeout(timer)
        options.signal.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolve(value)
      }
      options.signal.addEventListener('abort', abort, { once: true })
      if (options.signal.aborted) abort()
      else
        void check().then(
          (value) => finish(value),
          (error: unknown) => finish(undefined, error),
        )
    })
  }
  async function recover(first?: RenderStatus) {
    let status = first
    const deadline = Date.now() + Math.max(0, max - spent)
    const reserve = async (milliseconds: number) => {
      spent += milliseconds
      await options.db.crawls.saveBrowserWait(options.crawl.id, spent)
    }
    try {
      while (status?.state !== 'ready') {
        options.signal.throwIfAborted()
        if (spent >= max || Date.now() >= deadline) throw new BrowserWaitExpiredError()
        const duration = Math.min(options.pollMs ?? 30_000, max - spent, deadline - Date.now())
        // Reserve before waiting: a crash/shutdown must not reset a spent allowance.
        await reserve(duration)
        const until = Math.min(deadline, Date.now() + duration)
        while (Date.now() < until) {
          options.signal.throwIfAborted()
          await options.heartbeat()
          await abortableSleep(Math.min(200, until - Date.now()), options.signal)
        }
        options.signal.throwIfAborted()
        if (spent >= max || Date.now() >= deadline) throw new BrowserWaitExpiredError()
        // Status checks consume the same allowance and are bounded by the remaining wall time.
        const reserved = Math.min(10_000, max - spent, deadline - Date.now())
        await reserve(reserved)
        const began = Date.now()
        status = await boundedCheck(reserved)
        spent -= reserved - Math.min(reserved, Math.max(1, Date.now() - began))
        await options.db.crawls.saveBrowserWait(options.crawl.id, spent)
      }
    } catch (error) {
      if (error instanceof BrowserWaitExpiredError) {
        spent = max
        await options.db.crawls.saveBrowserWait(options.crawl.id, spent)
      }
      throw error
    }
  }
  async function unavailable(status?: RenderStatus) {
    pending ??= recover(status).finally(() => {
      pending = undefined
    })
    await pending
  }
  return {
    async start() {
      const status = await check()
      if (status?.state !== 'ready') {
        await unavailable(status)
        return true
      }
      return false
    },
    async ready() {
      await pending
    },
    async run<T>(action: () => Promise<T>): Promise<T> {
      for (;;) {
        await pending
        options.signal.throwIfAborted()
        try {
          return await action()
        } catch (error) {
          if (!(error instanceof BrowserUnavailableError)) throw error
          await unavailable()
        }
      }
    },
  }
}

export function renderRobots(crawl: Pick<Crawl, 'robots'>) {
  const files = new Map(
    Object.entries(crawl.robots ?? {}).map(([origin, file]) => [
      origin,
      {
        known: robotsConclusive(file.status),
        parsed: file.body === null ? null : parseRobots(file.body),
      },
    ]),
  )
  return (url: string): boolean | 'unknown' => {
    const parsed = new URL(url)
    const file = files.get(parsed.origin)
    if (!file?.known) return 'unknown'
    return (
      !file.parsed || isRobotsAllowed(file.parsed, 'Googlebot', parsed.pathname + parsed.search)
    )
  }
}

export function renderObservation(
  urlHash: string,
  outcome: Awaited<ReturnType<RenderService['render']>>,
  facts: CrawlUrlRender['data']['facts'],
): CrawlUrlRender {
  return {
    urlHash,
    status: outcome.status,
    settled: outcome.settled,
    finalUrl: outcome.finalUrl,
    durationMs: outcome.durationMs,
    failure: outcome.failure?.code ?? null,
    data: { facts, requests: outcome.requests, scriptErrors: outcome.scriptErrors },
  }
}
