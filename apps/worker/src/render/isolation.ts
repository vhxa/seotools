import { createServer, isIP, type Server, type Socket } from 'node:net'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import type { Browser, BrowserContext, CDPSession, Page } from 'puppeteer-core'
import type { RenderStatus } from '@seotools/core'
import { RENDER_LIMITS } from './limits'

/** Puppeteer 25.17's documented Chrome version; getHTML(shadowRoots) shipped in Chrome 128. */
export const MIN_CHROME_MAJOR = 157

/**
 * The only accepted outcome of an unintercepted probe. With `--proxy-server` pointing at a closed
 * port, Chromium sends every URL, names included (the proxy resolves names), to that proxy and
 * fails with this error (net/base/net_error_list.h, PROXY_CONNECTION_FAILED). A destination that
 * a bypass rule sends direct fails differently (ERR_NAME_NOT_RESOLVED under the resolver rule,
 * ERR_CONNECTION_REFUSED, ERR_ADDRESS_UNREACHABLE…) or connects: both are refused. The resolver
 * rule (`--host-resolver-rules=MAP * ~NOTFOUND`) is a further layer for paths that skip the proxy;
 * this check does not try to prove it.
 */
export const DEAD_PROXY_ERROR = 'net::ERR_PROXY_CONNECTION_FAILED'

// Sampled ports: HTTP(S) defaults, the app, PostgreSQL and the image's DevTools ports. All are
// outside Chromium's restricted port list (net/base/port_util.cc), which fails before the proxy.
export const PROBE_PORTS = [80, 443, 3000, 5432, 9222, 9223] as const
export const PROBE_PRIVATE_ADDRESSES = [
  '10.0.0.1',
  '172.16.0.1',
  '192.168.0.1',
  '100.64.0.1',
  '169.254.169.254',
  'fd00::1',
  'fe80::1',
] as const
export const PROBE_PUBLIC_ADDRESSES = ['1.1.1.1', '2606:4700:4700::1111'] as const
export const PROBE_NAMES = ['example.com', 'localhost'] as const
const MAX_INTERFACE_ADDRESSES = 16
const PROBE_PATH = '/seotools-isolation-probe'
const NAVIGATION_PAGES = 4
const WEBSOCKETS_PER_PAGE = 6

export type ProbeProtocol = 'fetch' | 'websocket' | 'navigation' | 'webrtc'
export type ProbeOutcome = { error: string } | { answered: true } | { timeout: true }

const literal = (host: string) => (isIP(host) === 6 ? `[${host}]` : host)
const origin = (host: string, port: number | undefined) =>
  `${literal(host)}${port === undefined ? '' : `:${port}`}`

/** Every worker interface address (v4 and v6), deduplicated and bounded. */
export function workerAddresses(): string[] {
  const addresses = Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .map((item) => item.address.replace(/%.*$/, ''))
  return [...new Set(addresses)].slice(0, MAX_INTERFACE_ADDRESSES)
}

/**
 * The fixed probe set: loopback (v4, v6) and every worker address on several ports, each live
 * canary on its own port, one address in each private range, public literals and public names.
 * Sampling guards against misconfiguration on top of the internal network; it cannot prove that
 * an arbitrary configuration sends every destination through the dead proxy.
 */
export function isolationProbeOrigins(options: {
  localAddress: string
  canaries: readonly { address: string; port: number }[]
  interfaces: readonly string[]
}): string[] {
  const hosts = [...new Set(['127.0.0.1', '::1', options.localAddress, ...options.interfaces])]
  const origins = [
    ...options.canaries.map((canary) => origin(canary.address, canary.port)),
    ...hosts.flatMap((host) => PROBE_PORTS.map((port) => origin(host, port))),
    ...[...PROBE_PRIVATE_ADDRESSES, ...PROBE_PUBLIC_ADDRESSES].map((host) =>
      origin(host, undefined),
    ),
    ...PROBE_NAMES.map((host) => origin(host, undefined)),
  ]
  return [...new Set(origins)]
}

/** The first probe that did not fail with the dead-proxy error, if any. */
export function firstUnproven(
  outcomes: ReadonlyMap<string, ProbeOutcome | undefined>,
): { url: string; reason: string; answered: boolean } | undefined {
  for (const [url, outcome] of [...outcomes].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    if (outcome && 'error' in outcome && outcome.error === DEAD_PROXY_ERROR) continue
    if (outcome && 'answered' in outcome) return { url, reason: 'answered', answered: true }
    return {
      url,
      reason: !outcome || 'timeout' in outcome ? 'no outcome in time' : outcome.error,
      answered: false,
    }
  }
  return undefined
}

