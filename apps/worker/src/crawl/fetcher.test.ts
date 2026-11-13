import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  FetchError,
  MAX_BODY_BYTES,
  createHttpFetcher,
  decodeSitemapBody,
  decodeText,
  isBlockedAddress,
} from './fetcher'

let server: http.Server
let origin: string
let lastHeaders: http.IncomingHttpHeaders

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastHeaders = req.headers
    switch (req.url) {
      case '/echo': {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/javascript', 'X-Method': req.method })
          res.end(Buffer.concat(chunks))
        })
        return
      }
      case '/html':
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Robots-Tag': 'noindex',
        })
        return res.end('<title>hi</title>')
      case '/gzip':
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' })
        return res.end(gzipSync('<title>compressed</title>'))
      case '/redirect':
        res.writeHead(301, { Location: '/html' })
        return res.end()
      case '/image':
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(5_000_000) })
        return res.write(Buffer.alloc(1024))
      case '/huge':
        res.writeHead(200, { 'Content-Type': 'text/html' })
        for (let i = 0; i < 12; i++) res.write(Buffer.alloc(1024 * 1024, 'a'))
        return res.end()
      case '/bomb':
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' })
        return res.end(gzipSync(Buffer.alloc(MAX_BODY_BYTES * 2)))
      case '/slow':
        return // never answers
      case '/dies':
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' })
        res.write(gzipSync('<title>partial</title>').subarray(0, 8))
        setTimeout(() => res.destroy(), 10)
        return
      default:
        res.writeHead(404, { 'Content-Type': 'text/html' })
        return res.end('missing')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.closeAllConnections()
  server.close()
})

const fetcher = (overrides = {}) =>
  createHttpFetcher({
    userAgent: 'TestBot/1.0',
    timeoutMs: 2000,
    concurrency: 2,
    allowPrivateNetworks: true,
    ...overrides,
  })
const { signal } = new AbortController()

describe('createHttpFetcher', () => {
  it('forwards bounded render methods, bodies and allowed headers and force-reads script responses', async () => {
    const f = fetcher()
    try {
      const response = await f.fetch(`${origin}/echo`, {
        signal,
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://site.test' },
        body: Buffer.from('{"query":"x"}'),
        readBody: 'force',
        maxBytes: 5,
      })
      expect(response.headers['x-method']).toBe('POST')
      expect(response.body?.toString()).toBe('{"que')
      expect(response.truncated).toBe(true)
      expect(lastHeaders.origin).toBe('https://site.test')
      await expect(
        f.fetch(`${origin}/echo`, { signal, method: 'POST', body: Buffer.alloc(1024 * 1024 + 1) }),
      ).rejects.toMatchObject({ code: 'BODY_LIMIT' })
      const preflight = await f.fetch(`${origin}/echo`, {
        signal,
        method: 'OPTIONS',
        readBody: 'force',
      })
      expect(preflight.headers['x-method']).toBe('OPTIONS')
    } finally {
      f.close()
    }
  })
  it('returns the response, sending the configured User-Agent', async () => {
    const f = fetcher()
    const response = await f.fetch(`${origin}/html`, { signal })
    f.close()
    expect(response).toMatchObject({ statusCode: 200, truncated: false })
    expect(response.headers['x-robots-tag']).toBe('noindex')
    expect(response.body?.toString()).toBe('<title>hi</title>')
    expect(response.bytes).toBe(17)
    expect(lastHeaders['user-agent']).toBe('TestBot/1.0')
  })

  it('reports error statuses as responses, not failures', async () => {
    const f = fetcher()
    expect((await f.fetch(`${origin}/nope`, { signal })).statusCode).toBe(404)
    f.close()
  })

  it('decompresses', async () => {
    const f = fetcher()
    const response = await f.fetch(`${origin}/gzip`, { signal })
    f.close()
    expect(response.body?.toString()).toBe('<title>compressed</title>')
  })

  it('does not follow redirects', async () => {
    const f = fetcher()
    const response = await f.fetch(`${origin}/redirect`, { signal })
    f.close()
    expect(response.statusCode).toBe(301)
    expect(response.headers.location).toBe('/html')
  })

  it('does not download binary files, but knows their size', async () => {
    const f = fetcher()
    const response = await f.fetch(`${origin}/image`, { signal })
    f.close()
    expect(response.body).toBeNull()
    expect(response.bytes).toBe(5_000_000)
  })

  it('downloads binary files when forced', async () => {
    const f = fetcher()
    const response = await f.fetch(`${origin}/html`, { signal, readBody: 'force' })
    f.close()
    expect(response.body).not.toBeNull()
  })

  it('cuts oversized bodies and decompression bombs', async () => {
    const f = fetcher({ timeoutMs: 10_000 })
    for (const path of ['/huge', '/bomb']) {
      const response = await f.fetch(`${origin}${path}`, { signal })
      expect(response.truncated).toBe(true)
      expect(response.body?.length).toBe(MAX_BODY_BYTES)
    }
    f.close()
  })

  it('cuts the body at a smaller limit when asked to', async () => {
    const f = fetcher({ timeoutMs: 10_000 })
    const response = await f.fetch(`${origin}/huge`, { signal, readBody: 'force', maxBytes: 4096 })
    f.close()
    expect(response.truncated).toBe(true)
    expect(response.body?.length).toBe(4096)
  })

  it('gives up after the timeout', async () => {
    const f = fetcher({ timeoutMs: 50 })
    await expect(f.fetch(`${origin}/slow`, { signal })).rejects.toMatchObject({
      name: 'FetchError',
      code: 'TIMEOUT',
    })
    f.close()
  })

  it('does not hang when a compressed response dies halfway', async () => {
    const f = fetcher({ timeoutMs: 1000 })
    await expect(f.fetch(`${origin}/dies`, { signal })).rejects.toBeInstanceOf(FetchError)
    f.close()
  })

  it('stops at once when aborted, without calling it a failure of the site', async () => {
    const f = fetcher({ timeoutMs: 10_000 })
    const controller = new AbortController()
    const request = f.fetch(`${origin}/slow`, { signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    const error = await request.catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(FetchError)
    f.close()
  })

  it('reports connection failures with their code', async () => {
    const f = fetcher()
    await expect(f.fetch('http://127.0.0.1:1/', { signal })).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    })
    f.close()
  })
})

