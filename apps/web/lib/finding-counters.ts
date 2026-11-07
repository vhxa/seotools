import {
  isPageIssueId,
  isSecondaryFinding,
  PAGE_ISSUES,
  ISSUE_TYPES,
} from '@seotools/core/crawl/issues'

export function findingCounters(ids: readonly string[], indexability: string | null) {
  return ISSUE_TYPES.map((type) => ({
    type,
    primary: ids.filter(
      (id) =>
        isPageIssueId(id) && PAGE_ISSUES[id].type === type && !isSecondaryFinding(id, indexability),
    ),
    secondary: ids.filter(
      (id) =>
        isPageIssueId(id) && PAGE_ISSUES[id].type === type && isSecondaryFinding(id, indexability),
    ),
  }))
}