const netError = (text: string) => /net::ERR_[A-Z0-9_]+/.exec(text)?.[0] ?? text.slice(0, 80)

interface ProbePage {
  page: Page
  cdp: CDPSession
}

interface Canary {
  address: string
  port: number
  tcp: Server
  udp?: UdpSocket
}

async function openCanary(
  address: string,
  received: (protocol: 'tcp' | 'udp') => void,
  sockets: Set<Socket>,
): Promise<Canary | undefined> {
  const tcp = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('data', () => {
      received('tcp')
      socket.end(
        'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok',
      )
    })
    socket.on('error', () => {})
  })
  try {
    await new Promise<void>((resolve, reject) => {
      tcp.once('error', reject)
      tcp.listen(0, address, resolve)
    })
  } catch {
    // An address family absent in this container (e.g. no IPv6 loopback) has no canary; its
    // probes still run and must still fail with the dead-proxy error.
    return undefined
  }
  const bound = tcp.address()
  if (!bound || typeof bound === 'string') {
    tcp.close()
    return undefined
  }
  const udp = createSocket(isIP(address) === 6 ? 'udp6' : 'udp4')
  udp.on('message', () => received('udp'))
  const udpBound = await new Promise<boolean>((resolve) => {
    udp.once('error', () => resolve(false))
    udp.bind(bound.port, address, () => resolve(true))
  })
  if (!udpBound) udp.close()
  return { address, port: bound.port, tcp, ...(udpBound ? { udp } : {}) }
}

async function closeCanary(canary: Canary) {
  canary.udp?.close()
  await new Promise<void>((resolve) => canary.tcp.close(() => resolve()))
}

/** Records each probe's outcome from the browser's own net error, never from page JavaScript. */
function watchProbes(cdp: CDPSession, urls: Map<string, ProbeOutcome | undefined>) {
  const ids = new Map<string, string>()
  const settle = (id: string, outcome: ProbeOutcome) => {
    const url = ids.get(id)
    if (url && urls.has(url) && !urls.get(url)) urls.set(url, outcome)
  }
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    ids.set(requestId, new URL(request.url).href)
  })
  cdp.on('Network.webSocketCreated', ({ requestId, url }) => ids.set(requestId, new URL(url).href))
  cdp.on('Network.loadingFailed', ({ requestId, errorText }) =>
    settle(requestId, { error: netError(errorText) }),
  )
  cdp.on('Network.responseReceived', ({ requestId }) => settle(requestId, { answered: true }))
  cdp.on('Network.webSocketHandshakeResponseReceived', ({ requestId }) =>
    settle(requestId, { answered: true }),
  )
  cdp.on('Network.webSocketFrameError', ({ requestId, errorMessage }) =>
    settle(requestId, { error: netError(errorMessage) }),
  )
}

async function settled(urls: ReadonlyMap<string, ProbeOutcome | undefined>) {
  // CDP events can trail the page's own promise settlement slightly.
  const deadline = Date.now() + 500
  while ([...urls.values()].some((outcome) => !outcome) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10))
}

/** fetch probes, all at once from one page (fetch has no per-renderer throttling). */
async function probeFetches(probe: ProbePage, origins: readonly string[]) {
  const urls = new Map<string, ProbeOutcome | undefined>()
  for (const scheme of ['http', 'https'])
    for (const item of origins)
      urls.set(new URL(`${scheme}://${item}${PROBE_PATH}`).href, undefined)
  watchProbes(probe.cdp, urls)
  await probe.page.evaluate(
    async (list, timeout) => {
      await Promise.all(
        list.map((url) => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeout)
          return fetch(url, { mode: 'no-cors', signal: controller.signal })
            .catch(() => {})
            .finally(() => clearTimeout(timer))
        }),
      )
    },
    [...urls.keys()],
    RENDER_LIMITS.probeTimeoutMs,
  )
  await settled(urls)
  return urls
}

/**
 * WebSocket probes, one at a time per page. Chromium delays a renderer's WebSocket handshakes
 * more after each failure (observed on 158: the eighth failure in one page waits seconds), so
 * each batch gets a fresh context, hence a fresh renderer.
 */
