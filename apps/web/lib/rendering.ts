import type { Crawl } from '@seotools/db'

/** The crawl rendered its pages in a browser: the others only ever saw the served HTML. */
export const isRenderedCrawl = (crawl: Pick<Crawl, 'rendering'>) =>
  crawl.rendering?.mode === 'rendered'

/**
 * What a rendered crawl says of how many pages it saw completely (`rendersUnobserved`, `renderCoverage`
 * of the analysis). `null` when the crawl was not rendered, or its analysis did not record it: nothing
 * is then known about coverage, which is not the same as every page being whole.
 */
export function renderCoverageOf(crawl: Pick<Crawl, 'rendering' | 'renderObservation'>) {
  if (!isRenderedCrawl(crawl) || !crawl.renderObservation) return null
  return { unobserved: crawl.renderObservation.unobserved, causes: crawl.renderObservation.causes }
}

/** Why the coverage of a rendered crawl is not known: it was never analysed, or the analysis left it out. */
export const coverageGapOf = (crawl: Pick<Crawl, 'auditVersion'>) =>
  crawl.auditVersion === null ? ('not-analysed' as const) : ('not-recorded' as const)
