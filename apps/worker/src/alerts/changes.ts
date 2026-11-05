import {
  PAGE_ISSUES,
  byAge,
  assessPair,
  compareIssueSeverity,
  evidenceOf,
  findingChangesBetween,
  indexTraces,
  isBrowsableStatus,
  isPageIssueId,
  type CompareView,
  type FindingChange,
  type PageIssueId,
  type PairNoteName,
} from '@seotools/core'
import type { Crawl, Database } from '@seotools/db'

/** URLs read from the database at a time. */
const BATCH = 200
/** Of one kind of change in one view, the most URLs classified. Beyond it the numbers are "at least". */
export const MAX_CLASSIFIED_URLS = 10_000
/** How many of the domain's newest crawls are read to find the one to compare with, and the history. */
const HISTORY_CRAWLS = 100
const VIEWS: CompareView[] = ['pages', 'other']
/** Samples of URLs kept per issue. */
const SAMPLES = 3

export interface FindingTally {
  issue: PageIssueId
  /** URLs with the finding. */
  count: number
  fresh: number
  back: number
  samples: string[]
}

export interface CrawlComparison {
  /** What the crawl is compared with. `null`: there is nothing to compare it with. */
  base: Crawl | null
  /** `first`: no earlier crawl with results. `no-base`: some, but none that completed and kept its results. */
  state: 'first' | 'no-base' | 'compared'
  urls: {
    added: number
    missing: number
    status: number
    title: number
    canonical: number
    robots: number
  }
  /** `null`: they cannot be compared on findings. */
  findings: {
    fresh: number
    back: number
    resolved: number
    unverified: number
    accepted: number
    excluded: number
    audited: number
  } | null
  /** Findings of high importance that are new or back, worst first. Empty unless `findings`. */
  important: FindingTally[]
  notes: PairNoteName[]
  /** Some change was counted only up to `MAX_CLASSIFIED_URLS`. */
  cut: boolean
}

const EMPTY_URLS = { added: 0, missing: 0, status: 0, title: 0, canonical: 0, robots: 0 }

/**
 * What changed between a finished full crawl and the one before it, in the words of
 * `@seotools/core/crawl/compare`, which is the only place that names a change: a finding is new,
 * back, resolved or unverified exactly as the comparison page says. The one before is the latest
 * earlier crawl that completed and still has its results. Reads what the crawls stored; nothing is
 * requested.
 *
 * A change that only exists because the audit rules or the checks changed is `unverified` there, and
 * so is never counted as new or resolved here, and never reaches `important`.
 */
export async function compareWithPrevious(input: {
  db: Database
  target: Crawl
  signal?: AbortSignal
}): Promise<CrawlComparison> {
  const { db, target, signal } = input
  const found = await db.crawls.list(target.domainId, { type: 'full', limit: HISTORY_CRAWLS })
  const history = found
    .filter((crawl) => isBrowsableStatus(crawl.status) && byAge(crawl, target) <= 0)
    .sort(byAge)
  if (!history.some((crawl) => crawl.id === target.id)) history.push(target)
  const earlier = history.filter((crawl) => byAge(crawl, target) < 0)
  const result: CrawlComparison = {
    base: null,
    state: 'first',
    urls: EMPTY_URLS,
    findings: null,
    important: [],
    notes: [],
    cut: false,
  }
  if (earlier.length === 0) return result

  const base = [...earlier].reverse().find((crawl) => crawl.status === 'completed' && !crawl.pruned)
  if (!base) return { ...result, state: 'no-base' }
  const assessment = assessPair(base, target)
  if (!assessment.urls) return { ...result, state: 'no-base' }
  result.base = base
  result.state = 'compared'
  result.notes = assessment.notes.map((note) => note.code satisfies PairNoteName)
  const ids = { domainId: target.domainId, baseId: base.id, targetId: target.id }

  for (const view of VIEWS) {
    const counts = await db.crawls.compareCounts({ ...ids, view })
    if (!counts) continue
    result.urls = {
      added: result.urls.added + counts.added,
      missing: result.urls.missing + counts.missing,
      status: result.urls.status + counts.status,
      title: result.urls.title + counts.title,
      canonical: result.urls.canonical + counts.canonical,
      robots: result.urls.robots + counts.robots,
    }
  }
  if (!assessment.findings) return result

  const totals = {
    fresh: 0,
    back: 0,
    resolved: 0,
    unverified: 0,
    accepted: 0,
    excluded: 0,
    audited: 0,
  }
  const important = new Map<PageIssueId, FindingTally>()
  const crawlIds = history.filter((crawl) => !crawl.pruned).map((crawl) => crawl.id)

  for (const view of VIEWS) {
    for (const change of ['gained', 'lost'] as const) {
      const query = { ...ids, view, change }
      const total = await db.crawls.countCompared(query)
      if (total > MAX_CLASSIFIED_URLS) result.cut = true
      for (let offset = 0; offset < Math.min(total, MAX_CLASSIFIED_URLS); offset += BATCH) {
        if (signal?.aborted) throw new DOMException('Stopped', 'AbortError')
        const rows = await db.crawls.compareUrls({ ...query, limit: BATCH, offset })
        if (rows.length === 0) break
        const traces = indexTraces(
          await db.crawls.urlHistory({
            ...ids,
            crawlIds,
            urlHashes: rows.map((row) => row.urlHash),
          }),
        )
        for (const row of rows) {
          const changes: FindingChange[] =
            findingChangesBetween(
              history,
              evidenceOf(history, traces, row.urlHash),
              base.id,
              target.id,
            ) ?? []
          for (const finding of changes) {
            // A URL can both gain and lose findings: each is counted in the direction it went.
            const gained = change === 'gained' && finding.reportedBy === 'target'
            const lost = change === 'lost' && finding.reportedBy === 'base'
            if (gained && finding.kind === 'new') totals.fresh++
            else if (gained && finding.kind === 'reappeared') totals.back++
            else if (gained && finding.kind === 'audited') totals.audited++
            else if (lost && finding.kind === 'resolved') totals.resolved++
            else if (lost && finding.kind === 'accepted') totals.accepted++
            else if (lost && finding.kind === 'excluded') totals.excluded++
            else if ((gained || lost) && finding.kind === 'unverified') totals.unverified++

            if (
              gained &&
              (finding.kind === 'new' || finding.kind === 'reappeared') &&
              isPageIssueId(finding.issue) &&
              PAGE_ISSUES[finding.issue].importance === 'high'
            ) {
              const tally = important.get(finding.issue) ?? {
                issue: finding.issue,
                count: 0,
                fresh: 0,
                back: 0,
                samples: [],
              }
              tally.count++
              if (finding.kind === 'new') tally.fresh++
              else tally.back++
              if (tally.samples.length < SAMPLES) tally.samples.push(row.url)
              important.set(finding.issue, tally)
            }
          }
        }
      }
    }
  }
  result.findings = totals
  result.important = [...important.values()].sort(
    (a, b) =>
      compareIssueSeverity(a.issue, b.issue) || b.count - a.count || (a.issue < b.issue ? -1 : 1),
  )
  return result
}
