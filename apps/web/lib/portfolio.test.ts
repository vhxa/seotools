import type { Crawl } from '@seotools/db'
import { describe, expect, it } from 'vitest'
import { summarizeDomain } from './portfolio'

const crawl = (overrides: Partial<Crawl>): Crawl =>
  ({
    id: 'c',
    status: 'completed',
    pagesCount: 10,
    pagesWithType: { issue: 1, warning: 2, opportunity: 3 },
    pagesAudit: { audited: 10, excluded: 0, indexable: 8, notIndexable: 2, unknownIndexability: 0 },
    createdAt: new Date('2026-01-01'),
    finishedAt: new Date('2026-01-01'),
    ...overrides,
  }) as Crawl

describe('summarizeDomain', () => {
  it('has nothing for a domain that never crawled', () => {
    expect(summarizeDomain(undefined)).toEqual({
      last: null,
      crawled: null,
      figures: null,
      hasResults: false,
      running: false,
      points: [],
    })
  })

  it('takes the figures of the latest usable crawl, as the dashboard does', () => {
    const summary = summarizeDomain({
      running: true,
      crawls: [
        crawl({ id: 'failed', status: 'failed' }),
        crawl({
          id: 'new',
          pagesCount: 20,
          createdAt: new Date('2026-01-03'),
          finishedAt: new Date('2026-01-03'),
        }),
        crawl({
          id: 'old',
          createdAt: new Date('2026-01-02'),
          finishedAt: new Date('2026-01-02'),
          pagesWithType: { issue: 5, warning: 0, opportunity: 0 },
        }),
      ],
    })
    expect(summary.last).toMatchObject({ id: 'failed', status: 'failed' })
    expect(summary.running).toBe(true)
    expect(summary.crawled).toBe(20)
    expect(summary.figures).toEqual({ indexable: 8, issues: 1, warnings: 2, opportunities: 3 })
    // Oldest first, failed crawls are not a point.
    expect(summary.points.map(({ issues }) => issues)).toEqual([5, 1])
  })

  it('says a crawl that was not checked has no figures, never zeros', () => {
    const summary = summarizeDomain({
      running: false,
      crawls: [crawl({ pagesWithType: null, pagesAudit: null })],
    })
    expect(summary).toMatchObject({ hasResults: true, crawled: 10, figures: null, points: [] })
  })
})
