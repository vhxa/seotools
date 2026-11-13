import type { Browser, HTTPResponse } from 'puppeteer-core'
import type { RenderStatus } from '@seotools/core'
import { RENDER_LIMITS } from './limits'

/** Puppeteer 25.17's documented Chrome version; getHTML(shadowRoots) shipped in Chrome 128. */
export const MIN_CHROME_MAJOR = 157
export const ISOLATION_PROBES = [
  'http://example.com/',
  'http://1.1.1.1/',
  'http://169.254.169.254/',
] as const

export async function checkIsolation(browser: Browser): Promise<RenderStatus> {
  const checkedAt = new Date().toISOString()
  const version = (await browser.version()).slice(0, 100)
  const major = Number(/(?:Chrome|Chromium)\/(\d+)/.exec(version)?.[1])
  if (!major || major < MIN_CHROME_MAJOR) return { state: 'too-old', version, checkedAt }
  const context = await browser.createBrowserContext()
  try {
    const page = await context.newPage()
    let answered = false
    let crashed = false
    page.on('error', () => {
      crashed = true
    })
    // Chrome synthesizes 307 HTTPS upgrades without contacting a server (empty remote IP).
    const isHttpAnswer = (response: HTTPResponse) =>
      /^https?:/.test(response.url()) && response.status() > 0 && !!response.remoteAddress().ip
    page.on('response', (response) => {
      if (isHttpAnswer(response)) answered = true
    })
    // Intentionally no interception: these are constant addresses, never user input.
    for (const url of ISOLATION_PROBES) {
      try {
        const response = await page.goto(url, {
          timeout: RENDER_LIMITS.probeTimeoutMs,
          waitUntil: 'domcontentloaded',
        })
        if (response && isHttpAnswer(response)) return { state: 'has-network', version, checkedAt }
      } catch {
        if (crashed || !browser.connected || page.isClosed())
          throw new Error('Browser disconnected during isolation check')
      }
    }
    return { state: answered ? 'has-network' : 'ready', version, checkedAt }
  } finally {
    await context.close().catch(() => {})
  }
}
