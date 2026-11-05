/**
 * Turning what crawls stored about a URL into the evidence findings are classified from. The
 * classification itself, and this glue, live in `@seotools/core/crawl/compare`, shared with the
 * worker, which sends alerts about the same changes.
 */
export {
  evidenceOf,
  findingChangesBetween,
  indexTraces,
  urlEvidenceOf,
} from '@seotools/core/crawl/compare'
