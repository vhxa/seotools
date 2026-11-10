import type { CrawlPageData } from '@seotools/core'

/** Where search engines tend to cut what they show of a title and a description. */
export const GOOGLE_TITLE_MAX = 60
export const GOOGLE_DESCRIPTION_MAX = 155
/** Longer paths do not fit in a result: the rest is left out, as it is there. */
const MAX_SEGMENTS = 4
const MAX_SEGMENT = 30

/** At most `max` characters, cut at the end with `…`; never longer than the text itself. */
export function cutNear(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}

/** The address as a result shows it: `example.com › blog › post`, as a host and its segments. */
export function breadcrumbsOf(address: string): { host: string; segments: string[] } {
  let parsed: URL
  try {
    parsed = new URL(address)
  } catch {
    return { host: address, segments: [] }
  }
  const all = parsed.pathname.split('/').filter(Boolean)
  const segments = all.slice(0, MAX_SEGMENTS).map((segment) => {
    let text = segment
    try {
      text = decodeURIComponent(segment)
    } catch {
      // Malformed escapes stay as the site wrote them.
    }
    return cutNear(text, MAX_SEGMENT)
  })
  return { host: parsed.host, segments: all.length > MAX_SEGMENTS ? [...segments, '…'] : segments }
}

/**
 * What the card can show of its image. A page served over HTTPS is not shown an `http:` image (the
 * app only loads images from `https:`), and anything that is not a web address is not an image.
 */
export type ShareImage =
  { kind: 'https'; url: string } | { kind: 'insecure'; url: string } | { kind: 'none' }

export function shareImageOf(address: string | undefined): ShareImage {
  if (!address) return { kind: 'none' }
  try {
    const { protocol } = new URL(address)
    if (protocol === 'https:') return { kind: 'https', url: address }
    if (protocol === 'http:') return { kind: 'insecure', url: address }
  } catch {
    // Not a URL.
  }
  return { kind: 'none' }
}

export interface SharePreview {
  /** What the page would be in a search result: `null` where it has no title or description. */
  google: { host: string; segments: string[]; title: string | null; description: string | null }
  /** `null`: the crawl did not look for the tags, so there is nothing to show (not "none"). */
  social: null | {
    /** The page has no Open Graph tag at all. */
    untagged: boolean
    card: string | null
    image: ShareImage
    title: string | null
    description: string | null
    host: string
    siteName: string | null
  }
}

/**
 * What the crawl stored of a page, as it would be in a search result and when it is shared. Only
 * what the page says: nothing is made up where it says nothing, and a crawl from before the tags
 * were kept has no social side at all.
 */
export function sharePreview(page: {
  url: string
  title: string | null
  data: Pick<CrawlPageData, 'description' | 'facts'> | null
}): SharePreview {
  const { host, segments } = breadcrumbsOf(page.url)
  const title = page.title?.trim() || null
  const description = page.data?.description?.trim() || null
  const social = page.data?.facts?.social
  return {
    google: {
      host,
      segments,
      title: title && cutNear(title, GOOGLE_TITLE_MAX),
      description: description && cutNear(description, GOOGLE_DESCRIPTION_MAX),
    },
    social: social
      ? {
          untagged: social.openGraphTags === 0,
          card: social.twitterCard ?? null,
          image: shareImageOf(social.image ?? social.twitterImage),
          title: social.title ?? social.twitterTitle ?? title,
          description: social.description ?? social.twitterDescription ?? description,
          host,
          siteName: social.siteName ?? null,
        }
      : null,
  }
}
