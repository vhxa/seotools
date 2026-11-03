import { assessPair, type FindingChange, type PairAssessment } from '@seotools/core/crawl/compare'
import type {
  Crawl,
  CrawlComparisonCounts,
  CrawlRepository,
  CrawlUrlComparison,
} from '@seotools/db'
import { COMPARE_PAGE_SIZE, isFindingChange, type CompareQuery } from './compare-query'
import { evidenceOf, findingChangesBetween, indexTraces } from './crawl-evidence'

export type ComparisonSource = Pick<
  CrawlRepository,
  'compareCounts' | 'countCompared' | 'compareUrls' | 'urlHistory'
>

export interface ComparisonRow extends CrawlUrlComparison {
  /**
   * How the findings of the URL changed, for the changes that list findings. `null`: the crawls
   * cannot be compared on findings at all (see `assessment`).
   */
  findings: FindingChange[] | null
}

export interface ComparisonData {
  assessment: PairAssessment
  /** `null` when the results of one of the crawls were pruned: only their totals can be compared. */
  counts: CrawlComparisonCounts | null
  total: number
  page: number
  pageCount: number
  rows: ComparisonRow[]
}

/**
 * What a comparison page shows: how far the two crawls can be compared, how many URLs changed in
 * each way, and one page of the URLs that changed in the way asked for. Everything is read from what
 * the crawls stored, a page at a time: nothing is requested from the site, and no list of all the
 * URLs is ever built.
 *
 * `history` is every browsable crawl of the domain, oldest first, `base` and `target` included: the
 * crawls a finding is read against to tell whether it "reappeared".
 */
export async function loadComparison(input: {
  crawls: ComparisonSource
  domainId: string
  base: Crawl
  target: Crawl
  history: Crawl[]
  query: CompareQuery
}): Promise<ComparisonData> {
  const { crawls, domainId, base, target, history, query } = input
  const assessment = assessPair(base, target)
  if (!assessment.urls) {
    return { assessment, counts: null, total: 0, page: 1, pageCount: 1, rows: [] }
  }

  const ids = { domainId, baseId: base.id, targetId: target.id }
  const listing = {
    ...ids,
    change: query.change,
    view: query.view,
    ...(query.search ? { search: query.search } : {}),
    ...(query.issue && isFindingChange(query.change) ? { issue: query.issue } : {}),
  }
  const [counts, total] = await Promise.all([
    crawls.compareCounts({ ...ids, view: query.view }),
    crawls.countCompared(listing),
  ])
  const pageCount = Math.max(1, Math.ceil(total / COMPARE_PAGE_SIZE))
  const page = Math.min(query.page, pageCount)
  const listed = await crawls.compareUrls({
    ...listing,
    limit: COMPARE_PAGE_SIZE,
    offset: (page - 1) * COMPARE_PAGE_SIZE,
  })

  let rows: ComparisonRow[] = listed.map((row) => ({ ...row, findings: null }))
  if (isFindingChange(query.change) && assessment.findings && listed.length > 0) {
    // What the other crawls say about these few URLs decides whether a finding "reappeared".
    const traces = indexTraces(
      await crawls.urlHistory({
        domainId,
        crawlIds: history.filter((crawl) => !crawl.pruned).map((crawl) => crawl.id),
        urlHashes: listed.map((row) => row.urlHash),
      }),
    )
    rows = listed.map((row) => ({
      ...row,
      findings: findingChangesBetween(
        history,
        evidenceOf(history, traces, row.urlHash),
        base.id,
        target.id,
      ),
    }))
  }
  return { assessment, counts, total, page, pageCount, rows }
}
