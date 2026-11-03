import {
  classifyFindings,
  crawlFactsOf,
  type Evidence,
  type FindingChange,
  type UrlEvidence,
} from '@seotools/core/crawl/compare'
import type { Crawl, CrawlUrlTrace } from '@seotools/db'

/** What a trace says about a URL, in the terms findings are judged by. */
export function urlEvidenceOf(trace: CrawlUrlTrace): UrlEvidence {
  return {
    requested: trace.snapshot.state === 'done',
    participation: trace.audit?.participation ?? null,
    intent: trace.audit?.intent ?? null,
    acceptNofollow: trace.audit?.acceptNofollow ?? false,
    issues: new Set(trace.issues.map(({ issue }) => issue)),
  }
}

/** The traces by crawl and URL. */
export function indexTraces(traces: CrawlUrlTrace[]): Map<string, CrawlUrlTrace> {
  return new Map(traces.map((trace) => [`${trace.crawlId}:${trace.urlHash}`, trace]))
}

/**
 * What each crawl, oldest first, has of one URL: the crawls that do not have it say so (`url: null`)
 * instead of being left out, because "not there" and "not known" are different things.
 */
export function evidenceOf(
  crawls: Crawl[],
  traces: Map<string, CrawlUrlTrace>,
  urlHash: string,
): Evidence[] {
  return crawls.map((crawl) => {
    const trace = traces.get(`${crawl.id}:${urlHash}`)
    return { crawl: crawlFactsOf(crawl), url: trace ? urlEvidenceOf(trace) : null }
  })
}

/**
 * How the findings of a URL changed between two of the crawls, with the ones before and between as
 * the history that can make a finding "reappeared". `crawls` is oldest first and `evidence` goes with
 * it. `null` when one of the two is not among the crawls.
 */
export function findingChangesBetween(
  crawls: Crawl[],
  evidence: Evidence[],
  baseId: string,
  targetId: string,
): FindingChange[] | null {
  const baseIndex = crawls.findIndex((crawl) => crawl.id === baseId)
  const targetIndex = crawls.findIndex((crawl) => crawl.id === targetId)
  const base = evidence[baseIndex]
  const target = evidence[targetIndex]
  if (!base || !target || baseIndex >= targetIndex) return null
  return classifyFindings({
    base,
    target,
    earlier: evidence.slice(0, baseIndex),
    between: evidence.slice(baseIndex + 1, targetIndex),
  })
}
