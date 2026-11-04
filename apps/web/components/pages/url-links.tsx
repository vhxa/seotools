import type { LinkDirection } from '@seotools/core/crawl/links'
import { UrlLinksPanel } from '@/components/pages/url-links-panel'
import type { UrlDetailData } from '@/lib/url-detail'
import { hrefPattern } from '@/lib/url-links'

/**
 * The incoming or the outgoing links of the URL in a detail, as a section of its own: what the
 * crawl stored, a page at a time, filtered and searched on the server. It opens on the first page
 * of navigation links that `data` carries, and the rest is read as it is asked for.
 *
 * It works the same in the drawer and on the page of a URL: `hrefFor` says where a linked URL's
 * detail opens in each.
 */
export function UrlLinks({
  host,
  data,
  direction,
  hrefFor,
}: {
  host: string
  data: UrlDetailData
  direction: LinkDirection
  hrefFor: (urlHash: string) => string
}) {
  return (
    <UrlLinksPanel
      // A different URL or crawl is a different list, not the same one with other props.
      key={`${data.crawl.id}:${data.url.urlHash}:${direction}`}
      host={host}
      crawlId={data.crawl.id}
      urlHash={data.url.urlHash}
      initial={data.links[direction]}
      hrefs={hrefPattern(hrefFor)}
      // A URL the crawl never read has no links of its own to give: that is not "none".
      read={data.url.kind !== 'unknown'}
      cutShort={data.crawl.status === 'incomplete'}
    />
  )
}
