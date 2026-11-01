import { PAGE_ISSUES, isPageIssueId, type PageIssueId } from '@seotools/core/crawl/issues'

export interface IssueCount {
  issue: PageIssueId
  pages: number
}

/**
 * The issues a crawl found, worst first and then the most widespread. Ids the code no longer
 * defines are left out: they are old data without a name to show.
 */
export function rankIssueCounts(counts: { issue: string; pages: number }[]): IssueCount[] {
  return counts
    .filter((row): row is IssueCount => isPageIssueId(row.issue))
    .sort(
      (a, b) =>
        Number(PAGE_ISSUES[b.issue].severity === 'error') -
          Number(PAGE_ISSUES[a.issue].severity === 'error') ||
        b.pages - a.pages ||
        a.issue.localeCompare(b.issue),
    )
}
