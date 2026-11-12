/**
 * The pure half of the URL rules (no Node imports), so client components can use it through the
 * subpath exports of `@seotools/core`. `url.ts` re-exports it next to the hash.
 */

/** Longer URLs are ignored: no real page needs them, and they would only bloat the database. */
export const MAX_CRAWL_URL_LENGTH = 8192

const DEFAULT_PORT = /^(|80|443)$/

/**
 * The form a URL is stored and compared in. Resolves it against `base`, drops the fragment and
 * lets WHATWG URL lowercase the scheme and host, strip default ports and percent-encode. The path
 * and query are kept as they are: `/a`, `/a/` and `/a?x=1` are different URLs to a search engine.
 *
 * Returns `null` for anything that cannot be requested over HTTP(S): `mailto:`, `tel:`,
 * `javascript:`, `data:`, URLs with credentials, malformed or oversized ones.
 */
export function normalizeCrawlUrl(input: string, base?: string): string | null {
  const value = input.trim()
  if (!value) return null
  let url: URL
  try {
    url = new URL(value, base)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  url.hash = ''
  const normalized = url.href
  return normalized.length <= MAX_CRAWL_URL_LENGTH ? normalized : null
}

/**
 * Whether a normalized URL belongs to the tracked domain: the host itself or its `www.` variant,
 * over HTTP or HTTPS on the default port. Other subdomains are tracked as domains of their own, so
 * they count as external here, and so does any other port.
 */
export function isInternalUrl(url: string, host: string): boolean {
  const parsed = new URL(url)
  if (!DEFAULT_PORT.test(parsed.port)) return false
  return parsed.hostname === host || parsed.hostname === `www.${host}`
}

/**
 * Turns what a user typed as a URL of the domain into its stored form, or `null` when it is not a
 * URL of this domain. A bare path or host is assumed to be HTTPS on the tracked host.
 */
export function parsePriorityUrl(input: string, host: string): string | null {
  const value = input.trim()
  if (!value) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value)
    ? value
    : value.startsWith('/')
      ? `https://${host}${value}`
      : `https://${value}`
  const url = normalizeCrawlUrl(withScheme)
  return url && isInternalUrl(url, host) ? url : null
}

/** Names are decoded like URLSearchParams; retained query bytes and their order stay unchanged. */
export function matchesIgnoredParameter(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
  )
}

/** Apply only to internal URLs at the crawl boundary; external addresses remain as written. */
export function stripIgnoredParameters(
  url: string,
  patterns: readonly string[],
  host?: string,
): string {
  if (!patterns.length || (host !== undefined && !isInternalUrl(url, host))) return url
  const question = url.indexOf('?')
  if (question < 0) return url
  let removed = false
  const kept = url
    .slice(question + 1)
    .split('&')
    .filter((part) => {
      const name = new URLSearchParams(part).keys().next().value
      const keep = name === undefined || !matchesIgnoredParameter(name, patterns)
      if (!keep) removed = true
      return keep
    })
    .join('&')
  return removed ? url.slice(0, question) + (kept ? `?${kept}` : '') : url
}
