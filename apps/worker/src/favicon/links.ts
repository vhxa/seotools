import { Parser } from 'htmlparser2'

/** More than this many candidates is a page listing icons for every device ever made. */
const MAX_CANDIDATES = 6
/** What `<link rel="apple-touch-icon">` is when it declares no size. */
const APPLE_TOUCH_DEFAULT_SIZE = 180
const UNKNOWN_SIZE = 48
/** The sidebar draws icons at 20–32 CSS px, so 32 px is the smallest that is not blurry. */
const WANTED_SIZE = 32

interface IconLink {
  url: string
  rank: number
}

/** The largest side a `sizes` attribute declares, `'any'` for scalable icons, or `null`. */
function declaredSize(sizes: string | undefined): number | 'any' | null {
  let largest: number | null = null
  for (const token of (sizes ?? '').toLowerCase().split(/\s+/)) {
    if (token === 'any') return 'any'
    const match = /^(\d+)x(\d+)$/.exec(token)
    if (match) largest = Math.max(largest ?? 0, Number(match[1]), Number(match[2]))
  }
  return largest
}

/**
 * Lower is better. Scalable icons first (SVG is sharp at any size), then the smallest raster that
 * is still at least `WANTED_SIZE`, then smaller ones, which are blurry but still an icon.
 */
function rank(attributes: Record<string, string>, url: string, isAppleTouch: boolean): number {
  const size = declaredSize(attributes.sizes)
  const scalable =
    size === 'any' ||
    (attributes.type ?? '').toLowerCase() === 'image/svg+xml' ||
    /\.svg(?:[?#]|$)/i.test(url)
  if (scalable) return 0
  const pixels =
    typeof size === 'number' ? size : isAppleTouch ? APPLE_TOUCH_DEFAULT_SIZE : UNKNOWN_SIZE
  const base = pixels >= WANTED_SIZE ? pixels : 1000 + (WANTED_SIZE - pixels)
  // Between equals, the real favicon beats the one made for iOS home screens.
  return base + (isAppleTouch ? 0.5 : 0)
}

/**
 * The icons a page declares in `<link rel="icon">` (and the iOS `apple-touch-icon`), best first
 * and as absolute `http(s):` or `data:` URLs. `mask-icon` is left out: it is a one-colour glyph.
 */
export function extractIconLinks(html: string, pageUrl: string): string[] {
  let base = pageUrl
  let baseSet = false
  const links: IconLink[] = []

  const resolve = (href: string): string | null => {
    try {
      const url = new URL(href.trim(), base)
      return ['http:', 'https:', 'data:'].includes(url.protocol) ? url.href : null
    } catch {
      return null
    }
  }

  const parser = new Parser(
    {
      onopentag(rawName, attributes) {
        const name = rawName.toLowerCase()
        if (name === 'base' && !baseSet && attributes.href) {
          const resolved = resolve(attributes.href)
          if (resolved && !resolved.startsWith('data:')) {
            base = resolved
            baseSet = true
          }
          return
        }
        if (name !== 'link' || !attributes.href) return
        const rel = (attributes.rel ?? '').toLowerCase().split(/\s+/)
        const isAppleTouch =
          rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')
        if (!rel.includes('icon') && !isAppleTouch) return
        const url = resolve(attributes.href)
        if (url) links.push({ url, rank: rank(attributes, url, isAppleTouch) })
      },
    },
    { lowerCaseTags: true, lowerCaseAttributeNames: true },
  )
  parser.write(html)
  parser.end()

  // Stable sort: equally good icons keep the order the page lists them in.
  const urls = links.sort((a, b) => a.rank - b.rank).map((link) => link.url)
  return [...new Set(urls)].slice(0, MAX_CANDIDATES)
}
