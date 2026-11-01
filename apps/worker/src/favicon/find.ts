import type { FaviconImage } from '@seotools/db'
import { decodeText, type FetchedResponse, type Fetcher } from '../crawl/fetcher'
import { MAX_FAVICON_BYTES, sniffImage } from './image'
import { extractIconLinks } from './links'

export type FaviconSearch =
  | { kind: 'found'; icon: FaviconImage }
  /** The site answered and has no usable icon. */
  | { kind: 'none' }
  /** Not even that is known: the site, or the icon it declares, could not be reached. */
  | { kind: 'unreachable' }

const MAX_REDIRECTS = 5
const HTML = /^(text\/html|application\/xhtml\+xml)\b/i
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** Requests a URL and follows its redirects, which `Fetcher` leaves to the caller. */
async function getFollowingRedirects(
  fetcher: Fetcher,
  url: string,
  options: { signal: AbortSignal; readBody?: 'auto' | 'force'; maxBytes?: number },
): Promise<{ url: string; response: FetchedResponse }> {
  let current = url
  for (let hops = 0; ; hops++) {
    const response = await fetcher.fetch(current, options)
    const location = response.headers.location
    if (!REDIRECT_STATUSES.has(response.statusCode) || !location || hops >= MAX_REDIRECTS) {
      return { url: current, response }
    }
    try {
      const next = new URL(location, current)
      if (next.protocol !== 'http:' && next.protocol !== 'https:') return { url: current, response }
      current = next.href
    } catch {
      return { url: current, response }
    }
  }
}

/** The bytes of a `data:` URL (`data:image/png;base64,…` or percent-encoded text), if it has any. */
function decodeDataUrl(url: string): Buffer | null {
  const comma = url.indexOf(',')
  if (comma === -1) return null
  const isBase64 = /;base64$/i.test(url.slice(0, comma))
  const payload = url.slice(comma + 1)
  try {
    return isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload))
  } catch {
    return null
  }
}

const isSuccess = (response: FetchedResponse) =>
  response.statusCode >= 200 && response.statusCode < 300

/**
 * Looks for the icon of a site the way a browser would: the icons its home page declares, best
 * first, then `/favicon.ico`. Only bytes that really are an image count, whatever the server
 * says they are. The icons may live on another host (a CDN): they are assets the site itself
 * points at, requested through `fetcher`, which refuses non-public addresses.
 */
export async function findFavicon(input: {
  host: string
  fetcher: Fetcher
  signal: AbortSignal
}): Promise<FaviconSearch> {
  const { host, fetcher, signal } = input
  // Anything that is not the caller giving up means "could not reach it", not "has no icon".
  const rethrowIfAborted = (error: unknown) => {
    if (signal.aborted) throw error
  }

  let unreachable = false
  let page: { url: string; html: string } | null = null
  for (const start of [`https://${host}/`, `https://www.${host}/`, `http://${host}/`]) {
    try {
      const { url, response } = await getFollowingRedirects(fetcher, start, { signal })
      if (response.statusCode >= 500) unreachable = true
      const contentType = response.headers['content-type'] ?? ''
      if (isSuccess(response) && response.body && HTML.test(contentType)) {
        page = { url, html: decodeText(response.body, contentType) }
        break
      }
    } catch (error) {
      rethrowIfAborted(error)
      unreachable = true
    }
  }
  // A page is enough to tell what the site declares, however hard it was to get to.
  if (page) unreachable = false

  const origin = page ? new URL(page.url).origin : `https://${host}`
  const candidates = page ? extractIconLinks(page.html, page.url) : []
  candidates.push(`${origin}/favicon.ico`)
  if (!page) candidates.push(`https://www.${host}/favicon.ico`)

  for (const candidate of [...new Set(candidates)]) {
    let data: Buffer | null
    let sourceUrl: string
    if (candidate.startsWith('data:')) {
      data = decodeDataUrl(candidate)
      sourceUrl = 'data:'
    } else {
      try {
        const got = await getFollowingRedirects(fetcher, candidate, {
          signal,
          readBody: 'force',
          maxBytes: MAX_FAVICON_BYTES,
        })
        if (got.response.statusCode >= 500) unreachable = true
        // Too big to be an icon: `body` was cut, so it cannot be a valid image either.
        data = isSuccess(got.response) && !got.response.truncated ? got.response.body : null
        sourceUrl = got.url
      } catch (error) {
        rethrowIfAborted(error)
        unreachable = true
        continue
      }
    }
    if (!data || data.length === 0 || data.length > MAX_FAVICON_BYTES) continue
    const contentType = sniffImage(data)
    if (contentType) return { kind: 'found', icon: { contentType, data, sourceUrl } }
  }

  return { kind: unreachable ? 'unreachable' : 'none' }
}
