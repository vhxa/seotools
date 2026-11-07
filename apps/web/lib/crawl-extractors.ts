import type { Extractor } from '@seotools/core/crawl/extraction'

/** The extractors as the settings form shows them, one per line (see `parseExtractors`). */
export const extractorsText = (extractors: readonly Extractor[]) =>
  extractors
    .map(({ name, selector, attribute }) =>
      [name, selector, ...(attribute ? [attribute] : [])].join(' | '),
    )
    .join('\n')
