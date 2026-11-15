import { issueBasisOf } from '@seotools/core/crawl/basis'
import {
  ISSUE_IMPORTANCES,
  PAGE_ISSUES,
  isPageIssueId,
  type IssueImportance,
} from '@seotools/core/crawl/issues'

/** Highest importance first; retain findings from older or unknown catalogs without guessing. */
export function groupDetailFindings<T extends { issue: string }>(findings: readonly T[]) {
  const groups: { importance: IssueImportance | 'unknown'; findings: T[] }[] = [
    ...ISSUE_IMPORTANCES,
    'unknown' as const,
  ].map((importance) => ({ importance, findings: [] }))
  for (const finding of findings) {
    const importance = isPageIssueId(finding.issue)
      ? PAGE_ISSUES[finding.issue].importance
      : 'unknown'
    groups.find((group) => group.importance === importance)!.findings.push(finding)
  }
  return groups.filter((group) => group.findings.length > 0)
}

/** Presentation follows the stored analysis, never today's domain mode or a newer render alone. */
export function documentFindingsState(input: {
  documentBasis?: 'rendered-v1'
  observation?: 'complete' | 'redirected' | 'unobserved'
  unobserved?: readonly string[]
  crawlUnobserved?: readonly string[]
  page: boolean
  servedTruncated?: boolean
  render?: {
    status: 'rendered' | 'failed'
    settled: boolean
    truncated: boolean | null
    data: { redirected?: boolean }
  } | null
}) {
  const rendered = input.documentBasis === 'rendered-v1'
  const count = new Set([
    ...(input.unobserved ?? []),
    ...(input.crawlUnobserved ?? []).filter((id) => issueBasisOf(id) === 'document'),
  ]).size
  const unknown = rendered && input.page && (input.observation !== 'complete' || count > 0)
  const reason =
    input.observation === 'complete'
      ? 'dependencies'
      : input.render?.status === 'failed'
        ? 'failed'
        : input.observation === 'redirected' || input.render?.data.redirected
          ? 'redirected'
          : input.servedTruncated || input.render?.truncated
            ? 'truncated'
            : input.render?.status === 'rendered' && !input.render.settled
              ? 'unsettled'
              : 'missing'
  return { rendered, unknown, reason, count } as const
}
