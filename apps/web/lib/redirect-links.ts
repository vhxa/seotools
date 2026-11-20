import { linkKindsOf } from '@seotools/core/crawl/links'
import type { CrawlLinkRow } from '@seotools/db'
import type { LinkSource } from './url-links'

/**
 * The links a URL receives through other URLs that redirect to it. A link to `/a/` that redirects to
 * `/a` is not an incoming link of `/a` (it points at `/a/`), yet it is how people and crawlers get
 * there, so the detail lists them apart. Everything comes from the links the crawl stored: one
 * level (the URLs that redirect straight to this one), bounded, and never a link to this URL itself.
 */

/** Redirecting URLs listed at a time, and the links shown under each: the rest is in its own detail. */
export const REDIRECTING_PAGE_SIZE = 10
export const REDIRECT_LINKS_SHOWN = 5

export interface RedirectingUrl {
  url: string
  urlHash: string
  statusCode: number | null
  /** Links that point at this redirecting URL (the redirects that lead into it are not links). */
  links: number
  /** The first few of them. All of them are in the detail of the redirecting URL. */
  sources: CrawlLinkRow[]
}

export interface RedirectLinksPage {
  /** URLs of the crawl that redirect straight to this one. */
  total: number
  page: number
  pageCount: number
  items: RedirectingUrl[]
}

/** Every type of link but the redirect itself: a redirect is the step, not a link people follow. */
const LINK_KINDS = linkKindsOf('all').filter((kind) => kind !== 'redirect')

export const EMPTY_REDIRECT_LINKS: RedirectLinksPage = { total: 0, page: 1, pageCount: 1, items: [] }

export async function loadRedirectLinks(
  source: LinkSource,
  input: { crawlId: string; urlHash: string; page?: number },
): Promise<RedirectLinksPage> {
  const { crawlId, urlHash } = input
  const redirecting = { crawlId, urlHash, direction: 'in' as const, kinds: ['redirect' as const] }
  const total = await source.countLinks(redirecting)
  if (total === 0) return EMPTY_REDIRECT_LINKS
  const pageCount = Math.ceil(total / REDIRECTING_PAGE_SIZE)
  const asked = Number.isFinite(input.page) ? Math.trunc(input.page as number) : 1
  const page = Math.min(Math.max(1, asked), pageCount)
  const redirectors = await source.listLinks({
    ...redirecting,
    limit: REDIRECTING_PAGE_SIZE,
    offset: (page - 1) * REDIRECTING_PAGE_SIZE,
  })
  const items = await Promise.all(
    redirectors.map(async (redirector): Promise<RedirectingUrl> => {
      const query = {
        crawlId,
        urlHash: redirector.urlHash,
        direction: 'in' as const,
        kinds: LINK_KINDS,
      }
      const [links, sources] = await Promise.all([
        source.countLinks(query),
        source.listLinks({ ...query, limit: REDIRECT_LINKS_SHOWN, offset: 0 }),
      ])
      return {
        url: redirector.url,
        urlHash: redirector.urlHash,
        statusCode: redirector.statusCode,
        links,
        sources,
      }
    }),
  )
  return { total, page, pageCount, items }
}
