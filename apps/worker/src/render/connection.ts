import type { Browser, BrowserContext } from 'puppeteer-core'
import { RENDER_STATUS_STALE_MS, type RenderStatus } from '@seotools/core'
import { bestEffort } from './cleanup'
import { checkIsolation } from './isolation'
import { connectBrowser, type BrowserConnection } from './transport'
import { BrowserUnavailableError } from './types'

/**
 * No live CDP connection is shared by a status check or two renders. A passed check is bound to
 * the browser instance it ran on (its DevTools GUID): a lease whose own connection reaches another
 * instance, or one without an identity, runs the full check on that connection before any page.
 */
export function createBrowserConnection(
  url: string | undefined,
  writeStatus: (status: RenderStatus) => Promise<void>,
) {
  const active = new Map<Browser, BrowserContext>()
  const releasing = new Set<Browser>()
  const leaseChecks = new Map<string, Promise<RenderStatus>>()
  let checking: Promise<RenderStatus> | undefined
  let verified: { identity: string | undefined; status: RenderStatus } | undefined
  let statusWrite = Promise.resolve()
  function persist(status: RenderStatus) {
    // Preserve event order even when an unexpected disconnect writes asynchronously.
    statusWrite = statusWrite.catch(() => {}).then(() => writeStatus(status))
    return statusWrite
  }
  async function unavailable() {
    verified = undefined
    await persist({
      state: 'unreachable',
      checkedAt: new Date().toISOString(),
      detail: 'Cannot connect to or check the configured browser.',
    })
  }
  async function connect() {
    if (!url) throw new BrowserUnavailableError('Browser not configured')
    try {
      return await connectBrowser(url)
    } catch (error) {
      // An endpoint that cannot be reached may come back as another browser.
      await bestEffort(unavailable)
      throw error
    }
  }
  const isVerified = (identity: string | undefined) =>
    !!identity &&
    verified?.identity === identity &&
    verified.status.state === 'ready' &&
    Date.now() - Date.parse(verified.status.checkedAt) < RENDER_STATUS_STALE_MS
  async function checkOn(connection: BrowserConnection) {
    let result: RenderStatus
    try {
      result = await checkIsolation(connection.browser, connection.localAddress)
    } catch {
      result = {
        state: 'unreachable',
        checkedAt: new Date().toISOString(),
        detail: 'Cannot connect to or check the configured browser.',
      }
    }
    verified = { identity: connection.identity, status: result }
    return result
  }
  async function release(browser: Browser) {
    releasing.add(browser)
    const context = active.get(browser)
    active.delete(browser)
    const ids = context?.id ? [context.id] : []
    try {
      if (!browser.connected && ids.length) {
        // An oversized message/crash can sever CDP before the context's finally block runs.
        // A separate bounded connection disposes only this lease's contexts, never other renders.
        const cleanup = await connectBrowser(url!).catch(() => undefined)
        if (cleanup) {
          try {
            await bestEffort(async () => {
              const session = await cleanup.browser.target().createCDPSession()
              try {
                for (const browserContextId of ids)
                  await bestEffort(() =>
                    session.send('Target.disposeBrowserContext', { browserContextId }),
                  )
              } finally {
                await bestEffort(() => session.detach())
              }
            })
          } finally {
            await bestEffort(() => cleanup.browser.disconnect())
          }
        }
      } else {
        await bestEffort(() => context?.close())
      }
      await bestEffort(() => browser.disconnect())
    } finally {
      releasing.delete(browser)
    }
  }
  async function check(): Promise<RenderStatus> {
    if (!checking)
      checking = (async () => {
        let result: RenderStatus
        if (!url) result = { state: 'not-configured', checkedAt: new Date().toISOString() }
        else {
          let connection: BrowserConnection | undefined
          try {
            connection = await connect()
            result = await checkOn(connection)
          } catch {
            result = {
              state: 'unreachable',
              checkedAt: new Date().toISOString(),
              detail: 'Cannot connect to or check the configured browser.',
            }
          } finally {
            await bestEffort(() => connection?.browser.disconnect())
          }
        }
        await persist(result)
        return result
      })().finally(() => {
        checking = undefined
      })
    return checking
  }
  /** The full check on the lease's own connection, shared by leases of the same instance. */
  function checkLease(lease: BrowserConnection) {
    const key = lease.identity
    const pending = key ? leaseChecks.get(key) : undefined
    if (pending) return pending
    const run = (async () => {
      const result = await checkOn(lease)
      // The status is already bound in memory; a failed write must not fail the render.
      await persist(result).catch(() => {})
      return result
    })().finally(() => {
      if (key) leaseChecks.delete(key)
    })
    if (key) leaseChecks.set(key, run)
    return run
  }
  return {
    check,
    release,
    async get() {
      const lease = await connect()
      const { browser } = lease
      try {
        if (!isVerified(lease.identity)) {
          const result = await checkLease(lease)
          if (result.state !== 'ready' || !browser.connected)
            throw new BrowserUnavailableError(`Browser refused: ${result.state}`)
        }
        browser.once('disconnected', () => {
          // Our own release is expected; any other disconnection may mean a new browser.
          if (!releasing.has(browser) && verified?.identity === lease.identity)
            void bestEffort(unavailable)
        })
        const context = await browser.createBrowserContext()
        active.set(browser, context)
        return { browser, context }
      } catch (error) {
        await bestEffort(() => browser.disconnect())
        throw error
      }
    },
    async close() {
      await Promise.all([...active.keys()].map(release))
      verified = undefined
    },
  }
}
