import { EMPTY_AUDIT_SNAPSHOT } from '@seotools/core/crawl/audit'
import { auditScopeKey } from '@seotools/core/crawl/compare'
import {
  compareCrawlDiscovery,
  type CrawlDiscoveryDifference,
  type CrawlDiscoveryInput,
} from '@seotools/core/crawl/discovery'
import type { Crawl } from '@seotools/db'

/**
 * What a crawl was measured with, kept small enough to send to the browser. Two crawls whose basis
 * differs do not measure the same thing, so a line must not join them.
 */
export interface TrendBasis {
  /** Rendering, ignored parameters and the discovery settings the crawl recorded. */
  discovery: CrawlDiscoveryInput
  /** The issue catalog it was analysed with; `null` when not recorded. */
  catalog: string | null
  /** The audit rules it was analysed with, without the rendering basis; `null` when unknown. */
  rules: string | null
  /** Whether the audit was made over rendered pages, as its snapshot says; `undefined` unknown. */
  auditedRendered: boolean | undefined
}

/**
 * How the pages of a full crawl were when it ended. `indexable` counts over every page crawled and
 * is `null` for a crawl analysed before it was kept: it is never worked out from the findings. The
 * other three count over the audited pages, which is why they are never drawn with it.
 */
export interface TrendPoint {
  /** When the crawl ended, in milliseconds since the epoch. */
  at: number
  indexable: number | null
  issues: number
  warnings: number
  opportunities: number
  basis: TrendBasis
}

export type TrendFigures = Omit<TrendPoint, 'at' | 'basis'>

type Counted = Pick<Crawl, 'pagesWithType' | 'pagesAudit'>

/** What a crawl found, apart; `null` when it was not checked for issues. */
export function trendFigures(crawl: Counted): TrendFigures | null {
  return crawl.pagesWithType
    ? {
        indexable: crawl.pagesAudit?.indexable ?? null,
        issues: crawl.pagesWithType.issue,
        warnings: crawl.pagesWithType.warning,
        opportunities: crawl.pagesWithType.opportunity,
      }
    : null
}

type Based = Pick<
  Crawl,
  | 'discoverySettings'
  | 'rendering'
  | 'ignoredParameters'
  | 'issueCatalog'
  | 'auditSnapshot'
  | 'auditVersion'
  | 'pagesByWorstIssue'
>

/** What a crawl was measured with. Whatever it did not record stays unknown. */
export function trendBasisOf(crawl: Based): TrendBasis {
  const snapshot = crawl.auditSnapshot
  // Same reading as `crawlAuditScope`, without the rendering that has its own change.
  const rules =
    crawl.pagesByWorstIssue === null
      ? null
      : snapshot
        ? auditScopeKey({ ...snapshot, rendering: undefined, documentBasis: undefined })
        : crawl.auditVersion === null
          ? auditScopeKey(EMPTY_AUDIT_SNAPSHOT)
          : null
  return {
    discovery: {
      discoverySettings: crawl.discoverySettings,
      rendering: crawl.rendering,
      ...(crawl.ignoredParameters ? { ignoredParameters: crawl.ignoredParameters } : {}),
    },
    catalog: crawl.issueCatalog,
    rules,
    auditedRendered: snapshot ? snapshot.rendering === 'rendered' : undefined,
  }
}

/** One point per usable full crawl that was checked, oldest first. Counts outlive pruned results. */
export function trendPoints(
  crawls: (Counted & Based & Pick<Crawl, 'status' | 'finishedAt' | 'createdAt'>)[],
): TrendPoint[] {
  return crawls
    .flatMap((crawl) => {
      const figures = trendFigures(crawl)
      return (crawl.status === 'completed' || crawl.status === 'incomplete') && figures
        ? [
            {
              at: (crawl.finishedAt ?? crawl.createdAt).getTime(),
              ...figures,
              basis: trendBasisOf(crawl),
            },
          ]
        : []
    })
    .sort((a, b) => a.at - b.at)
}

