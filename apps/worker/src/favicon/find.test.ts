import { describe, expect, it } from 'vitest'
import { FetchError, type FetchedResponse, type Fetcher } from '../crawl/fetcher'
import { findFavicon } from './find'
import { MAX_FAVICON_BYTES } from './image'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const ICO = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0])

type Route = Partial<FetchedResponse> | Error

function reply(statusCode: number, body: string | Buffer | null, headers = {}): Route {
  return { statusCode, body: typeof body === 'string' ? Buffer.from(body) : body, headers }
}
const html = (head: string) =>
  reply(200, `<html><head>${head}</head></html>`, { 'content-type': 'text/html; charset=utf-8' })
const image = (data: Buffer, type = 'image/png') => reply(200, data, { 'content-type': type })
const redirect = (to: string) => reply(301, null, { location: to })

/** A fetcher answering from a table of URLs; anything not listed is a 404. */
function fakeFetcher(routes: Record<string, Route>) {
  const requested: string[] = []
  const fetcher: Fetcher = {
    close() {},
    async fetch(url, options) {
      requested.push(url)
      const route = routes[url] ?? reply(404, 'missing', { 'content-type': 'text/html' })
      if (route instanceof Error) throw route
      return {
        statusCode: 200,
        headers: {},
        body: null,
        truncated: false,
        bytes: null,
        responseTimeMs: 1,
        ...route,
        // Like the real one, never hand back more than was asked for.
        ...(route.body && options.maxBytes && route.body.length > options.maxBytes
          ? { body: route.body.subarray(0, options.maxBytes), truncated: true }
          : {}),
      }
    },
  }
  return { fetcher, requested }
}

const find = (routes: Record<string, Route>, signal = new AbortController().signal) => {
  const { fetcher, requested } = fakeFetcher(routes)
  return findFavicon({ host: 'example.com', fetcher, signal }).then((result) => ({
    result,
    requested,
  }))
}

