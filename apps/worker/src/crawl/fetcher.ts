import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate, gunzipSync } from 'node:zlib'
import { pipeline, type Readable } from 'node:stream'

/** Largest body read, after decompression. A page cut here is flagged as truncated. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024
/** Sitemaps may legally be 50 MB uncompressed. */
export const MAX_SITEMAP_BYTES = 64 * 1024 * 1024

export interface FetchedResponse {
  statusCode: number
  /** Lowercase names. Repeated headers are joined with `, ` by Node. */
  headers: Record<string, string>
  /** `null` when the body was not read: everything but text formats we parse, unless forced. */
  body: Buffer | null
  truncated: boolean
  bytes: number | null
  responseTimeMs: number
}

export class FetchError extends Error {
  override name = 'FetchError'
  constructor(
    /** Node's error code (`ENOTFOUND`, `CERT_HAS_EXPIRED`…), `TIMEOUT` or `BLOCKED_ADDRESS`. */
    readonly code: string,
    message: string,
    /** How long the attempt took. */
    readonly responseTimeMs: number | null = null,
  ) {
    super(message)
  }
}

export interface Fetcher {
  fetch(
    url: string,
    options: { signal: AbortSignal; readBody?: 'auto' | 'force' },
  ): Promise<FetchedResponse>
  close(): void
}

export interface FetcherConfig {
  userAgent: string
  timeoutMs: number
  concurrency: number
  allowPrivateNetworks: boolean
}

const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, including the cloud metadata service
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64: wraps an IPv4 address
  ['100::', 64],
  ['2001::', 32], // Teredo
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6')
}

/** Whether an IP is loopback, private, link-local or otherwise not a public address. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return true
  // IPv4-mapped IPv6 addresses (`::ffff:127.0.0.1`) are checked against the IPv4 rules.
  return blocked.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

const BLOCKED_ADDRESS = 'BLOCKED_ADDRESS'

/**
 * DNS lookup that refuses non-public addresses. It runs when the socket connects, on the address
 * actually used, so a domain cannot pass a check and then rebind to an internal IP.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, '', 0)
    const refused = addresses.find(({ address }) => isBlockedAddress(address))
    if (refused) {
      const blockedError: NodeJS.ErrnoException = new Error(
        `${hostname} resolves to a non-public address (${refused.address})`,
      )
      blockedError.code = BLOCKED_ADDRESS
      return callback(blockedError, '', 0)
    }
    if (options.all) return callback(null, addresses)
    const [first] = addresses
    if (!first) return callback(new Error(`No addresses for ${hostname}`), '', 0)
    callback(null, first.address, first.family)
  })
}

const TEXT_CONTENT = /^(text\/(html|css|plain|xml)|application\/(xhtml\+xml|xml|[\w.+-]*\+xml))\b/i

function decompressor(contentEncoding: string | undefined) {
  switch ((contentEncoding ?? '').toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return createGunzip()
    case 'deflate':
      return createInflate()
    case 'br':
      return createBrotliDecompress()
    default:
      return null
  }
}

function decompressed(response: http.IncomingMessage): Readable {
  const decoder = decompressor(response.headers['content-encoding'])
  if (!decoder) return response
  // `pipeline`, not `pipe`: a connection that dies must also end the decoder being read from.
  return pipeline(response, decoder, () => {})
}

/** Reads a stream up to `limit` bytes, so that a decompression bomb cannot exhaust the memory. */
async function readLimited(stream: Readable, limit: number) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const room = limit - size
    if (chunk.length >= room) {
      if (room > 0) chunks.push(chunk.subarray(0, room))
      return { body: Buffer.concat(chunks), truncated: true }
    }
    chunks.push(chunk)
    size += chunk.length
  }
  return { body: Buffer.concat(chunks), truncated: false }
}

function flatten(headers: http.IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) flat[name] = Array.isArray(value) ? value.join(', ') : value
  }
  return flat
}

/**
 * Requests one URL and returns exactly what it answered: redirects are not followed, since each
 * hop is a URL of the crawl with a result of its own. Bodies of binary formats are not downloaded.
 */
export function createHttpFetcher(config: FetcherConfig): Fetcher {
  const agentOptions = { keepAlive: true, maxSockets: config.concurrency }
  const httpAgent = new http.Agent(agentOptions)
  const httpsAgent = new https.Agent(agentOptions)

  return {
    close() {
      httpAgent.destroy()
      httpsAgent.destroy()
    },

    async fetch(url, { signal, readBody = 'auto' }) {
      const started = Date.now()
      const elapsed = () => Date.now() - started
      const { hostname, protocol } = new URL(url)
      const literal = hostname.replace(/^\[|\]$/g, '')
      if (!config.allowPrivateNetworks && isIP(literal) && isBlockedAddress(literal)) {
        throw new FetchError(BLOCKED_ADDRESS, `${hostname} is not a public address`, 0)
      }

      const deadline = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)])
      const client = protocol === 'https:' ? https : http
      try {
        return await new Promise<FetchedResponse>((resolve, reject) => {
          const request = client.get(
            url,
            {
              agent: protocol === 'https:' ? httpsAgent : httpAgent,
              signal: deadline,
              ...(config.allowPrivateNetworks ? {} : { lookup: guardedLookup }),
              headers: {
                'User-Agent': config.userAgent,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
              },
            },
            (response) => {
              const headers = flatten(response.headers)
              const declared = Number(headers['content-length'])
              const statusCode = response.statusCode ?? 0
              const finish = (body: Buffer | null, truncated: boolean) =>
                resolve({
                  statusCode,
                  headers,
                  body,
                  truncated,
                  bytes: body ? body.length : Number.isFinite(declared) ? declared : null,
                  responseTimeMs: elapsed(),
                })

              const contentType = headers['content-type'] ?? ''
              if (readBody !== 'force' && !TEXT_CONTENT.test(contentType)) {
                response.destroy()
                return finish(null, false)
              }
              const limit = readBody === 'force' ? MAX_SITEMAP_BYTES : MAX_BODY_BYTES
              readLimited(decompressed(response), limit)
                .then(({ body, truncated }) => {
                  if (truncated) response.destroy()
                  finish(body, truncated)
                })
                .catch(reject)
            },
          )
          request.on('error', reject)
        })
      } catch (error) {
        if (signal.aborted) throw error
        if (deadline.aborted) {
          throw new FetchError('TIMEOUT', `No answer within ${config.timeoutMs} ms`, elapsed())
        }
        const { code, message } = error as NodeJS.ErrnoException
        throw new FetchError(code ?? 'FETCH_FAILED', message, elapsed())
      }
    },
  }
}

const GZIP_MAGIC = [0x1f, 0x8b]

/** Decodes a sitemap, which may be a `.gz` file served without a `Content-Encoding` header. */
export function decodeSitemapBody(body: Buffer): string {
  if (body[0] === GZIP_MAGIC[0] && body[1] === GZIP_MAGIC[1]) {
    return gunzipSync(body, { maxOutputLength: MAX_SITEMAP_BYTES }).toString('utf8')
  }
  return body.toString('utf8')
}

/** Decodes text using the charset of the `Content-Type` or the document itself, or else UTF-8. */
export function decodeText(body: Buffer, contentType: string | undefined): string {
  const declared =
    /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? '')?.[1] ??
    /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(body.subarray(0, 2048).toString('latin1'))?.[1]
  try {
    return new TextDecoder(declared ?? 'utf-8').decode(body)
  } catch {
    return new TextDecoder('utf-8').decode(body)
  }
}
