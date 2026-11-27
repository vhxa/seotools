import { capacityLimits } from '@seotools/core/capacity'
import { createSlots } from './slots'
import type { Browser } from 'puppeteer-core'
import type { RenderStatus } from '@seotools/core'
import { bestEffort } from './cleanup'
import { createBrowserConnection } from './connection'
import { RENDER_LIMITS } from './limits'
import { renderPage } from './page'
import { RenderInterruptedError, type RenderInput, type RenderOutcome } from './types'

/** One instance per worker, across every crawl. Caller owns each crawl's resource cache. */
export function createRenderService(options: {
  browserUrl?: string
  concurrency: number
  writeStatus: (status: RenderStatus) => Promise<void>
  /** Capture-rule benchmark override. Production uses the default in renderPage. */
  minQuietCaptureMs?: number
}) {
  let concurrency = options.concurrency
  function validate(value: number) {
    if (
      !Number.isInteger(value) ||
      value < capacityLimits.renders.min ||
      value > capacityLimits.renders.max
    )
      throw new Error('Invalid render concurrency')
  }
  validate(concurrency)
  const connection = createBrowserConnection(options.browserUrl, options.writeStatus)
  const slots = createSlots(concurrency)
  const resourceBudgets = new Set<ReturnType<typeof createSlots>>()
  return {
    check: connection.check,
    get concurrency() {
      return concurrency
    },
    resize(value: number) {
      validate(value)
      if (concurrency === value) return
      concurrency = value
      for (const budget of resourceBudgets) budget.resize(value * RENDER_LIMITS.pageResources)
      slots.resize(value)
    },
    trackResources(budget: ReturnType<typeof createSlots>) {
      budget.resize(concurrency * RENDER_LIMITS.pageResources)
      resourceBudgets.add(budget)
      return () => {
        resourceBudgets.delete(budget)
      }
    },
    async render(input: RenderInput): Promise<RenderOutcome> {
      await slots.acquire(input.signal)
      const renderSlots = concurrency
      try {
        input.signal.throwIfAborted()
        for (let attempt = 0; ; attempt++) {
          let browser: Browser | undefined
          try {
            const lease = await connection.get()
            browser = lease.browser
            const outcome = await renderPage(
              browser,
              input,
              lease.context,
              options.minQuietCaptureMs,
            )
            return { ...outcome, renderSlots }
          } catch (error) {
            input.signal.throwIfAborted()
            if (!(error instanceof RenderInterruptedError)) throw error
            if (attempt === 0) continue
            return {
              status: 'failed',
              renderSlots,
              failure: { code: 'crashed', message: 'The browser or page crashed twice.' },
              settled: false,
              pending: 0,
              captureMs: null,
              captureDelayMs: null,
              redirected: false,
              finalUrl: input.url,
              html: '',
              truncated: false,
              durationMs: 0,
              requests: {
                made: 0,
                cached: 0,
                failedCount: 0,
                omittedCount: 0,
                blockedByRobotsCount: 0,
                refusedCount: 0,
                failed: [],
                omitted: [],
                blockedByRobots: [],
                refused: [],
              },
              scriptErrors: { count: 0, first: [] },
            }
          } finally {
            if (browser) await bestEffort(() => connection.release(browser!))
          }
        }
      } finally {
        slots.release()
      }
    },
    close: connection.close,
  }
}
export type RenderService = ReturnType<typeof createRenderService>
export const RENDER_CHECK_INTERVAL_MS = RENDER_LIMITS.checkIntervalMs
