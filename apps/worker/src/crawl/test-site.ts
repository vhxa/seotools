import type { FetchedResponse } from './fetcher'

/** For tests: a site whose pages have nothing wrong, and the helpers to write one. */

export const SITE = 'https://example.com'

export const SAFE_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy': "default-src 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
}

/** Words that depend on the seed, so that no two pages read alike unless a test wants them to. */
export function words(seed: string, count = 260): string {
  let state = [...seed].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7)
  const list: string[] = []
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    list.push(`w${(state >>> 8).toString(36)}`)
  }
  return list.join(' ')
}

export interface PageOptions {
  /** `null` leaves the tag out. */
  title?: string | null
  description?: string | null
  /** `null` leaves the tag out. */
  canonical?: string | null
  head?: string
  body?: string
  /** Replaces the whole text of the page. */
  text?: string
  h1?: string | null
  h2?: string | null
  links?: string
  headers?: Record<string, string>
  /** Replaces the Open Graph and Twitter tags. `null` leaves them out. */
  social?: string | null
  /** Replaces the `<html>` tag, e.g. to leave `lang` out. */
  html?: string
  /** Replaces the charset and viewport tags. */
  document?: string
}

/** A page with nothing wrong, unless the options say otherwise. */
export function page(path: string, options: PageOptions = {}): Partial<FetchedResponse> {
  const url = path.startsWith('http') ? path : `${SITE}${path}`
  const title =
    options.title === undefined ? `A good title for ${path} of this site` : options.title
  const description =
    options.description === undefined
      ? `A description of ${path} that is long enough to say something about what it holds, really.`
      : options.description
  const canonical = options.canonical === undefined ? url : options.canonical
  const h1 = options.h1 === undefined ? `The main heading of ${path}` : options.h1
  const h2 = options.h2 === undefined ? 'A second heading' : options.h2
  // The image is on another site, so the crawl does not request it.
  const social =
    options.social === undefined
      ? `<meta property="og:title" content="${title ?? 'A title'}">
      <meta property="og:type" content="website">
      <meta property="og:image" content="https://cdn.example.net/og.png">
      <meta property="og:url" content="${canonical ?? url}">
      <meta name="twitter:card" content="summary_large_image">`
      : (options.social ?? '')
  return {
    statusCode: 200,
    headers: { 'content-type': 'text/html', ...SAFE_HEADERS, ...options.headers },
    body: Buffer.from(`<!doctype html>${options.html ?? '<html lang="en">'}<head>
      ${options.document ?? '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'}
      ${social}
      ${title === null ? '' : `<title>${title}</title>`}
      ${description === null ? '' : `<meta name="description" content="${description}">`}
      ${canonical === null ? '' : `<link rel="canonical" href="${canonical}">`}
      <script type="application/ld+json">{"@type":"WebPage"}</script>
      ${options.head ?? ''}
    </head><body>
      ${h1 === null ? '' : `<h1>${h1}</h1>`}
      ${h2 === null ? '' : `<h2>${h2}</h2>`}
      <p>${options.text ?? words(path)}</p>
      ${options.links ?? `<a href="/">Back to the home page</a>`}
      ${options.body ?? ''}
    </body></html>`),
  }
}

export const sitemapOf = (paths: readonly string[], extra = '') =>
  `<?xml version="1.0"?><urlset xmlns:xhtml="http://www.w3.org/1999/xhtml">${paths
    .map(
      (path) =>
        `<url><loc>${path.startsWith('http') ? path : `${SITE}${path}`}</loc>${extra}</url>`,
    )
    .join('')}</urlset>`

export const xml = (body: string): Partial<FetchedResponse> => ({
  statusCode: 200,
  headers: { 'content-type': 'application/xml' },
  body: Buffer.from(body),
})
