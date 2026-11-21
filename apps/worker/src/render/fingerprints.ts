import { createHash } from 'node:crypto'
import type { FetchedResponse } from '../crawl/fetcher'
import { renderResponseHeaders } from './headers'

// Cache digests without retaining response bodies.
const answers = new WeakMap<FetchedResponse, string>()
const metadata = new WeakMap<FetchedResponse, string>()

// Capture browser inputs that can change parsing, redirects, framing or access to a response.
const browserEffectiveHeader =
  /^(?:access-control-|content-|cross-origin-|location$|refresh$|referrer-policy$|permissions-policy$|document-policy$|origin-agent-cluster$|timing-allow-origin$|link$|vary$|x-content-type-options$|x-frame-options$)/

export function responseFingerprint(response: FetchedResponse): string {
  const previous = answers.get(response)
  if (previous) return previous
  const hash = createHash('sha256')
  const headers = Object.entries(renderResponseHeaders(response.headers))
    .filter(([name]) => browserEffectiveHeader.test(name))
    .map(([name, value]) => [name, value.trim()])
    .sort()
  hash.update(JSON.stringify([response.statusCode, headers]))
  if (response.body) hash.update(response.body)
  const fingerprint = hash.digest('hex')
  answers.set(response, fingerprint)
  return fingerprint
}

// Transport encodings and Set-Cookie are stripped by renderResponseHeaders. Exclude dates,
// cache age/expiry, server timings and per-request tracing IDs from the diagnostic digest.
const volatileHeader =
  /^(?:date|age|expires|server-timing|(?:x-)?request-id|(?:x-)?correlation-id|traceparent|tracestate|cf-ray|x-amz-cf-id|x-amzn-requestid|x-amzn-trace-id|x-amz-request-id|x-vercel-id)$/

export function responseMetadataFingerprint(response: FetchedResponse): string {
  const previous = metadata.get(response)
  if (previous) return previous
  const headers = Object.entries(renderResponseHeaders(response.headers))
    .filter(([name]) => !volatileHeader.test(name))
    .map(([name, value]) => [name, value.trim()])
    .sort()
  const digest = fingerprint(JSON.stringify([response.statusCode, headers]))
  metadata.set(response, digest)
  return digest
}

export function fingerprintSet(values: Iterable<string>): string {
  return fingerprint(JSON.stringify([...values].sort()))
}

export function fingerprint(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
