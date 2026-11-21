import {
  assessPair,
  keepsUrlHistory,
  type FindingChange,
  type PairAssessment,
} from '@seotools/core/crawl/compare'
import { EXPLANATION_VERSION } from '@seotools/core/crawl/comparison-reasons'
import { crawlUrlHash, type LinkContext } from '@seotools/core'
import type {
  ComparisonHeader,
  Crawl,
  CrawlComparisonCounts,
  CrawlRepository,
  CrawlUrlComparison,
  UrlExplanation,
  Verification,
  VerificationRepository,
  VerifiedUrl,
} from '@seotools/db'
import {
  COMPARE_PAGE_SIZE,
  isFindingChange,
  isOneSidedChange,
  type CompareQuery,
} from './compare-query'
import { summarizeComparison, type ExplanationState, type SummaryLine } from './compare-summary'
import { evidenceOf, findingChangesBetween, indexTraces } from './crawl-evidence'

export type ComparisonSource = Pick<
  CrawlRepository,
  | 'compareCounts'
  | 'countCompared'
  | 'compareUrls'
  | 'urlHistory'
  | 'comparisonHeader'
  | 'requestComparison'
  | 'explanationDetails'
>

/** What a recheck answered of the URL after the later crawl: what it answers now, to verify. */
export type CheckAnswer = Pick<
  VerifiedUrl,
  'statusCode' | 'redirectTo' | 'error' | 'kind' | 'fetchedAt' | 'verificationId'
>

/** Why a URL is in one crawl only, with the addresses the stored reason names. */
export interface RowReason {
  explanation: UrlExplanation
  /** The page that linked it (`explanation.via`), in the crawl that has the URL, and its hash. */
  via: { url: string; urlHash: string } | null
  /** The page it was reached through, for a chain. */
  through: { url: string; urlHash: string } | null
  /** The link from `via` to it, as that crawl stored it. */
  link: { kind: string; rendered: boolean; context?: LinkContext } | null
}

export interface ComparisonRow extends CrawlUrlComparison {
  /**
   * How the findings of the URL changed, for the changes that list findings. `null`: the crawls
   * cannot be compared on findings at all (see `assessment`).
   */
  findings: FindingChange[] | null
  /** For the URLs one crawl lacks: why, once worked out (`null`: not yet, or not for this row). */
  why?: RowReason | null
  /** For the URLs one crawl lacks: what a recheck made after the later crawl got from it. */
  check?: CheckAnswer | null
}

export interface ComparisonData {
  assessment: PairAssessment
  /** `null` when the results of one of the crawls were pruned: only their totals can be compared. */
  counts: CrawlComparisonCounts | null
  /** Whether why each URL differs has been worked out for this pair. */
  explanation: ExplanationState
  summary: SummaryLine[]
  /** The domain's recheck under way, if any: a domain rechecks one batch at a time. */
  activeRecheck: Pick<Verification, 'id'> | null
  total: number
  page: number
  pageCount: number
  rows: ComparisonRow[]
}

/** The header's state, as the page says it. A pair with no current explanation is asked for. */
function explanationStateOf(header: ComparisonHeader | null): ExplanationState {
  if (!header) return 'unavailable'
  if (header.version !== EXPLANATION_VERSION) return 'preparing'
  if (header.state === 'done') return 'done'
  if (header.state === 'failed') return 'failed'
  return 'preparing'
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
  verifications?: Pick<VerificationRepository, 'latestFor' | 'active'>
  domainId: string
  base: Crawl
  target: Crawl
  history: Crawl[]
  query: CompareQuery
}): Promise<ComparisonData> {
  const { crawls, domainId, base, target, history, query } = input
  const assessment = assessPair(base, target)
  if (!assessment.urls) {
    return {
      assessment,
      counts: null,
      explanation: 'unavailable',
      summary: summarizeComparison({
        assessment,
        base,
        target,
        counts: null,
        explanation: 'unavailable',
      }),
      activeRecheck: null,
      total: 0,
      page: 1,
      pageCount: 1,
      rows: [],
    }
  }

  const ids = { domainId, baseId: base.id, targetId: target.id }
  // Opening a pair whose reasons were never worked out asks for them: it requests nothing from the
  // site, so anyone who can see the pair may (one job per pair, kept apart by the header's key).
  let header = await crawls.comparisonHeader(ids)
  if (explanationStateOf(header) !== 'done')
    header = (await crawls.requestComparison(ids)) ?? header
  const explanation = explanationStateOf(header)

  const listing = {
    ...ids,
    change: query.change,
    view: query.view,
    ...(query.search ? { search: query.search } : {}),
    ...(query.issue && isFindingChange(query.change) ? { issue: query.issue } : {}),
    ...(query.reason && isOneSidedChange(query.change) ? { reason: query.reason } : {}),
  }
  const [counts, total, active] = await Promise.all([
    crawls.compareCounts({ ...ids, view: query.view }),
    crawls.countCompared(listing),
    input.verifications?.active(domainId) ?? null,
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
        crawlIds: history.filter(keepsUrlHistory).map((crawl) => crawl.id),
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
  if (isOneSidedChange(query.change) && listed.length > 0) {
    rows = await withReasons(input, rows)
  }
  return {
    assessment,
    counts,
    explanation,
    summary: summarizeComparison({ assessment, base, target, counts, explanation }),
    activeRecheck: active ? { id: active.id } : null,
    total,
    page,
    pageCount,
    rows,
  }
}

/**
 * The addresses each stored reason names and the link it was found by (one bounded query each for
 * the page's rows), and what the latest recheck after the later crawl answered for each URL.
 */
async function withReasons(
  input: Parameters<typeof loadComparison>[0],
  rows: ComparisonRow[],
): Promise<ComparisonRow[]> {
  const { crawls, domainId, base, target } = input
  const explained = rows.flatMap((row) => (row.explanation ? [row.explanation] : []))
  const details = await crawls.explanationDetails({
    domainId,
    baseId: base.id,
    targetId: target.id,
    rows: explained.map(({ side, seq, via, viaKind, through }) => ({
      side,
      seq,
      via,
      viaKind,
      through,
    })),
  })
  const checks = new Map<string, CheckAnswer>()
  const after = (target.finishedAt ?? target.createdAt).getTime()
  if (input.verifications) {
    for (const verified of await input.verifications.latestFor(
      domainId,
      rows.map((row) => row.urlHash),
    )) {
      // Only an answer later than the later crawl says something the comparison does not.
      if (verified.fetchedAt && verified.fetchedAt.getTime() > after) {
        checks.set(verified.urlHash, verified)
      }
    }
  }
  return rows.map((row) => {
    const explanation = row.explanation ?? null
    const found = checks.get(row.urlHash)
    const check: CheckAnswer | null = found
      ? {
          statusCode: found.statusCode,
          redirectTo: found.redirectTo,
          error: found.error,
          kind: found.kind,
          fetchedAt: found.fetchedAt,
          verificationId: found.verificationId,
        }
      : null
    if (!explanation) return { ...row, why: null, check }
    const side = explanation.side
    const at = (seq: number | null) => {
      const url = seq === null ? undefined : details.urls[side].get(seq)
      return url === undefined ? null : { url, urlHash: crawlUrlHash(url) }
    }
    return {
      ...row,
      why: {
        explanation,
        via: at(explanation.via),
        through: at(explanation.through),
        link: explanation.seq === null ? null : (details.links[side].get(explanation.seq) ?? null),
      },
      check,
    }
  })
}