async function probeWebSockets(open: () => Promise<ProbePage>, origins: readonly string[]) {
  const urls = new Map<string, ProbeOutcome | undefined>()
  const batches: string[][] = []
  for (const item of origins) {
    const url = new URL(`ws://${item}${PROBE_PATH}`).href
    urls.set(url, undefined)
    if (!batches.at(-1) || batches.at(-1)!.length >= WEBSOCKETS_PER_PAGE) batches.push([])
    batches.at(-1)!.push(url)
  }
  await Promise.all(
    batches.map(async (batch) => {
      const probe = await open()
      watchProbes(probe.cdp, urls)
      await probe.page.evaluate(
        async (list, timeout) => {
          for (const url of list) {
            const settled = await new Promise<boolean>((resolve) => {
              const socket = new WebSocket(url)
              const timer = setTimeout(() => {
                socket.close()
                resolve(false)
              }, timeout)
              socket.onopen = socket.onerror = () => {
                clearTimeout(timer)
                socket.close()
                resolve(true)
              }
            })
            // A timeout already refuses the browser; the rest of the batch adds nothing.
            if (!settled) break
          }
        },
        batch,
        RENDER_LIMITS.probeTimeoutMs,
      )
    }),
  )
  await settled(urls)
  return urls
}

/** Top-level navigations, a few pages at a time; Page.navigate reports the net error itself. */
async function probeNavigations(pages: readonly CDPSession[], origins: readonly string[]) {
  const urls = new Map<string, ProbeOutcome | undefined>()
  const queue = origins.map((item) => new URL(`http://${item}${PROBE_PATH}`).href)
  for (const url of queue) urls.set(url, undefined)
  await Promise.all(
    pages.map(async (cdp) => {
      for (let url = queue.shift(); url; url = queue.shift()) {
        let timer: NodeJS.Timeout | undefined
        const outcome = await Promise.race([
          cdp.send('Page.navigate', { url }).then(
            ({ errorText }): ProbeOutcome =>
              errorText ? { error: netError(errorText) } : { answered: true },
            (error: unknown): ProbeOutcome => ({
              error: error instanceof Error ? netError(error.message) : 'navigation failed',
            }),
          ),
          new Promise<ProbeOutcome>((resolve) => {
            timer = setTimeout(() => resolve({ timeout: true }), RENDER_LIMITS.probeTimeoutMs)
          }),
        ])
        clearTimeout(timer)
        urls.set(url, outcome)
        if ('timeout' in outcome) {
          await cdp.send('Page.stopLoading').catch(() => {})
          // A timeout already refuses the browser: stop every navigation page.
          queue.length = 0
        }
      }
    }),
  )
  return urls
}

/** WebRTC must gather no candidate at all (no TURN is configured, so any is a direct socket). */
async function probeWebRtc(page: Page, servers: readonly string[]) {
  return page.evaluate(
    async (list, timeout) => {
      const Peer = (
        globalThis as unknown as {
          RTCPeerConnection: new (config: unknown) => {
            createDataChannel(name: string): void
            createOffer(): Promise<unknown>
            setLocalDescription(offer: unknown): Promise<void>
            close(): void
            onicecandidate: ((event: { candidate: { type?: string } | null }) => void) | null
          }
        }
      ).RTCPeerConnection
      const peer = new Peer({ iceServers: list.map((urls) => ({ urls })) })
      try {
        return await new Promise<{ result: string; candidates: string[] }>((resolve) => {
          const candidates: string[] = []
          const timer = setTimeout(() => resolve({ result: 'timeout', candidates }), timeout)
          peer.onicecandidate = (event) => {
            if (event.candidate) candidates.push(event.candidate.type ?? 'unknown')
            else {
              clearTimeout(timer)
              resolve({ result: 'complete', candidates })
            }
          }
          peer.createDataChannel('canary')
          peer
            .createOffer()
            .then((offer) => peer.setLocalDescription(offer))
            .catch(() => {
              clearTimeout(timer)
              resolve({ result: 'error', candidates })
            })
        })
      } finally {
        peer.close()
      }
    },
    servers,
    RENDER_LIMITS.probeTimeoutMs,
  )
}

/**
 * Positive proof that the dead proxy applies: in a context without interception, every probe
 * (fetch, WebSocket, navigation) to every sampled destination must fail with exactly
 * DEAD_PROXY_ERROR, and WebRTC must gather no candidate. Live TCP/UDP canaries on the worker's
 * addresses are a second signal: any byte or datagram means the browser has a network.
 */
