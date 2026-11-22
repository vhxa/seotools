import { expect, it } from 'vitest'
import { responseFingerprint, responseMetadataFingerprint } from './fingerprints'

const response = (headers: Record<string, string>, digest = responseFingerprint) =>
  digest({
    statusCode: 200,
    headers,
    body: Buffer.from('same body'),
    bytes: 9,
    truncated: false,
    responseTimeMs: 0,
  })

it.each([
  'content-security-policy',
  'access-control-allow-origin',
  'cross-origin-resource-policy',
  'x-content-type-options',
  'referrer-policy',
])('detects changes to browser-effective %s', (header) => {
  expect(response({ [header]: 'one' })).not.toBe(response({ [header]: 'two' }))
})

it('normalizes field names, order and outer whitespace, and ignores dates and stripped fields', () => {
  expect(
    response({
      'Content-Type': ' text/html ',
      'Content-Security-Policy': "default-src 'self'",
      Date: 'first',
      'Set-Cookie': 'first',
    }),
  ).toBe(
    response({
      'content-security-policy': "default-src 'self'",
      'content-type': 'text/html',
      date: 'second',
      'set-cookie': 'second',
    }),
  )
})

it('normalizes diagnostic metadata and ignores stripped fields and documented volatile values', () => {
  const digest = (headers: Record<string, string>) => response(headers, responseMetadataFingerprint)
  expect(
    digest({
      'X-Nav-Variant': ' A ',
      Date: 'first',
      Age: '10',
      Expires: 'first',
      'Set-Cookie': 'first',
      'X-Request-Id': 'first',
      'Server-Timing': 'first',
      'Cf-Ray': 'first',
    }),
  ).toBe(
    digest({
      'x-nav-variant': 'A',
      date: 'second',
      age: '20',
      expires: 'second',
      'set-cookie': 'second',
      'x-request-id': 'second',
      'server-timing': 'second',
      'cf-ray': 'second',
    }),
  )
  expect(digest({ 'x-nav-variant': 'A' })).not.toBe(digest({ 'x-nav-variant': 'B' }))
})
