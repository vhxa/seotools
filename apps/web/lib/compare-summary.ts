import type { PairAssessment, PairNoteCode } from '@seotools/core/crawl/compare'
import {
  CONFIGURATION_REASONS,
  SIDE_REASONS,
  type ComparisonReason,
  type ComparisonSide,
} from '@seotools/core/crawl/comparison-reasons'
import { compareCrawlDiscovery, type CrawlDiscoveryInput } from '@seotools/core/crawl/discovery'
import type { Crawl, CrawlComparisonCounts } from '@seotools/db'

/**
 * What the top of a comparison says, in a few lines: which builds ran each crawl, which recorded
 * settings differ between them (WP2's `compareCrawlDiscovery`),
 * what the URLs that one of them lacks come down to, how far findings compare, and, instead of all
 * that, that only totals remain. Pure: it decides what is said; the page decides how it looks.
 */

/** What the summary reads of each crawl: its discovery snapshot and the builds that made it. */
export type SummaryCrawl = CrawlDiscoveryInput &
  Pick<Crawl, 'ignoredParameters' | 'startedBuild' | 'runBuilds' | 'analysisBuild'>

/** The builds that queued, ran and analysed a crawl, as recorded (`null`: before 0.8.0). */
export type CrawlBuilds = Pick<Crawl, 'startedBuild' | 'runBuilds' | 'analysisBuild'>

/** Whether a URL's reasons have been worked out for this pair. */
export type ExplanationState = 'done' | 'preparing' | 'failed' | 'unavailable'

export type SummaryLine =
  | {
      kind: 'builds'
      base: CrawlBuilds
      target: CrawlBuilds
    }
  | {
      kind: 'settings'
      /** Settings that differ, in the order given. */
      changed: string[]
      /** Settings a side did not record: whether they differ is not known. */
      unrecorded: string[]
      /** Ignored parameters each crawl added or dropped, when that is what changed. */
      ignored: { added: string[]; removed: string[] }
    }
  | {
      kind: 'urls'
      state: ExplanationState
      configuration: number
      missing: number
      added: number
      /** Not seen and discovered by reason, largest first; empty while not explained. */
      reasons: Record<'missing' | 'added', { reason: ComparisonReason; count: number }[]>
      /** The crawls that stopped at their URL limit. */
      limited: ComparisonSide[]
    }
  | {
      kind: 'findings'
      /** `usual`, `basis` (only the server's answers compare) or `unanalysed` (no findings). */
      basis: 'usual' | 'basis' | 'unanalysed'
      caveats: PairNoteCode[]
    }
  | { kind: 'pruned' }

const CAVEATS: readonly PairNoteCode[] = [
  'audit',
  'catalog',
  'ignoredParameters',
  'legacy',
  'incomplete',
]

const byCount = (reasons: Partial<Record<ComparisonReason, number>>, allowed: readonly string[]) =>
  Object.entries(reasons)
    .filter(
      (entry): entry is [ComparisonReason, number] =>
        allowed.includes(entry[0]) &&
        !(CONFIGURATION_REASONS as readonly string[]).includes(entry[0]) &&
        (entry[1] ?? 0) > 0,
    )
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || allowed.indexOf(a.reason) - allowed.indexOf(b.reason))

export function summarizeComparison(input: {
  assessment: PairAssessment
  base: SummaryCrawl
  target: SummaryCrawl
  /** `null` when the results per URL of a side are gone. */
  counts: CrawlComparisonCounts | null
  explanation: ExplanationState
}): SummaryLine[] {
  const { assessment, counts } = input
  if (assessment.notes.some((note) => note.code === 'pruned') || !counts)
    return [{ kind: 'pruned' }]

  const ignored = (crawl: SummaryCrawl) => new Set(crawl.ignoredParameters ?? [])
  const before = ignored(input.base)
  const after = ignored(input.target)
  // WP2: every recorded discovery setting, compared; a side that did not record one says unknown.
  const settings = compareCrawlDiscovery(input.base, input.target)
  const builds = (crawl: SummaryCrawl): CrawlBuilds => ({
    startedBuild: crawl.startedBuild,
    runBuilds: crawl.runBuilds,
    analysisBuild: crawl.analysisBuild,
  })
  const lines: SummaryLine[] = [
    { kind: 'builds', base: builds(input.base), target: builds(input.target) },
    {
      kind: 'settings',
      changed: settings.filter((s) => s.status === 'different').map((s) => s.setting),
      unrecorded: settings.filter((s) => s.status === 'unknown').map((s) => s.setting),
      ignored: {
        added: [...after].filter((name) => !before.has(name)).sort(),
        removed: [...before].filter((name) => !after.has(name)).sort(),
      },
    },
  ]

  const explained = input.explanation === 'done' && counts.explained
  lines.push({
    kind: 'urls',
    state: input.explanation === 'done' && !counts.explained ? 'preparing' : input.explanation,
    configuration: counts.configuration,
    missing: counts.missing,
    added: counts.added,
    reasons: {
      missing: explained ? byCount(counts.reasons.base, SIDE_REASONS.base) : [],
      added: explained ? byCount(counts.reasons.target, SIDE_REASONS.target) : [],
    },
    limited: assessment.notes.find((note) => note.code === 'incomplete')?.sides ?? [],
  })

  const has = (code: PairNoteCode) => assessment.notes.some((note) => note.code === code)
  lines.push({
    kind: 'findings',
    basis: !assessment.findings ? 'unanalysed' : has('basis') ? 'basis' : 'usual',
    caveats: CAVEATS.filter(has),
  })
  return lines
}