export async function checkIsolation(
  browser: Browser,
  localAddress = '127.0.0.1',
  protocols: readonly ProbeProtocol[] = ['fetch', 'websocket', 'navigation', 'webrtc'],
  interfaces: readonly string[] = workerAddresses(),
): Promise<RenderStatus> {
  const checkedAt = new Date().toISOString()
  const version = (await browser.version()).slice(0, 100)
  const major = Number(/(?:Chrome|Chromium)\/(\d+)/.exec(version)?.[1])
  if (!major || major < MIN_CHROME_MAJOR) return { state: 'too-old', version, checkedAt }
  const reached = new Set<'tcp' | 'udp'>()
  const sockets = new Set<Socket>()
  const canaries: Canary[] = []
  const contexts: BrowserContext[] = []
  const open = async (): Promise<ProbePage> => {
    const context = await browser.createBrowserContext()
    contexts.push(context)
    const page = await context.newPage()
    page.on('error', () => {})
    const cdp = await page.createCDPSession()
    await cdp.send('Network.enable')
    // Local Network Access must not be what fails a probe: only the dead proxy may.
    await cdp
      .send('Browser.grantPermissions', {
        browserContextId: context.id,
        permissions: ['localNetwork', 'loopbackNetwork', 'localNetworkAccess'],
      })
      .catch(() => {})
    return { page, cdp }
  }
  const refuse = (state: 'has-network' | 'unsafe-configuration', detail: string) =>
    ({ state, version, checkedAt, detail: detail.slice(0, 200) }) satisfies RenderStatus
  const canaryReached = () =>
    reached.size
      ? refuse('has-network', `The live ${[...reached].sort().join('/')} canary was reached.`)
      : undefined
  const verdict = (
    protocol: string,
    outcomes: ReadonlyMap<string, ProbeOutcome | undefined>,
  ): RenderStatus | undefined => {
    const reachedStatus = canaryReached()
    if (reachedStatus) return reachedStatus
    const unproven = firstUnproven(outcomes)
    if (!unproven) return undefined
    return unproven.answered
      ? refuse('has-network', `A ${protocol} probe was answered: ${unproven.url}`)
      : refuse(
          'unsafe-configuration',
          `A ${protocol} probe did not fail at the blocking proxy (${unproven.reason}): ${unproven.url}`,
        )
  }
  try {
    for (const address of [...new Set([localAddress, '127.0.0.1', '::1'])]) {
      const canary = await openCanary(address, (protocol) => reached.add(protocol), sockets)
      if (canary) canaries.push(canary)
    }
    if (!canaries.some((canary) => canary.address === localAddress))
      throw new Error('Cannot bind canary')
    const origins = isolationProbeOrigins({ localAddress, canaries, interfaces })
    // Deliberately no interception and no page-controlled URL. A timeout is never isolation.
    if (protocols.includes('fetch')) {
      const result = verdict('fetch', await probeFetches(await open(), origins))
      if (result) return result
    }
    if (protocols.includes('websocket')) {
      const result = verdict('WebSocket', await probeWebSockets(open, origins))
      if (result) return result
    }
    if (protocols.includes('navigation')) {
      const sessions: CDPSession[] = []
      for (let n = 0; n < NAVIGATION_PAGES; n++) sessions.push((await open()).cdp)
      const result = verdict('navigation', await probeNavigations(sessions, origins))
      if (result) return result
    }
    if (protocols.includes('webrtc')) {
      const rtc = await probeWebRtc(
        (await open()).page,
        canaries.filter((canary) => canary.udp).map((c) => `stun:${origin(c.address, c.port)}`),
      )
      // Datagrams can trail ICE completion.
      await new Promise((resolve) => setTimeout(resolve, 100))
      const result = canaryReached()
      if (result) return result
      if (rtc.candidates.length || rtc.result !== 'complete')
        return refuse(
          'unsafe-configuration',
          rtc.candidates.length
            ? `WebRTC gathered ${rtc.candidates.join(', ')} candidates; non-proxied UDP is allowed.`
            : `WebRTC gathering did not complete (${rtc.result}); isolation is not proven.`,
        )
    }
    return canaryReached() ?? { state: 'ready', version, checkedAt }
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})))
    for (const socket of sockets) socket.destroy()
    await Promise.all(canaries.map(closeCanary))
  }
}
