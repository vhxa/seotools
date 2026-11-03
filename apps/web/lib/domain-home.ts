import type { AuditResultsState } from '@seotools/core/crawl/audit'
import type { Crawl } from '@seotools/db'
import { rankIssueCounts } from './pages-issues'

/** Null means unavailable, never an empty set of findings. Older aggregates remain unknown. */
export function homePriorities(
  crawl: Pick<Crawl, 'pagesWithType' | 'pruned'> | null,
  state: AuditResultsState,
  counts: { issue: string; pages: number }[],
) {
  if (!crawl || crawl.pruned || !crawl.pagesWithType || state.kind !== 'current') return null
  return rankIssueCounts(counts.filter(({ pages }) => pages > 0)).slice(0, 3)
}
