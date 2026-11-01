import type { DomainFavicon } from '@seotools/db'

/**
 * The HTTP response for a domain's icon. The sidebar asks for it as `…/favicon?v=<hash>`, so a
 * URL with the current hash never changes meaning and can be cached for good; without it (or
 * with a stale one) the browser has to check back, which `ETag` makes cheap.
 */
export function faviconResponse(favicon: DomainFavicon | null, request: Request): Response {
  if (!favicon) return new Response(null, { status: 404 })

  const etag = `"${favicon.hash}"`
  const versioned = new URL(request.url).searchParams.get('v') === favicon.hash
  const headers: Record<string, string> = {
    ETag: etag,
    // Private: the icon belongs to a domain that only signed-in users may see.
    'Cache-Control': versioned ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    'X-Content-Type-Options': 'nosniff',
    // The bytes come from a third-party site. If someone opens an SVG icon as a page, it must not
    // be able to run script with the app's origin; inside an <img> it never does.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  }

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(new Uint8Array(favicon.data), {
    headers: {
      ...headers,
      'Content-Type': favicon.contentType,
      'Content-Length': String(favicon.data.length),
    },
  })
}
