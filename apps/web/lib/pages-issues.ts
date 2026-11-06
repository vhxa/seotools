import {
  ISSUE_GROUPS,
  compareIssueSeverity,
  isPageIssueId,
  issuesOfCategory,
  worstIssueType,
  type IssueCategoryId,
  type IssueGroupId,
  type IssueType,
  type PageIssueId,
} from '@seotools/core/crawl/issues'

export interface IssueCount {
  issue: PageIssueId
  pages: number
  /** Search-result findings on URLs that cannot be indexed: listed, never pending. */
  secondary?: number
}

/**
 * What a crawl found, worst first and then the most widespread. Ids the code no longer defines are
 * left out: they are old data without a name to show.
 */
export function rankIssueCounts(
  counts: { issue: string; pages: number; secondary?: number }[],
): IssueCount[] {
  return counts
    .filter((row): row is IssueCount => isPageIssueId(row.issue))
    .sort(
      (a, b) =>
        compareIssueSeverity(a.issue, b.issue) ||
        b.pages - a.pages ||
        a.issue.localeCompare(b.issue),
    )
}

export interface IssueCategorySummary {
  id: IssueCategoryId
  /** Every issue of the category in its order, the ones nothing has with 0. */
  issues: IssueCount[]
  /** What the rows below it add up to. A URL with two of them counts twice. */
  total: number
  /** The worst type that was actually found. `null` if nothing was. */
  worst: IssueType | null
}

export interface IssueGroupSummary {
  id: IssueGroupId
  categories: IssueCategorySummary[]
}

/** Every issue there is, in its group and category, with what a crawl found of it. */
export function summariseIssues(counts: { issue: string; pages: number }[]): IssueGroupSummary[] {
  const found = new Map(counts.map(({ issue, pages }) => [issue, pages]))
  return ISSUE_GROUPS.map((group) => ({
    id: group.id,
    categories: group.categories.map((id) => {
      const issues = issuesOfCategory(id).map((issue) => ({
        issue,
        pages: found.get(issue) ?? 0,
      }))
      return {
        id,
        issues,
        total: issues.reduce((sum, row) => sum + row.pages, 0),
        worst: worstIssueType(issues.filter((row) => row.pages > 0).map((row) => row.issue)),
      }
    }),
  }))
}

/** Counts alone cannot establish applicability or successful checks for every URL. */
export function zeroFindingState(issue: PageIssueId): 'unavailable' | 'noFindings' {
  // No indexing source is collected yet; keep this distinct from crawl indexability.
  return issue === 'indexed-not-in-sitemap' ? 'unavailable' : 'noFindings'
}
