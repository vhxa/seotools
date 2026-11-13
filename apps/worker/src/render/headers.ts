/** The crawl's UA and site-only credentials come from its fetcher, never from the browser. */
const allowed = new Set([
  'accept',
  'accept-language',
  'content-type',
  'origin',
  'referer',
  'access-control-request-method',
  'access-control-request-headers',
  'x-requested-with',
])
const removed = new Set(['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding'])

export function renderRequestHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => allowed.has(name.toLowerCase()))
      .map(([name, value]) => [name.toLowerCase(), value]),
  )
}
export function renderResponseHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => !removed.has(name.toLowerCase()))
      .map(([name, value]) => [name.toLowerCase(), value]),
  )
}
