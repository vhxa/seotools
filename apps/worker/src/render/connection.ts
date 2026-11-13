import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { Browser } from 'puppeteer-core'
import type { RenderStatus } from '@seotools/core'
import { RENDER_LIMITS } from './limits'
import { checkIsolation } from './isolation'
import { BrowserUnavailableError } from './types'

export function createBrowserConnection(
  url: string | undefined,
  writeStatus: (status: RenderStatus) => Promise<void>,
) {
  let browser: Browser | undefined
  let connecting: Promise<Browser> | undefined
  let checking: Promise<RenderStatus> | undefined
  let status: RenderStatus | undefined

  async function connect() {
    if (!url) throw new BrowserUnavailableError('Browser not configured')
    if (browser?.connected) return browser
    if (!connecting)
      connecting = (async () => {
        const endpoint = new URL(url)
        const hostname = endpoint.hostname.replace(/^\[|\]$/g, '')
        const address = isIP(hostname) ? hostname : (await lookup(hostname)).address
        endpoint.hostname = isIP(address) === 6 ? `[${address}]` : address
        // Dynamic import: no Puppeteer runtime is loaded when rendering is disabled.
        const { connect } = await import('puppeteer-core')
        const pending = connect({
          browserURL: endpoint.toString(),
          protocolTimeout: RENDER_LIMITS.protocolMs,
          wsOptions: { handshakeTimeout: RENDER_LIMITS.connectionMs },
        })
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          browser = await Promise.race([
            pending,
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new BrowserUnavailableError('Browser connection timed out')),
                RENDER_LIMITS.connectionMs,
              )
            }),
          ])
        } catch (error) {
          void pending.then((late) => late.disconnect()).catch(() => {})
          throw error
        } finally {
          if (timer) clearTimeout(timer)
        }
        browser.once('disconnected', () => {
          status = undefined
        })
        return browser
      })().finally(() => {
        connecting = undefined
      })
    return connecting
  }
  async function check(): Promise<RenderStatus> {
    if (!checking)
      checking = (async () => {
        let result: RenderStatus
        if (!url) result = { state: 'not-configured', checkedAt: new Date().toISOString() }
        else {
          try {
            result = await checkIsolation(await connect())
          } catch {
            result = {
              state: 'unreachable',
              checkedAt: new Date().toISOString(),
              detail: 'Cannot connect to or check the configured browser.',
            }
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
    async get() {
      const current = await connect().catch(() => undefined)
      if (!current) {
        await check()
        throw new BrowserUnavailableError('Browser unreachable')
      }
      if (!status || status.state !== 'ready') {
        const result = await check()
        if (result.state !== 'ready')
          throw new BrowserUnavailableError(`Browser refused: ${result.state}`)
      }
      return current
    },
    async close() {
      await browser?.disconnect()
      browser = undefined
      status = undefined
    },
  }
}
