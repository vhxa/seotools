import type { PairAssessment } from '@seotools/core/crawl/compare'
import { snapshotCrawlDiscovery } from '@seotools/core/crawl/discovery'
import { DEFAULT_CRAWL_SETTINGS } from '@seotools/core/crawl/settings'
import type { CrawlComparisonCounts } from '@seotools/db'
import { describe, expect, it } from 'vitest'
import { summarizeComparison, type SummaryCrawl } from './compare-summary'

const build = { version: '0.8.0', channel: 'release' as const, commit: null }
const recorded = (overrides: Partial<typeof DEFAULT_CRAWL_SETTINGS> = {}): SummaryCrawl => ({
  discoverySettings: snapshotCrawlDiscovery({ ...DEFAULT_CRAWL_SETTINGS, ...overrides }, false),
  rendering: { mode: 'html', waitMs: 0, omittedHosts: [] },
  ignoredParameters: overrides.ignoredParameters ?? [],
  startedBuild: build,
  runBuilds: { builds: [build], earlierRunUnrecorded: false, overflow: false },
  analysisBuild: build,
})
/** A crawl from before 0.8.0: no discovery snapshot and no builds. */
const legacy: SummaryCrawl = {
  discoverySettings: null,
  rendering: null,
  ignoredParameters: [],
  startedBuild: null,
  runBuilds: null,
  analysisBuild: null,
}
const counts = (overrides: Partial<CrawlComparisonCounts> = {}): CrawlComparisonCounts => ({
  added: 192,
  missing: 252,
  configuration: 506,
  explained: true,
  reasons: {
    base: { merged: 506, unlinked: 111, notReached: 89, unknown: 52 },
    target: { linked: 56, notReached: 88, unknown: 48 },
  },
  unrequested: 0,
  compared: 0,
  status: 0,
  title: 0,
  canonical: 0,
  robots: 0,
  gained: 0,
  lost: 0,
  ...overrides,
})
const assessment = (notes: PairAssessment['notes'] = [], findings = true): PairAssessment => ({
  urls: true,
  findings,
  notes,
})

describe('summarizeComparison', () => {
  const summary = (input: Partial<Parameters<typeof summarizeComparison>[0]> = {}) =>
    summarizeComparison({
      assessment: assessment(),
      base: recorded(),
      target: recorded({ ignoredParameters: ['duration'] }),
      counts: counts(),
      explanation: 'done',
      ...input,
    })
  const line = <K extends string>(lines: ReturnType<typeof summary>, kind: K) =>
    lines.find((l) => l.kind === kind)

  it('says only totals remain when a crawl was pruned', () => {
    expect(
      summary({
        assessment: { urls: false, findings: false, notes: [{ code: 'pruned', sides: ['base'] }] },
        counts: null,
      }),
    ).toEqual([{ kind: 'pruned' }])
  })

  it('names the recorded settings that differ, from the discovery snapshots', () => {
    expect(line(summary(), 'settings')).toEqual({
      kind: 'settings',
      changed: ['ignoredParameters'],
      unrecorded: [],
      ignored: { added: ['duration'], removed: [] },
    })
    expect(
      line(
        summary({ base: recorded({ maxDepth: 3 }), target: recorded({ maxUrls: 50 }) }),
        'settings',
      ),
    ).toMatchObject({ changed: ['maxDepth', 'maxUrls'], unrecorded: [] })
  })

  it('says what a crawl from before 0.8.0 did not record, never that it is the same', () => {
    const settings = line(summary({ base: legacy }), 'settings')
    expect(settings).toMatchObject({ changed: ['ignoredParameters'] })
    expect((settings as { unrecorded: string[] }).unrecorded).toEqual(
      expect.arrayContaining([
        'maxDepth',
        'maxUrls',
        'includePrefixes',
        'userAgent',
        'renderingMode',
      ]),
    )
    expect(line(summary({ base: legacy }), 'builds')).toEqual({
      kind: 'builds',
      base: { startedBuild: null, runBuilds: null, analysisBuild: null },
      target: {
        startedBuild: build,
        runBuilds: { builds: [build], earlierRunUnrecorded: false, overflow: false },
        analysisBuild: build,
      },
    })
  })

  it('counts the URLs by reason, configuration apart, and never before the pair is explained', () => {
    expect(line(summary(), 'urls')).toEqual({
      kind: 'urls',
      state: 'done',
      configuration: 506,
      missing: 252,
      added: 192,
      reasons: {
        missing: [
          { reason: 'unlinked', count: 111 },
          { reason: 'notReached', count: 89 },
          { reason: 'unknown', count: 52 },
        ],
        added: [
          { reason: 'notReached', count: 88 },
          { reason: 'linked', count: 56 },
          { reason: 'unknown', count: 48 },
        ],
      },
      limited: [],
    })
    expect(
      line(summary({ explanation: 'preparing', counts: counts({ explained: false }) }), 'urls'),
    ).toMatchObject({ state: 'preparing', reasons: { missing: [], added: [] } })
    expect(line(summary({ counts: counts({ explained: false }) }), 'urls')).toMatchObject({
      state: 'preparing',
    })
  })

  it('maps every pair note to the line that says it', () => {
    const lines = summary({
      assessment: assessment([
        { code: 'basis', sides: ['base', 'target'] },
        { code: 'audit', sides: ['base', 'target'] },
        { code: 'catalog', sides: ['base', 'target'] },
        { code: 'ignoredParameters', sides: ['base', 'target'] },
        { code: 'legacy', sides: ['base'] },
        { code: 'incomplete', sides: ['target'] },
      ]),
    })
    expect(line(lines, 'findings')).toEqual({
      kind: 'findings',
      basis: 'basis',
      caveats: ['audit', 'catalog', 'ignoredParameters', 'legacy', 'incomplete'],
    })
    expect(line(lines, 'urls')).toMatchObject({ limited: ['target'] })
    expect(
      line(
        summary({ assessment: assessment([{ code: 'unanalysed', sides: ['base'] }], false) }),
        'findings',
      ),
    ).toMatchObject({ basis: 'unanalysed' })
  })
})
