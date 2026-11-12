import { describe, expect, it } from 'vitest'
import { dashboardDifference, trendFigures, trendPoints } from './dashboard'

const crawl = (at: number, over: Record<string, unknown> = {}) => ({
  status: 'completed' as const,
  finishedAt: new Date(at),
  createdAt: new Date(at - 1000),
  pagesWithType: { issue: 3, warning: 2, opportunity: 1 },
  pagesAudit: { audited: 10, excluded: 0, unknownIndexability: 0, indexable: 8, notIndexable: 2 },
  ...over,
})

describe('trendPoints', () => {
  it('orders by date and keeps the indexable figure apart from the findings', () => {
    const points = trendPoints([crawl(2000), crawl(1000, { pagesAudit: null })])
    expect(points.map((p) => p.at)).toEqual([1000, 2000])
    expect(points[0]).toMatchObject({ indexable: null, issues: 3, warnings: 2, opportunities: 1 })
    expect(points[1]?.indexable).toBe(8)
  })

  it('skips crawls that were not checked or did not end', () => {
    expect(
      trendPoints([crawl(1000, { pagesWithType: null }), crawl(2000, { status: 'failed' })]),
    ).toEqual([])
  })
})

describe('trendFigures', () => {
  it('is null for a crawl without findings counts', () => {
    expect(trendFigures({ pagesWithType: null, pagesAudit: null })).toBeNull()
  })
})

describe('dashboardDifference', () => {
  it('keeps unavailable baselines unknown and preserves the direction of changes', () => {
    expect(dashboardDifference(null, 12)).toBeNull()
    expect(dashboardDifference(10, undefined)).toBeNull()
    expect(dashboardDifference(10, 7)).toBe(-3)
    expect(dashboardDifference(0, 12)).toBe(12)
    expect(dashboardDifference(10, 10)).toBe(0)
  })
})
