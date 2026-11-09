import { describe, expect, it } from 'vitest'
import {
  STATIC_SECURITY_HEADERS,
  contentSecurityPolicy,
  createNonce,
  servedOverHttps,
} from './security-headers'

const directivesOf = (policy: string) =>
  new Map(
    policy.split('; ').map((directive) => {
      const [name = '', ...values] = directive.split(' ')
      return [name, values] as const
    }),
  )

describe('contentSecurityPolicy', () => {
  it('lets only scripts with the nonce run, and nothing frame the app', () => {
    const policy = directivesOf(contentSecurityPolicy({ nonce: 'abc', dev: false, https: false }))
    expect(policy.get('script-src')).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"])
    expect(policy.get('frame-ancestors')).toEqual(["'none'"])
    expect(policy.get('object-src')).toEqual(["'none'"])
    expect(policy.get('base-uri')).toEqual(["'self'"])
    expect(policy.get('form-action')).toEqual(["'self'"])
    expect(policy.has('upgrade-insecure-requests')).toBe(false)
  })

  it('never puts a nonce on styles, which would turn inline styles off', () => {
    const policy = directivesOf(contentSecurityPolicy({ nonce: 'abc', dev: false, https: true }))
    expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
  })

  it('shows images of audited sites over HTTPS', () => {
    const policy = directivesOf(contentSecurityPolicy({ nonce: 'abc', dev: false, https: true }))
    expect(policy.get('img-src')).toContain('https:')
    expect(policy.get('img-src')).not.toContain('http:')
  })

  it('allows eval and the hot reload socket only in development', () => {
    const production = directivesOf(contentSecurityPolicy({ nonce: 'a', dev: false, https: false }))
    const development = directivesOf(contentSecurityPolicy({ nonce: 'a', dev: true, https: false }))
    expect(production.get('script-src')).not.toContain("'unsafe-eval'")
    expect(production.get('connect-src')).toEqual(["'self'"])
    expect(development.get('script-src')).toContain("'unsafe-eval'")
    expect(development.get('connect-src')).toContain('ws:')
  })

  it('upgrades insecure requests only when the app is served over HTTPS', () => {
    const policy = contentSecurityPolicy({ nonce: 'a', dev: false, https: true })
    expect(directivesOf(policy).has('upgrade-insecure-requests')).toBe(true)
  })
})

describe('createNonce', () => {
  it('is new every time and safe inside a header', () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce))
    expect(nonces.size).toBe(50)
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
  })
})

describe('servedOverHttps', () => {
  it.each([
    ['https://seo.example.com', true],
    ['http://localhost:3000', false],
    [undefined, false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(servedOverHttps(url)).toBe(expected)
  })
})

describe('STATIC_SECURITY_HEADERS', () => {
  it('keeps the app out of frames, sniffing and search engines', () => {
    const headers = Object.fromEntries(
      STATIC_SECURITY_HEADERS.map(({ key, value }) => [key, value]),
    )
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['X-Robots-Tag']).toBe('noindex, nofollow')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
  })
})
