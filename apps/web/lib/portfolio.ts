import type { Crawl, PortfolioEntry } from '@seotools/db'
import { trendFigures, trendPoints, type TrendFigures, type TrendPoint } from './dashboard'

/** What the portfolio shows of a domain. */
export interface DomainSummary {
  /** The most recent full crawl that ended, whatever came of it. */
  last: Pick<Crawl, 'id' | 'status' | 'finishedAt' | 'createdAt'> | null
  /** Pages crawled in the last usable one (the one the figures are of). */
  crawled: number | null
  /** `null`: no usable crawl, or one that was not checked for findings. */
  figures: TrendFigures | null
  /** Whether there is a usable crawl at all, checked or not. */
  hasResults: boolean
  /** A crawl is pending or running. */
  running: boolean
  /** Oldest first, one per usable crawl that was checked. */
  points: TrendPoint[]
}

const usable = (crawl: Pick<Crawl, 'status'>) =>
  crawl.status === 'completed' || crawl.status === 'incomplete'

/**
 * Reads a domain the way its dashboard does: the figures of the latest full crawl that has usable
 * results (`trendFigures`), the trend over the usable ones (`trendPoints`). `undefined`: the domain
 * has never ended a crawl nor started one.
 */
export function summarizeDomain(entry: PortfolioEntry | undefined): DomainSummary {
  const crawls = entry?.crawls ?? []
  const latest = crawls.find(usable) ?? null
  return {
    last: crawls[0] ?? null,
    crawled: latest ? latest.pagesCount : null,
    figures: latest ? trendFigures(latest) : null,
    hasResults: latest !== null,
    running: entry?.running ?? false,
    points: trendPoints(crawls),
  }
}
