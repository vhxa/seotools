import type { RenderStatus } from '@seotools/core'
import { createBrowserConnection } from './connection'
import { RENDER_LIMITS } from './limits'
import { renderPage } from './page'
import { RenderInterruptedError, type RenderInput, type RenderOutcome } from './types'

/** One instance per worker, across every crawl. Caller owns each crawl's resource cache. */
export function createRenderService(options: {
  browserUrl?: string
  concurrency: number
  writeStatus: (status: RenderStatus) => Promise<void>
}) {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8)
    throw new Error('Invalid render concurrency')
  const connection = createBrowserConnection(options.browserUrl, options.writeStatus)
  let active = 0
  const queue: (() => void)[] = []
  async function acquire(signal: AbortSignal) {
    signal.throwIfAborted()
    if (active < options.concurrency) {
      active++
      return
    }
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener('abort', cancel)
        resolve()
      }
      const cancel = () => {
        const index = queue.indexOf(ready)
        if (index >= 0) queue.splice(index, 1)
        reject(new DOMException('Render stopped', 'AbortError'))
      }
      queue.push(ready)
      signal.addEventListener('abort', cancel, { once: true })
    })
  }
  return {
    check: connection.check,
    async render(input: RenderInput): Promise<RenderOutcome> {
      await acquire(input.signal)
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            return await renderPage(await connection.get(), input)
          } catch (error) {
            input.signal.throwIfAborted()
            if (!(error instanceof RenderInterruptedError)) throw error
            if (attempt === 0) continue
            return {
              status: 'failed',
              failure: { code: 'crashed', message: 'The browser or page crashed twice.' },
              settled: false,
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
          }
        }
      } finally {
        const next = queue.shift()
        if (next) next()
        else active--
      }
    },
    close: connection.close,
  }
}
export type RenderService = ReturnType<typeof createRenderService>
export const RENDER_CHECK_INTERVAL_MS = RENDER_LIMITS.checkIntervalMs
