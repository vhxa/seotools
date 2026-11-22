import { describe, expect, it } from 'vitest'
import {
  basisChanges,
  dashboardDifference,
  lastOfEachDay,
  segmentTrend,
  trendFigures,
  trendPoints,
} from './dashboard'

const crawl = (at: number, over: Record<string, unknown> = {}) => ({
  status: 'completed' as const,
  finishedAt: new Date(at),
  createdAt: new Date(at - 1000),
  pagesWithType: { issue: 3, warning: 2, opportunity: 1 },
  pagesAudit: { audited: 10, excluded: 0, unknownIndexability: 0, indexable: 8, notIndexable: 2 },
  pagesByWorstIssue: { issue: 1, warning: 1, opportunity: 1 },
  issueCatalog: '11.0',
  auditVersion: 3,
  auditSnapshot: { version: 3, rules: [] },
  discoverySettings: null,
  rendering: { mode: 'html' as const, waitMs: 1000, omittedHosts: [] },
  ignoredParameters: [] as string[],
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

describe('lastOfEachDay', () => {
  it('keeps the last point of each day, oldest first', () => {
    const dayOf = (at: number) => String(Math.floor(at / 100))
    const points = [{ at: 250 }, { at: 110 }, { at: 190 }, { at: 205 }]
    expect(lastOfEachDay(points, dayOf)).toEqual([{ at: 190 }, { at: 250 }])
  })
})

const DAY = 24 * 60 * 60 * 1000
const day = (at: number) => new Date(at).toISOString().slice(0, 10)
/** The points drawn: one per day, then split into stretches. */
const drawn = (crawls: ReturnType<typeof crawl>[]) =>
  segmentTrend(lastOfEachDay(trendPoints(crawls), day))
const rendered = { rendering: { mode: 'rendered' as const, waitMs: 1000, omittedHosts: [] } }

describe('segmentTrend', () => {
  it('keeps crawls with the same basis in one stretch, with nothing to mark', () => {
    const points = drawn([crawl(DAY), crawl(2 * DAY), crawl(3 * DAY)])
    expect(points.map((p) => p.segment)).toEqual([0, 0, 0])
    expect(points.every((p) => p.changes.length === 0)).toBe(true)
  })

  it('breaks and marks the first crawl after a change of rendering mode', () => {
    const points = drawn([
      crawl(DAY),
      crawl(2 * DAY),
      crawl(3 * DAY, rendered),
      crawl(4 * DAY, rendered),
    ])
    expect(points.map((p) => p.segment)).toEqual([0, 0, 1, 1])
    expect(points[2]?.changes).toEqual([{ kind: 'rendering', to: 'rendered' }])
    expect(points[3]?.changes).toEqual([])
  })

  it('names the parameters a crawl started to ignore, and the ones it stopped ignoring', () => {
    const points = drawn([
      crawl(DAY, { ignoredParameters: ['utm_source'] }),
      crawl(2 * DAY, { ignoredParameters: ['utm_source', 'duration'] }),
      crawl(3 * DAY, { ignoredParameters: ['duration'] }),
    ])
    expect(points.map((p) => p.segment)).toEqual([0, 1, 2])
    expect(points[1]?.changes).toEqual([{ kind: 'ignoredAdded', parameters: ['duration'] }])
    expect(points[2]?.changes).toEqual([{ kind: 'ignoredRemoved', parameters: ['utm_source'] }])
  })

  it('breaks on a changed discovery setting, naming it', () => {
    const settings = (maxDepth: number | null) => ({
      discoverySettings: {
        includePrefixes: [],
        excludePrefixes: [],
        maxDepth,
        maxUrls: null,
        userAgent: null,
        requestCredentialsSet: false,
        optionalFiles: [],
        indexNowKey: null,
        concurrency: 2,
        requestsPerSecond: 5,
        timeoutMs: 10000,
        maxRetries: 2,
      },
    })
    const points = drawn([crawl(DAY, settings(null)), crawl(2 * DAY, settings(4))])
    expect(points[1]?.changes).toEqual([{ kind: 'settings', settings: ['maxDepth'] }])
  })

  it('breaks when the issue catalog or the audit rules changed, and says which', () => {
    const rule = {
      version: 4,
      rules: [
        {
          id: 'r',
          dimension: 'noindex',
          value: 'forbidden',
          selector: { kind: 'prefix', path: '/', query: { mode: 'any' }, scope: 'literal' },
          reason: null,
          enabled: true,
        },
      ],
    }
    const points = drawn([
      crawl(DAY),
      crawl(2 * DAY, { issueCatalog: '12.0' }),
      crawl(3 * DAY, { issueCatalog: '12.0', auditSnapshot: rule }),
    ])
    expect(points[1]?.changes).toEqual([{ kind: 'catalog' }])
    expect(points[2]?.changes).toEqual([{ kind: 'rules' }])
    expect(points.map((p) => p.segment)).toEqual([0, 1, 2])
  })

  it('does not cut legacy crawls that did not record a setting', () => {
    const legacy = {
      rendering: null,
      ignoredParameters: undefined,
      discoverySettings: null,
      issueCatalog: null,
      auditVersion: null,
      auditSnapshot: null,
    }
    const points = drawn([crawl(DAY, legacy), crawl(2 * DAY), crawl(3 * DAY, legacy)])
    expect(points.map((p) => p.segment)).toEqual([0, 0, 0])
  })

  it('still breaks between a legacy crawl and one known to be rendered when its audit says so', () => {
    const legacy = { rendering: null, ignoredParameters: undefined }
    const audited = { auditSnapshot: { version: 3, rules: [], rendering: 'rendered' as const } }
    const points = drawn([crawl(DAY, legacy), crawl(2 * DAY, { ...legacy, ...audited })])
    expect(points[1]?.changes).toEqual([{ kind: 'rendering', to: 'rendered' }])
  })

  it('judges the break between the points drawn: a day keeps its last crawl', () => {
    // Day 2 has an HTML crawl and then a rendered one, with a new ignored parameter: only the last
    // is drawn, and it breaks the line once with both reasons.
    const points = drawn([
      crawl(DAY),
      crawl(2 * DAY, { ignoredParameters: ['duration'] }),
      crawl(2 * DAY + 1000, { ...rendered, ignoredParameters: ['duration'] }),
      crawl(3 * DAY, { ...rendered, ignoredParameters: ['duration'] }),
    ])
    expect(points).toHaveLength(3)
    expect(points.map((p) => p.segment)).toEqual([0, 1, 1])
    expect(points[1]?.changes).toEqual([
      { kind: 'rendering', to: 'rendered' },
      { kind: 'ignoredAdded', parameters: ['duration'] },
    ])
  })

  it('does not break for a crawl that a later one of its day replaced', () => {
    // The odd crawl of day 2 is not drawn, so it cannot cut the line.
    const points = drawn([
      crawl(DAY),
      crawl(2 * DAY, rendered),
      crawl(2 * DAY + 1000),
      crawl(3 * DAY),
    ])
    expect(points.map((p) => p.segment)).toEqual([0, 0, 0])
  })
})

describe('basisChanges', () => {
  it('is empty for the same basis', () => {
    const [point] = trendPoints([crawl(DAY)])
    expect(point && basisChanges(point.basis, point.basis)).toEqual([])
  })
})
