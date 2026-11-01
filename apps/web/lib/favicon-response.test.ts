import type { DomainFavicon } from '@seotools/db'
import { describe, expect, it } from 'vitest'
import { faviconResponse } from './favicon-response'

const favicon: DomainFavicon = {
  domainId: 'd1',
  contentType: 'image/png',
  data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  hash: 'abc123',
  sourceUrl: 'https://example.com/icon.png',
}
const request = (query = '', headers: Record<string, string> = {}) =>
  new Request(`http://localhost/domains/example.com/favicon${query}`, { headers })

describe('faviconResponse', () => {
  it('is a 404 when the domain has no icon, so the sidebar falls back to its own', () => {
    expect(faviconResponse(null, request()).status).toBe(404)
  })

  it('sends the bytes with their type', async () => {
    const response = faviconResponse(favicon, request())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe('4')
    expect(Buffer.from(await response.arrayBuffer()).equals(favicon.data)).toBe(true)
  })

  it('caches forever only under the URL that carries the current hash', () => {
    expect(faviconResponse(favicon, request('?v=abc123')).headers.get('cache-control')).toBe(
      'private, max-age=31536000, immutable',
    )
    for (const query of ['', '?v=old', '?v=']) {
      expect(faviconResponse(favicon, request(query)).headers.get('cache-control')).toBe(
        'private, no-cache',
      )
    }
  })

  it('answers 304 to a browser that already has this version', () => {
    const response = faviconResponse(favicon, request('', { 'if-none-match': '"abc123"' }))
    expect(response.status).toBe(304)
    expect(response.headers.get('etag')).toBe('"abc123"')
    const stale = faviconResponse(favicon, request('', { 'if-none-match': '"old"' }))
    expect(stale.status).toBe(200)
  })

  it('keeps an icon from a third-party site from running script as the app', () => {
    const svg = { ...favicon, contentType: 'image/svg+xml', data: Buffer.from('<svg/>') }
    const headers = faviconResponse(svg, request()).headers
    expect(headers.get('content-security-policy')).toContain('sandbox')
    expect(headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(headers.get('x-content-type-options')).toBe('nosniff')
  })
})
