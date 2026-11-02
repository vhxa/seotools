import { describe, expect, it } from 'vitest'
import {
  ISSUE_GROUPS,
  PAGE_ISSUES,
  PAGE_ISSUE_IDS,
  compareIssueSeverity,
  isPageIssueId,
  issuesOfCategory,
  pagesWithIssues,
  worstIssueType,
} from './issues'

describe('the catalog', () => {
  const categories = ISSUE_GROUPS.flatMap((group) => group.categories)

  it('lists every issue once, in a category of a group', () => {
    const listed = categories.flatMap((category) => issuesOfCategory(category))
    // An id repeated across categories would be lost in `PAGE_ISSUES`.
    expect(new Set(listed).size).toBe(listed.length)
    expect([...listed].sort()).toEqual([...PAGE_ISSUE_IDS].sort())
    expect(listed).toHaveLength(100)
  })

  it('knows the category of each issue', () => {
    for (const category of categories) {
      for (const id of issuesOfCategory(category)) expect(PAGE_ISSUES[id].category).toBe(category)
    }
  })

  it('keeps the order of the list within a category', () => {
    expect(issuesOfCategory('content')).toEqual([
      'content-duplicate',
      'content-near-duplicate',
      'content-placeholder',
      'content-thin',
    ])
  })

  it('says which issues carry a detail', () => {
    expect(PAGE_ISSUES['missing-security-header'].detail).toBe('security-header')
    for (const id of issuesOfCategory('hreflang')) {
      expect(PAGE_ISSUES[id].detail).toBe('hreflang-source')
    }
    expect(PAGE_ISSUES['title-missing'].detail).toBeUndefined()
  })
})

describe('isPageIssueId', () => {
  it('only accepts registered issues', () => {
    for (const id of PAGE_ISSUE_IDS) expect(isPageIssueId(id)).toBe(true)
    expect(isPageIssueId('toString')).toBe(false)
    expect(isPageIssueId('nope')).toBe(false)
    expect(isPageIssueId(undefined)).toBe(false)
  })
})

describe('worstIssueType', () => {
  it('finds the worst type', () => {
    expect(worstIssueType([])).toBeNull()
    expect(worstIssueType(['title-too-long'])).toBe('opportunity')
    expect(worstIssueType(['title-too-long', 'noindex'])).toBe('warning')
    expect(worstIssueType(['title-too-long', 'noindex', 'no-response'])).toBe('issue')
  })
})

describe('compareIssueSeverity', () => {
  it('sorts by type and then by importance', () => {
    expect(
      (['title-too-long', 'noindex', 'url-spaces', 'nofollow', 'no-response'] as const)
        .slice()
        .sort(compareIssueSeverity),
    ).toEqual(['no-response', 'url-spaces', 'noindex', 'nofollow', 'title-too-long'])
  })
})

describe('pagesWithIssues', () => {
  const pages = { issue: 1, warning: 10, opportunity: 100 }

  it('counts the types from the worst down to the threshold', () => {
    expect(pagesWithIssues(pages, 'issue')).toBe(1)
    expect(pagesWithIssues(pages, 'warning')).toBe(11)
    expect(pagesWithIssues(pages, 'opportunity')).toBe(111)
  })
})