describe('SSRF protection', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    'not an ip',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false)
    },
  )

  it('refuses a hostname that resolves to loopback', async () => {
    const f = fetcher({ allowPrivateNetworks: false })
    const { port } = new URL(origin)
    await expect(f.fetch(`http://localhost:${port}/html`, { signal })).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    })
    f.close()
  })

  it('refuses a literal private IP', async () => {
    const f = fetcher({ allowPrivateNetworks: false })
    await expect(f.fetch(`${origin}/html`, { signal })).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    })
    await expect(f.fetch('http://[::1]/', { signal })).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    })
    f.close()
  })

  it('lets through private addresses when the instance allows them', async () => {
    const f = fetcher({ allowPrivateNetworks: true })
    expect((await f.fetch(`${origin}/html`, { signal })).statusCode).toBe(200)
    f.close()
  })
})

describe('decoding', () => {
  it('decodes gzipped sitemaps with or without a Content-Encoding header', () => {
    expect(decodeSitemapBody(gzipSync('<urlset/>'))).toBe('<urlset/>')
    expect(decodeSitemapBody(Buffer.from('<urlset/>'))).toBe('<urlset/>')
  })

  it('honours the charset of the header, then of the document', () => {
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9])
    expect(decodeText(latin1, 'text/html; charset=iso-8859-1')).toBe('café')
    const inDocument = Buffer.concat([Buffer.from('<meta charset="iso-8859-1">'), latin1])
    expect(decodeText(inDocument, 'text/html')).toContain('café')
    expect(decodeText(Buffer.from('café'), 'text/html')).toBe('café')
    expect(decodeText(Buffer.from('café'), 'text/html; charset=nonsense')).toBe('café')
  })
})

it('never sends site credentials on non-site requests, including non-default ports', async () => {
  const f = fetcher({
    siteHeaders: {
      host: '127.0.0.1',
      headers: { authorization: 'secret', cookie: 'secret', 'x-stage': 'secret' },
    },
  })
  try {
    await f.fetch(`${origin}/redirect`, { signal })
    expect(lastHeaders.authorization).toBeUndefined()
    expect(lastHeaders.cookie).toBeUndefined()
    expect(lastHeaders['x-stage']).toBeUndefined()
  } finally {
    f.close()
  }
})
