import { describe, expect, it } from 'vitest'
import { rankIssueCounts } from './pages-issues'

describe('rankIssueCounts', () => {
  it('puts errors first, then the most widespread', () => {
    expect(
      rankIssueCounts([
        { issue: 'missing-title', pages: 40 },
        { issue: 'http-error', pages: 2 },
        { issue: 'missing-description', pages: 90 },
      ]),
    ).toEqual([
      { issue: 'http-error', pages: 2 },
      { issue: 'missing-description', pages: 90 },
      { issue: 'missing-title', pages: 40 },
    ])
  })

  it('breaks ties by id so the order does not change between renders', () => {
    expect(
      rankIssueCounts([
        { issue: 'missing-title', pages: 5 },
        { issue: 'missing-description', pages: 5 },
      ]).map((row) => row.issue),
    ).toEqual(['missing-description', 'missing-title'])
  })

  it('ignores issues the code does not define any more', () => {
    expect(
      rankIssueCounts([
        { issue: 'retired-check', pages: 9 },
        { issue: 'http-error', pages: 1 },
      ]),
    ).toEqual([{ issue: 'http-error', pages: 1 }])
  })
})
