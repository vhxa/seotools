import { createServer, type Socket } from 'node:net'
import { createSocket } from 'node:dgram'
import type { Browser } from 'puppeteer-core'
import type { RenderStatus } from '@seotools/core'
import { RENDER_LIMITS } from './limits'

/** Puppeteer 25.17's documented Chrome version; getHTML(shadowRoots) shipped in Chrome 128. */
export const MIN_CHROME_MAJOR = 157
export const ISOLATION_PROBES = [
  'http://example.com/',
  'http://1.1.1.1/',
  'http://169.254.169.254/',
] as const
const ISOLATED_ERROR =
  /net::ERR_(?:PROXY_CONNECTION_FAILED|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE|NETWORK_UNREACHABLE)\b/

/** Local live listeners also detect traffic bypassing HTTP interception (notably STUN). */
export async function checkIsolation(
  browser: Browser,
  localAddress = '127.0.0.1',
  protocols: readonly ('fetch' | 'websocket' | 'webrtc')[] = ['fetch', 'websocket', 'webrtc'],
): Promise<RenderStatus> {
  const checkedAt = new Date().toISOString()
  const version = (await browser.version()).slice(0, 100)
  const major = Number(/(?:Chrome|Chromium)\/(\d+)/.exec(version)?.[1])
  if (!major || major < MIN_CHROME_MAJOR) return { state: 'too-old', version, checkedAt }
  let received = false
  const sockets = new Set<Socket>()
  const tcp = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('data', () => {
      received = true
      socket.end(
        'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok',
      )
    })
    socket.on('error', () => {})
  })
  const udp = createSocket(localAddress.includes(':') ? 'udp6' : 'udp4')
  udp.on('message', () => {
    received = true
  })
  let udpBound = false
  const context = await browser.createBrowserContext()
  try {
    await new Promise<void>((resolve, reject) => {
      tcp.once('error', reject)
      tcp.listen(0, localAddress, resolve)
    })
    const address = tcp.address()
    if (!address || typeof address === 'string') throw new Error('Cannot bind canary')
    await new Promise<void>((resolve, reject) => {
      udp.once('error', reject)
      udp.bind(address.port, localAddress, () => {
        udpBound = true
        resolve()
      })
    })
    const page = await context.newPage()
    page.on('error', () => {})
    await page.setBypassCSP(true)
    const cdp = await page.createCDPSession()
    await cdp.send('Network.enable')
    await cdp.send('Browser.grantPermissions', {
      browserContextId: context.id,
      permissions: ['localNetwork', 'loopbackNetwork', 'localNetworkAccess'],
    })
    const failures: string[] = []
    const waitFailure = async () => {
      const deadline = Date.now() + RENDER_LIMITS.probeTimeoutMs
      while (!failures.length && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    let answered = false
    cdp.on('Network.loadingFailed', (event) => failures.push(event.errorText))
    cdp.on('Network.webSocketFrameError', (event) => failures.push(event.errorMessage))
    cdp.on('Network.responseReceived', ({ response }) => {
      if (response.remoteIPAddress) answered = true
    })
    const literal = (ip: string) => (ip.includes(':') ? `[${ip}]` : ip)
    const locals = [...new Set([localAddress, '127.0.0.1'])]
    // A data document supplies a document/loader for Network failure events.
    await page
      .goto('http://seotools-isolation.invalid', { timeout: RENDER_LIMITS.probeTimeoutMs })
      .catch(() => {})
    failures.length = 0
    const urls = [
      ...locals.map((ip) => `http://${literal(ip)}:${address.port}/canary`),
      ...ISOLATION_PROBES,
    ]
    let detail: string | undefined
    // Deliberately no interception, no page-controlled URLs. A timeout is never isolation evidence.
    for (const url of protocols.includes('fetch') ? urls : []) {
      failures.length = 0
      const result = await page.evaluate(
        async (url, timeout) => {
          return new Promise<string>((resolve) => {
            const controller = new AbortController()
            const timer = setTimeout(() => {
              controller.abort()
              resolve('timeout')
            }, timeout)
            fetch(url, { signal: controller.signal, mode: 'no-cors' }).then(
              () => {
                clearTimeout(timer)
                resolve('answered')
              },
              () => {
                clearTimeout(timer)
                resolve('error')
              },
            )
          })
        },
        url,
        RENDER_LIMITS.probeTimeoutMs,
      )
      if (result === 'error') await waitFailure()
      if (received || answered || result === 'answered') {
        detail = 'An HTTP probe or live TCP canary was reached.'
        break
      }
      if (result === 'timeout' || !failures.some((error) => ISOLATED_ERROR.test(error))) {
        detail =
          result === 'timeout'
            ? 'HTTP isolation probe timed out; isolation is not proven.'
            : 'HTTP isolation probe did not fail with a known isolation error: ' +
              failures.join(', ').slice(0, 150)
        break
      }
    }
    if (!detail && protocols.includes('websocket'))
      for (const ip of locals) {
        failures.length = 0
        const result = await page.evaluate(
          async (url, timeout) =>
            new Promise<string>((resolve) => {
              const ws = new WebSocket(url)
              const timer = setTimeout(() => {
                ws.close()
                resolve('timeout')
              }, timeout)
              ws.onopen = () => {
                clearTimeout(timer)
                ws.close()
                resolve('answered')
              }
              ws.onerror = () => {
                clearTimeout(timer)
                resolve('error')
              }
            }),
          `ws://${literal(ip)}:${address.port}/canary`,
          RENDER_LIMITS.probeTimeoutMs,
        )
        if (result === 'error') await waitFailure()
        if (received || result === 'answered') {
          detail = 'The WebSocket TCP canary was reached.'
          break
        }
        if (result === 'timeout' || !failures.some((error) => ISOLATED_ERROR.test(error))) {
          detail =
            result === 'timeout'
              ? 'WebSocket isolation probe timed out; isolation is not proven.'
              : 'WebSocket isolation probe did not fail with a known isolation error.'
          break
        }
      }
    if (!detail && protocols.includes('webrtc'))
      for (const ip of locals) {
        const result = await page.evaluate(
          async (server, timeout) => {
            const peer = new (
              globalThis as unknown as {
                RTCPeerConnection: new (config: unknown) => {
                  createDataChannel(name: string): void
                  createOffer(): Promise<unknown>
                  setLocalDescription(offer: unknown): Promise<void>
                  close(): void
                  onicecandidate: ((event: { candidate: unknown }) => void) | null
                }
              }
            ).RTCPeerConnection({ iceServers: [{ urls: server }] })
            try {
              return await new Promise<string>((resolve) => {
                const timer = setTimeout(() => resolve('timeout'), timeout)
                peer.onicecandidate = (event) => {
                  if (!event.candidate) {
                    clearTimeout(timer)
                    resolve('complete')
                  }
                }
                peer.createDataChannel('canary')
                peer
                  .createOffer()
                  .then((offer) => peer.setLocalDescription(offer))
                  .catch(() => {
                    clearTimeout(timer)
                    resolve('error')
                  })
              })
            } finally {
              peer.close()
            }
          },
          `stun:${literal(ip)}:${address.port}`,
          RENDER_LIMITS.probeTimeoutMs,
        )
        if (received) {
          detail = 'The WebRTC/STUN UDP canary was reached.'
          break
        }
        if (result !== 'complete') {
          detail =
            result === 'timeout'
              ? 'WebRTC isolation probe timed out; isolation is not proven.'
              : 'WebRTC isolation probe failed without proving isolation.'
          break
        }
      }
    return {
      state: received || answered || detail ? 'has-network' : 'ready',
      version,
      checkedAt,
      ...(detail ? { detail } : {}),
    }
  } finally {
    await context.close().catch(() => {})
    for (const socket of sockets) socket.destroy()
    if (tcp.listening) await new Promise<void>((resolve) => tcp.close(() => resolve()))
    if (udpBound) udp.close()
  }
}