describe('findFavicon', () => {
  it('uses the icon the home page declares, after the redirects to get there', async () => {
    const { result } = await find({
      'https://example.com/': redirect('https://www.example.com/'),
      'https://www.example.com/': html('<link rel="icon" href="/static/icon.png">'),
      'https://www.example.com/static/icon.png': redirect('/static/icon-v2.png'),
      'https://www.example.com/static/icon-v2.png': image(PNG),
    })
    expect(result).toEqual({
      kind: 'found',
      icon: {
        contentType: 'image/png',
        data: PNG,
        sourceUrl: 'https://www.example.com/static/icon-v2.png',
      },
    })
  })

  it('falls back to /favicon.ico when the page declares no icon', async () => {
    const { result } = await find({
      'https://example.com/': html('<title>No icon</title>'),
      'https://example.com/favicon.ico': image(ICO, 'image/vnd.microsoft.icon'),
    })
    expect(result).toMatchObject({
      kind: 'found',
      icon: { contentType: 'image/x-icon', sourceUrl: 'https://example.com/favicon.ico' },
    })
  })

  it('judges by the bytes: a "404 page" answered with 200 is skipped, a mislabelled icon is not', async () => {
    const { result } = await find({
      'https://example.com/': html(
        '<link rel="icon" sizes="32x32" href="/soft-404.png"><link rel="icon" sizes="64x64" href="/mislabelled.png">',
      ),
      'https://example.com/soft-404.png': html('<h1>Not found</h1>'),
      'https://example.com/mislabelled.png': image(PNG, 'text/html'),
    })
    expect(result).toMatchObject({
      kind: 'found',
      icon: { contentType: 'image/png', sourceUrl: 'https://example.com/mislabelled.png' },
    })
  })

  it('follows an icon hosted elsewhere, such as a CDN', async () => {
    const { result } = await find({
      'https://example.com/': html('<link rel="icon" href="https://cdn.example.net/i.png">'),
      'https://cdn.example.net/i.png': image(PNG),
    })
    expect(result).toMatchObject({
      kind: 'found',
      icon: { sourceUrl: 'https://cdn.example.net/i.png' },
    })
  })

  it('reads an icon embedded in the page', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'
    const { result, requested } = await find({
      'https://example.com/': html(
        `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg)}">`,
      ),
    })
    expect(result).toMatchObject({
      kind: 'found',
      icon: { contentType: 'image/svg+xml', sourceUrl: 'data:' },
    })
    if (result.kind === 'found') expect(result.icon.data.toString()).toBe(svg)
    expect(requested).toEqual(['https://example.com/'])
  })

  it('falls back to the www variant, then to plain HTTP, to read the page', async () => {
    const www = await find({
      'https://www.example.com/': html('<link rel="icon" href="/a.png">'),
      'https://www.example.com/a.png': image(PNG),
    })
    expect(www.result.kind).toBe('found')
    const http = await find({
      'https://example.com/': new FetchError('ECONNREFUSED', 'refused'),
      'http://example.com/': html('<link rel="icon" href="/a.png">'),
      'http://example.com/a.png': image(PNG),
    })
    expect(http.result).toMatchObject({
      kind: 'found',
      icon: { sourceUrl: 'http://example.com/a.png' },
    })
  })

  it('still tries /favicon.ico when the home page refuses to answer', async () => {
    const { result } = await find({
      'https://example.com/': reply(403, 'blocked', { 'content-type': 'text/html' }),
      'https://example.com/favicon.ico': image(ICO),
    })
    expect(result.kind).toBe('found')
  })

  it('goes on to the next icon when one cannot be fetched', async () => {
    const { result } = await find({
      'https://example.com/': html(
        '<link rel="icon" sizes="32x32" href="/down.png"><link rel="icon" sizes="64x64" href="/ok.png">',
      ),
      'https://example.com/down.png': new FetchError('ECONNRESET', 'reset'),
      'https://example.com/ok.png': image(PNG),
    })
    expect(result.kind).toBe('found')
  })

  it('ignores icons too large to be favicons', async () => {
    const { result } = await find({
      'https://example.com/': html('<link rel="icon" href="/huge.png">'),
      'https://example.com/huge.png': image(Buffer.concat([PNG, Buffer.alloc(MAX_FAVICON_BYTES)])),
    })
    expect(result).toEqual({ kind: 'none' })
  })

  it('says the site has none only when it answered and has none', async () => {
    const none = await find({ 'https://example.com/': html('<title>x</title>') })
    expect(none.result).toEqual({ kind: 'none' })
  })

  it('says it could not tell when the site cannot be reached, or fails', async () => {
    const down = new FetchError('ECONNREFUSED', 'refused')
    const unreachable = await find({
      'https://example.com/': down,
      'https://www.example.com/': down,
      'http://example.com/': down,
      'https://example.com/favicon.ico': down,
      'https://www.example.com/favicon.ico': down,
    })
    expect(unreachable.result).toEqual({ kind: 'unreachable' })

    // The page loads, but the icon it points at is failing and the fallback has nothing.
    const failing = await find({
      'https://example.com/': html('<link rel="icon" href="/i.png">'),
      'https://example.com/i.png': reply(503, 'busy'),
    })
    expect(failing.result).toEqual({ kind: 'unreachable' })
  })

  it('does not follow redirects forever', async () => {
    const { result, requested } = await find({
      'https://example.com/': html('<link rel="icon" href="/loop">'),
      'https://example.com/loop': redirect('/loop'),
    })
    expect(result).toEqual({ kind: 'none' })
    expect(requested.filter((url) => url.endsWith('/loop'))).toHaveLength(6)
  })

  it('does not follow a redirect to something other than http(s)', async () => {
    const { result } = await find({
      'https://example.com/': html('<link rel="icon" href="/i.png">'),
      'https://example.com/i.png': redirect('file:///etc/passwd'),
    })
    expect(result).toEqual({ kind: 'none' })
  })

  it('stops when the worker is shutting down instead of calling it unreachable', async () => {
    const controller = new AbortController()
    controller.abort()
    const abort = new DOMException('aborted', 'AbortError')
    await expect(find({ 'https://example.com/': abort }, controller.signal)).rejects.toBe(abort)
  })
})
