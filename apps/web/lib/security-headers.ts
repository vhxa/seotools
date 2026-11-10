/**
 * The security headers of the app's own responses. Two kinds:
 * - `STATIC_SECURITY_HEADERS`: the same for every response, set in `next.config.ts` (static files
 *   included).
 * - `contentSecurityPolicy` and `STRICT_TRANSPORT_SECURITY`: decided per request in `proxy.ts`, since
 *   the policy carries a nonce and HSTS depends on the public address the app runs at, which is only
 *   known at run time (`BETTER_AUTH_URL`), not when the image is built.
 *
 * Pure, so the policy can be tested without a server.
 */

/** Never framed, never sniffed, no referrer leaking a URL's path to other sites, not indexed. */
export const STATIC_SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // `frame-ancestors 'none'` says the same to browsers that read the policy.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Features the app never uses.
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=(), interest-cohort=()',
  },
  // A private tool: no page of it belongs in a search engine (also `app/robots.ts` and the metadata).
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
]

/**
 * Two years; only ever sent when the app is served over HTTPS. Never `includeSubDomains`: that the
 * app is served over HTTPS says nothing about other services under its domain, which a browser
 * would then refuse to reach over HTTP.
 */
export const STRICT_TRANSPORT_SECURITY = 'max-age=63072000'

/** A fresh value for every response: what lets the app's own inline script run, and nothing else. */
export function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

/**
 * - Scripts: only those carrying the nonce (Next.js adds it to its own when it reads this policy
 *   from the request) and what they load (`strict-dynamic`). Development also needs `eval` for
 *   React's debugging tools.
 * - Styles: inline styles are allowed. Components set `style` attributes and the chart writes its
 *   colours in a `<style>` element; a nonce cannot cover attributes, and adding one would switch
 *   `'unsafe-inline'` off.
 * - Images: the app's own, `data:`/`blob:`, and any `https:` image, since pages show images of the
 *   sites being audited (an `og:image`). An image cannot run anything.
 * - Everything is fetched from the app itself; nothing may frame it, change its base URL or post a
 *   form elsewhere.
 */
export function contentSecurityPolicy(options: {
  nonce: string
  dev: boolean
  https: boolean
}): string {
  const { nonce, dev, https } = options
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    [
      'script-src',
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:', 'https:'],
    ['font-src', "'self'", 'data:'],
    // Hot reload talks over a WebSocket in development.
    ['connect-src', "'self'", ...(dev ? ['ws:', 'wss:'] : [])],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
    ['manifest-src', "'self'"],
    ['worker-src', "'self'", 'blob:'],
  ]
  if (https) directives.push(['upgrade-insecure-requests'])
  return directives.map((parts) => parts.join(' ')).join('; ')
}

/** Whether the public address of the app is HTTPS, which is when HSTS may be sent. */
export function servedOverHttps(publicUrl: string | undefined): boolean {
  if (!publicUrl) return false
  try {
    return new URL(publicUrl).protocol === 'https:'
  } catch {
    return false
  }
}
