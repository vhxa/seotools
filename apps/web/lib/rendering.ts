import type { Crawl } from '@seotools/db'

/** The crawl rendered its pages in a browser: the others only ever saw the served HTML. */
export const isRenderedCrawl = (crawl: Pick<Crawl, 'rendering'>) =>
  crawl.rendering?.mode === 'rendered'

/**
 * What a rendered crawl says of how many pages it saw completely (`rendersUnobserved`, `renderCoverage`
 * of the analysis). `null` when the crawl was not rendered, or was never analysed: nothing is then
 * known about coverage, which is not the same as every page being whole.
 */
export function renderCoverageOf(crawl: Pick<Crawl, 'rendering' | 'auditSnapshot'>) {
  if (!isRenderedCrawl(crawl)) return null
  const snapshot = crawl.auditSnapshot
  if (!snapshot || snapshot.rendering !== 'rendered' || snapshot.rendersUnobserved === undefined)
    return null
  return {
    unobserved: snapshot.rendersUnobserved,
    causes: snapshot.renderCoverage ?? null,
  }
}
