import type { Crawl } from '@seotools/db'

/**
 * How the pages of a full crawl were when it ended. `indexable` counts over every page crawled and
 * is `null` for a crawl analysed before it was kept: it is never worked out from the findings. The
 * other three count over the audited pages, which is why they are never drawn with it.
 */
export interface TrendPoint {
  /** When the crawl ended, in milliseconds since the epoch. */
  at: number
  indexable: number | null
  issues: number
  warnings: number
  opportunities: number
}

export type TrendFigures = Omit<TrendPoint, 'at'>

type Counted = Pick<Crawl, 'pagesWithType' | 'pagesAudit'>

/** What a crawl found, apart; `null` when it was not checked for issues. */
export function trendFigures(crawl: Counted): TrendFigures | null {
  return crawl.pagesWithType
    ? {
        indexable: crawl.pagesAudit?.indexable ?? null,
        issues: crawl.pagesWithType.issue,
        warnings: crawl.pagesWithType.warning,
        opportunities: crawl.pagesWithType.opportunity,
      }
    : null
}

/** One point per usable full crawl that was checked, oldest first. Counts outlive pruned results. */
export function trendPoints(
  crawls: (Counted & Pick<Crawl, 'status' | 'finishedAt' | 'createdAt'>)[],
): TrendPoint[] {
  return crawls
    .flatMap((crawl) => {
      const figures = trendFigures(crawl)
      return (crawl.status === 'completed' || crawl.status === 'incomplete') && figures
        ? [{ at: (crawl.finishedAt ?? crawl.createdAt).getTime(), ...figures }]
        : []
    })
    .sort((a, b) => a.at - b.at)
}
