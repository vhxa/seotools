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