/** What differs between the crawls of two consecutive points, in words the interface translates. */
export type BasisChange =
  | { kind: 'rendering'; to: 'html' | 'rendered' }
  | { kind: 'ignoredAdded'; parameters: string[] }
  | { kind: 'ignoredRemoved'; parameters: string[] }
  | { kind: 'settings'; settings: CrawlDiscoveryDifference['setting'][] }
  | { kind: 'catalog' }
  | { kind: 'rules' }

/**
 * How the basis of `to` differs from that of `from`, the crawl before it. Only what both crawls
 * recorded and differs is a change: a setting a crawl did not record (made before it was kept) is
 * unknown, and unknown is never drawn as a change, so legacy crawls are not cut off from each other.
 */
export function basisChanges(from: TrendBasis, to: TrendBasis): BasisChange[] {
  const changes: BasisChange[] = []
  const differences = compareCrawlDiscovery(from.discovery, to.discovery)
  const different = (setting: CrawlDiscoveryDifference['setting']) =>
    differences.some((entry) => entry.setting === setting && entry.status === 'different')

  const mode = (basis: TrendBasis) =>
    basis.discovery.rendering?.mode ??
    (basis.auditedRendered === undefined ? undefined : basis.auditedRendered ? 'rendered' : 'html')
  const before = mode(from)
  const after = mode(to)
  if (before !== undefined && after !== undefined && before !== after) {
    changes.push({ kind: 'rendering', to: after })
  }

  if (different('ignoredParameters')) {
    const left = new Set(from.discovery.ignoredParameters)
    const right = new Set(to.discovery.ignoredParameters)
    const added = [...right].filter((name) => !left.has(name)).sort()
    const removed = [...left].filter((name) => !right.has(name)).sort()
    if (added.length > 0) changes.push({ kind: 'ignoredAdded', parameters: added })
    if (removed.length > 0) changes.push({ kind: 'ignoredRemoved', parameters: removed })
  }

  const settings = differences
    .filter((entry) => entry.status === 'different')
    .map((entry) => entry.setting)
    .filter((setting) => setting !== 'renderingMode' && setting !== 'ignoredParameters')
  if (settings.length > 0) changes.push({ kind: 'settings', settings })

  if (from.catalog !== null && to.catalog !== null && from.catalog !== to.catalog) {
    changes.push({ kind: 'catalog' })
  }
  if (from.rules !== null && to.rules !== null && from.rules !== to.rules) {
    changes.push({ kind: 'rules' })
  }
  return changes
}

/** A point of a trend with the stretch of comparable crawls it belongs to. */
export type SegmentedPoint = TrendPoint & {
  /** 0 for the first stretch; one more after each break. */
  segment: number
  /** Why the line breaks before this point; empty inside a stretch and for the first point. */
  changes: BasisChange[]
}

/**
 * Splits the points to draw into stretches of crawls that measure the same thing. Pass the points
 * actually drawn (one per day): a break is judged between a point and the one drawn before it, so a
 * crawl that a later one of its day replaced never causes a break by itself.
 */
export function segmentTrend(points: TrendPoint[]): SegmentedPoint[] {
  let segment = 0
  return points.map((point, index) => {
    const previous = points[index - 1]
    const changes = previous ? basisChanges(previous.basis, point.basis) : []
    if (changes.length > 0) segment += 1
    return { ...point, segment, changes }
  })
}

/** One point per calendar day (as `dayOf` tells it): the last one of that day, oldest first. */
export function lastOfEachDay<T extends { at: number }>(
  points: T[],
  dayOf: (at: number) => string,
): T[] {
  const days = new Map<string, T>()
  for (const point of [...points].sort((a, b) => a.at - b.at)) days.set(dayOf(point.at), point)
  return [...days.values()]
}

/** A missing measurement is unknown, including an analysis that predates the metric. */
export function dashboardDifference(
  before: number | null | undefined,
  after: number | null | undefined,
): number | null {
  return before == null || after == null ? null : after - before
}

/** The reference instant of the period switch; the page is dynamic, so it is read per request. */
export function trendNow(): number {
  return Date.now()
}
