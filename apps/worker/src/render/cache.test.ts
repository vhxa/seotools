import { describe, expect, it, vi } from 'vitest'
import { FetchError, type FetchedResponse } from '../crawl/fetcher'
import { createRenderResourceCache } from './cache'
import { renderRequestHeaders, renderResponseHeaders } from './headers'
import { addSample, oneLine, RENDER_LIMITS } from './limits'

const answer: FetchedResponse = {
  statusCode: 200,
  headers: {},
  body: Buffer.alloc(100),
  bytes: 100,
  truncated: false,
  responseTimeMs: 0,
}
describe('render resource cache and boundaries', () => {
  it('caches only script/stylesheet GET, including failures and concurrent consumers', async () => {
    const cache = createRenderResourceCache()
    const load = vi.fn(async () => answer)
    await Promise.all([
      cache.request('a', 'GET', 'script', load),
      cache.request('a', 'GET', 'script', load),
    ])
    expect(load).toHaveBeenCalledTimes(1)
    for (const [method, type] of [
      ['POST', 'script'],
      ['GET', 'fetch'],
      ['GET', 'xhr'],
      ['GET', 'document'],
    ]) {
      await cache.request('a', method!, type!, load)
      await cache.request('a', method!, type!, load)
    }
    expect(load).toHaveBeenCalledTimes(9)
    const failure = vi.fn(async () => new FetchError('TIMEOUT', 'no answer'))
    await cache.request('bad', 'GET', 'stylesheet', failure)
    expect((await cache.request('bad', 'GET', 'stylesheet', failure)).cached).toBe(true)
    expect(failure).toHaveBeenCalledTimes(1)
  })
  it('evicts the least recently used answer and never exceeds its byte bound', async () => {
    const cache = createRenderResourceCache(500)
    for (const url of ['a', 'b', 'a', 'c'])
      await cache.request(url, 'GET', 'script', async () => answer)
    expect(cache.bytes).toBeLessThanOrEqual(500)
    expect((await cache.request('a', 'GET', 'script', async () => answer)).cached).toBe(true)
    expect((await cache.request('b', 'GET', 'script', async () => answer)).cached).toBe(false)
    const tiny = createRenderResourceCache(1)
    await tiny.request('large', 'GET', 'script', async () => answer)
    expect(tiny.bytes).toBe(0)
  })
  it('never forwards browser credentials and strips response transport/cookie headers', () => {
    expect(
      renderRequestHeaders({
        Accept: 'x',
        'Content-Type': 'json',
        cookie: 'secret',
        authorization: 'secret',
        host: 'internal',
        origin: 'https://site.test',
      }),
    ).toEqual({ accept: 'x', 'content-type': 'json', origin: 'https://site.test' })
    expect(
      renderResponseHeaders({
        'Set-Cookie': 'secret',
        'Content-Length': '123',
        'Content-Encoding': 'gzip',
        'Transfer-Encoding': 'chunked',
        Location: '/next',
        'Content-Type': 'text/javascript',
        'Access-Control-Allow-Origin': '*',
      }),
    ).toEqual({
      location: '/next',
      'content-type': 'text/javascript',
      'access-control-allow-origin': '*',
    })
  })
  it('keeps a deterministic bounded sample and one-line script errors', () => {
    const sample: string[] = []
    for (let n = 100; n >= 0; n--) addSample(sample, String(n).padStart(3, '0'), (x) => x)
    expect(sample).toHaveLength(RENDER_LIMITS.diagnosticItems)
    expect(sample[0]).toBe('000')
    expect(sample.at(-1)).toBe('049')
    expect(oneLine('\n\t' + 'x'.repeat(300))).toHaveLength(200)
    expect(oneLine('a\nb')).toBe('a b')
  })
})
