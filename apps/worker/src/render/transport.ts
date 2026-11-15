import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import http from 'node:http'
import https from 'node:https'
import WebSocket from 'ws'
import type { Browser, ConnectionTransport } from 'puppeteer-core'
import { RENDER_LIMITS } from './limits'
import { BrowserUnavailableError } from './types'

export interface BrowserConnection {
  browser: Browser
  /** The worker's address as the browser sees it (local end of the CDP socket). */
  localAddress: string
  /** The browser process's DevTools GUID; absent when the endpoint does not expose one. */
  identity?: string
}

/**
 * The browser instance this connection is attached to. Chromium's DevTools HTTP handler draws a
 * random GUID per browser process, publishes it in /json/version and answers 404 to an upgrade
 * for any other GUID (verified on 158: stable per process, new after a restart, a stale GUID is
 * refused). The GUID in the URL this connection upgraded with is therefore the identity of the
 * process it talks to, even if the browser was replaced between discovery and the upgrade.
 */
export function browserIdentity(wsUrl: string): { identity?: string } {
  const identity = /^\/devtools\/browser\/([0-9a-f-]{36})$/i.exec(new URL(wsUrl).pathname)?.[1]
  return identity ? { identity: identity.toLowerCase() } : {}
}

/** One deadline across system name resolution, discovery, WS and CDP initialization. */
const systemLookup = (hostname: string) => lookup(hostname, { all: true })

/** GET /json/version with Node HTTP, cancelled by the shared deadline. */
function discover(endpoint: URL, signal: AbortSignal) {
  endpoint.pathname = endpoint.pathname.replace(/\/?$/, '') + '/json/version'
  // Node HTTP avoids global fetch's connection pool and lets abort close discovery immediately.
  return new Promise<string>((resolve, reject) => {
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
}

export async function connectBrowser(
  url: string,
  options: {
    timeoutMs?: number
    lookup?: (hostname: string) => Promise<{ address: string; family: number }[]>
  } = {},
): Promise<BrowserConnection> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? RENDER_LIMITS.connectionMs)
  const signal = abort.signal
  let socket: WebSocket | undefined
  const terminate = () => socket?.terminate()
  signal.addEventListener('abort', terminate)
  try {
    const configured = new URL(url)
    const hostname = configured.hostname.replace(/^\[|\]$/g, '')
    // Chrome's DevTools HTTP server refuses a Host header that is a name (DNS rebinding
    // protection), so the worker resolves it and connects to an address literal.
    const addresses = isIP(hostname)
      ? [hostname]
      : await new Promise<string[]>((resolve, reject) => {
          // dns.lookup is getaddrinfo: /etc/hosts, the system resolver and Docker's DNS, like
          // any other client. It cannot be cancelled: stop waiting at the shared deadline and
          // ignore a late answer.
          const expired = () => reject(new Error('Browser lookup timed out'))
          signal.throwIfAborted()
          signal.addEventListener('abort', expired, { once: true })
          ;(options.lookup ?? systemLookup)(hostname).then(
            (answers) => {
              signal.removeEventListener('abort', expired)
              resolve(answers.map((answer) => answer.address).filter((address) => isIP(address)))
            },
            (error: unknown) => {
              signal.removeEventListener('abort', expired)
              reject(error)
            },
          )
        })
    if (!addresses.length) throw new Error('No browser address')
    // Try every address in order (localhost may list ::1 before 127.0.0.1), within the deadline.
    let wsUrl: string | undefined
    let lastError: unknown
    for (const address of addresses) {
      const endpoint = new URL(configured)
      endpoint.hostname = isIP(address) === 6 ? `[${address}]` : address
      try {
        wsUrl = await discover(endpoint, signal)
        break
      } catch (error) {
        signal.throwIfAborted()
        lastError = error
      }
    }
    if (!wsUrl) throw lastError instanceof Error ? lastError : new Error('Discovery failed')
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
    return { browser, localAddress, ...browserIdentity(wsUrl) }
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
