import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import http from 'node:http'
import https from 'node:https'
import WebSocket from 'ws'
import type { Browser, ConnectionTransport } from 'puppeteer-core'
import { RENDER_LIMITS } from './limits'
import { BrowserUnavailableError } from './types'

/** One deadline across system name resolution, discovery, WS and CDP initialization. */
export async function connectBrowser(
  url: string,
  options: {
    timeoutMs?: number
    lookup?: (hostname: string) => Promise<{ address: string; family: number }>
  } = {},
): Promise<{ browser: Browser; localAddress: string; identity?: string }> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? RENDER_LIMITS.connectionMs)
  const signal = abort.signal
  let socket: WebSocket | undefined
  const terminate = () => socket?.terminate()
  signal.addEventListener('abort', terminate)
  try {
    const endpoint = new URL(url)
    const hostname = endpoint.hostname.replace(/^\[|\]$/g, '')
    if (!isIP(hostname)) {
      // lookup follows /etc/hosts and the system resolver (including Docker DNS).
      // getaddrinfo cannot be cancelled: stop waiting at the shared deadline and ignore late answers.
      const address = await new Promise<string>((resolve, reject) => {
        const expired = () => reject(new Error('Browser lookup timed out'))
        signal.addEventListener('abort', expired, { once: true })
        signal.throwIfAborted()
        ;(options.lookup ?? lookup)(hostname).then(
          (answer) => {
            signal.removeEventListener('abort', expired)
            if (!signal.aborted) resolve(answer.address)
          },
          (error: unknown) => {
            signal.removeEventListener('abort', expired)
            if (!signal.aborted) reject(error)
          },
        )
      })
      if (!isIP(address)) throw new Error('No browser address')
      endpoint.hostname = isIP(address) === 6 ? `[${address}]` : address
    }
    endpoint.pathname = endpoint.pathname.replace(/\/?$/, '') + '/json/version'
    // Node HTTP avoids global fetch's connection pool and lets abort close discovery immediately.
    const wsUrl = await new Promise<string>((resolve, reject) => {
      const client = endpoint.protocol === 'https:' ? https : http
      const request = client.get(endpoint, { signal, agent: false }, (response) => {
        let size = 0
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 64 * 1024) {
            request.destroy(new Error('Discovery response too large'))
            return
          }
          chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('end', () => {
          try {
            const data: unknown = JSON.parse(Buffer.concat(chunks).toString())
            if (
              response.statusCode !== 200 ||
              !data ||
              typeof data !== 'object' ||
              !('webSocketDebuggerUrl' in data) ||
              typeof data.webSocketDebuggerUrl !== 'string'
            )
              throw new Error('Invalid discovery response')
            const ws = new URL(data.webSocketDebuggerUrl)
            // Discovery must not cause another unbounded name lookup or change the configured host.
            ws.hostname = endpoint.hostname
            if (!['ws:', 'wss:'].includes(ws.protocol)) throw new Error('Invalid browser protocol')
            resolve(ws.toString())
          } catch (error) {
            reject(error)
          }
        })
      })
      request.on('error', reject)
    })
    signal.throwIfAborted()
    const transport: ConnectionTransport = {
      send(message) {
        socket!.send(message)
      },
      close() {
        socket!.terminate()
      },
    }
    let localAddress = ''
    socket = new WebSocket(wsUrl, {
      perMessageDeflate: false,
      maxPayload: RENDER_LIMITS.cdpMessageBytes,
      handshakeTimeout: options.timeoutMs ?? RENDER_LIMITS.connectionMs,
      followRedirects: false,
    })
    socket.on('upgrade', (response) => {
      localAddress = response.socket.localAddress ?? ''
    })
    socket.on('message', (data) => transport.onmessage?.(data.toString()))
    socket.on('close', () => transport.onclose?.())
    // maxPayload errors close this transport, never another render's connection.
    socket.on('error', () => socket?.terminate())
    await new Promise<void>((resolve, reject) => {
      socket!.once('open', resolve)
      socket!.once('error', reject)
      socket!.once('close', () => reject(new Error('Browser connection closed')))
    })
    signal.throwIfAborted()
    const { connect } = await import('puppeteer-core')
    signal.throwIfAborted()
    const browser = await connect({ transport, protocolTimeout: RENDER_LIMITS.protocolMs })
    signal.throwIfAborted()
    if (!localAddress) throw new Error('Cannot determine canary address')
    // Chromium generates this GUID for the DevTools server and validates it on WS upgrade.
    // A restart between discovery and upgrade therefore fails instead of leasing a replacement.
    // Browser Target ids are unsuitable: Chromium can create a new browser target per connection.
    const identity = /^\/devtools\/browser\/([0-9a-f-]{36})$/i.exec(new URL(wsUrl).pathname)?.[1]
    return { browser, localAddress, ...(identity ? { identity } : {}) }
  } catch (error) {
    socket?.terminate()
    throw new BrowserUnavailableError(
      signal.aborted
        ? 'Browser connection timed out'
        : error instanceof Error
          ? error.message
          : 'Browser connection failed',
    )
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', terminate)
  }
}
