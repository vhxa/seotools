import { PAGE_ISSUE_IDS } from '@seotools/core/crawl/issues'
import { describe, expect, it } from 'vitest'
import { rankIssueCounts, summariseIssues } from './pages-issues'

describe('rankIssueCounts', () => {
  it('puts the worst type first, then the most important, then the most widespread', () => {
    expect(
      rankIssueCounts([
        { issue: 'title-too-long', pages: 40 },
        { issue: 'no-response', pages: 2 },
        { issue: 'nofollow', pages: 90 },
        { issue: 'noindex', pages: 1 },
        { issue: 'title-too-short', pages: 50 },
      ]).map((row) => row.issue),
    ).toEqual(['no-response', 'noindex', 'nofollow', 'title-too-short', 'title-too-long'])
  })

  it('breaks ties by id so the order does not change between renders', () => {
    expect(
      rankIssueCounts([
        { issue: 'title-too-short', pages: 5 },
        { issue: 'title-too-long', pages: 5 },
      ]).map((row) => row.issue),
    ).toEqual(['title-too-long', 'title-too-short'])
  })

  it('ignores issues the code does not define any more', () => {
    expect(
      rankIssueCounts([
        { issue: 'retired-check', pages: 9 },
        { issue: 'no-response', pages: 1 },
      ]),
    ).toEqual([{ issue: 'no-response', pages: 1 }])
  })
})

describe('summariseIssues', () => {
  const summary = summariseIssues([
    { issue: 'title-too-long', pages: 40 },
    { issue: 'title-missing', pages: 2 },
    { issue: 'canonical-missing', pages: 7 },
    { issue: 'retired-check', pages: 9 },
  ])
  const category = (id: string) =>
    summary.flatMap((group) => group.categories).find((row) => row.id === id)

  it('lists every issue, in order, even if nothing has it', () => {
    const listed = summary.flatMap((group) =>
      group.categories.flatMap((row) => row.issues.map((issue) => issue.issue)),
    )
    expect([...listed].sort()).toEqual([...PAGE_ISSUE_IDS].sort())
    expect(category('title')?.issues.slice(0, 2)).toEqual([
      { issue: 'title-missing', pages: 2 },
      { issue: 'title-outside-head', pages: 0 },
    ])
  })

  it('adds up what each category found', () => {
    expect(category('title')?.total).toBe(42)
    expect(category('canonicals')?.total).toBe(7)
    expect(category('html')?.total).toBe(0)
  })

  it('takes the colour of a category from the worst type it actually found', () => {
    expect(category('title')?.worst).toBe('issue')
    // Canonicals has issues in the catalog, but only a warning was found.
    expect(category('canonicals')?.worst).toBe('warning')
    expect(category('html')?.worst).toBeNull()
  })
})
