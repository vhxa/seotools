import type { Browser, BrowserContext } from 'puppeteer-core'
import type { RenderStatus } from '@seotools/core'
import { checkIsolation } from './isolation'
import { connectBrowser } from './transport'
import { BrowserUnavailableError } from './types'

/** No live CDP connection is shared by a status check or two renders. */
export function createBrowserConnection(
  url: string | undefined,
  writeStatus: (status: RenderStatus) => Promise<void>,
) {
  const active = new Map<Browser, BrowserContext>()
  let checking: Promise<RenderStatus> | undefined
  let status: RenderStatus | undefined
  async function connect() {
    if (!url) throw new BrowserUnavailableError('Browser not configured')
    return connectBrowser(url)
  }
  async function release(browser: Browser) {
    const context = active.get(browser)
    active.delete(browser)
    const ids = context?.id ? [context.id] : []
    if (!browser.connected && ids.length) {
      // An oversized message/crash can sever CDP before the context's finally block runs.
      // A separate bounded connection disposes only this lease's contexts, never other renders.
      const cleanup = await connect().catch(() => undefined)
      if (cleanup) {
        try {
          const session = await cleanup.browser.target().createCDPSession()
          for (const browserContextId of ids)
            await session.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
        } finally {
          await cleanup.browser.disconnect()
        }
      }
    } else {
      await context?.close().catch(() => {})
    }
    await browser.disconnect()
  }
  async function check(): Promise<RenderStatus> {
    if (!checking)
      checking = (async () => {
        let result: RenderStatus
        if (!url) result = { state: 'not-configured', checkedAt: new Date().toISOString() }
        else {
          let connection: Awaited<ReturnType<typeof connect>> | undefined
          try {
            connection = await connect()
            result = await checkIsolation(connection.browser, connection.localAddress)
          } catch {
            result = {
              state: 'unreachable',
              checkedAt: new Date().toISOString(),
              detail: 'Cannot connect to or check the configured browser.',
            }
          } finally {
            await connection?.browser.disconnect()
          }
        }
        status = result
        await writeStatus(result)
        return result
      })().finally(() => {
        checking = undefined
      })
    return checking
  }
  return {
    check,
    release,
    async get() {
      if (!status || status.state !== 'ready') {
        const result = await check()
        if (result.state !== 'ready')
          throw new BrowserUnavailableError(`Browser refused: ${result.state}`)
      }
      const { browser } = await connect()
      try {
        const context = await browser.createBrowserContext()
        active.set(browser, context)
        return { browser, context }
      } catch (error) {
        await browser.disconnect()
        throw error
      }
    },
    async close() {
      await Promise.all([...active.keys()].map(release))
      status = undefined
    },
  }
}
