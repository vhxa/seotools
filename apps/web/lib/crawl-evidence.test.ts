import { auditSnapshotOf } from '@seotools/core/crawl/audit'
import type { Crawl, CrawlUrlTrace } from '@seotools/db'
import { describe, expect, it } from 'vitest'
import { evidenceOf, findingChangesBetween, indexTraces, urlEvidenceOf } from './crawl-evidence'

let n = 0
const crawl = (id: string, overrides: Partial<Crawl> = {}): Crawl => ({
  id,
  domainId: 'd1',
  type: 'full',
  status: 'completed',
  trigger: 'manual',
  jobId: 'j',
  pagesCount: 1,
  urlsCount: 1,
  urlsDoneCount: 1,
  externalCount: 0,
  pagesByWorstIssue: { issue: 0, warning: 0, opportunity: 0 },
  pagesWithType: { issue: 0, warning: 0, opportunity: 0 },
  issueCatalog: 'cat',
  pagesAudit: { audited: 1, excluded: 0, indexable: 1, notIndexable: 0, unknownIndexability: 0 },
  auditVersion: 1,
  auditSnapshot: auditSnapshotOf(1, []),
  robots: null,
  pruned: false,
  error: null,
  createdAt: new Date(2026, 0, ++n),
  startedAt: null,
  finishedAt: null,
  ...overrides,
})

const trace = (
  crawlId: string,
  issues: string[],
  overrides: Partial<CrawlUrlTrace> = {},
): CrawlUrlTrace => ({
  crawlId,
  urlHash: 'h',
  url: 'https://acme.com/',
  snapshot: {
    state: 'done',
    kind: 'page',
    statusCode: 200,
    redirectTo: null,
    title: 'Home',
    canonical: null,
    metaRobots: null,
    xRobotsTag: null,
    error: null,
    depth: 0,
  },
  issues: issues.map((issue) => ({ urlHash: 'h', issue })),
  audit: {
    urlHash: 'h',
    participation: 'audited',
    participationRule: null,
    intent: 'indexable',
    intentRule: null,
    conditions: {},
    indexability: 'indexable',
    blockers: [],
  },
  ...overrides,
})

describe('urlEvidenceOf', () => {
  it('reads a trace in the terms findings are judged by', () => {
    expect(urlEvidenceOf(trace('a', ['noindex']))).toEqual({
      requested: true,
      participation: 'audited',
      intent: 'indexable',
      conditions: '',
      issues: new Set(['noindex']),
    })
  })

  it('reads what rules asked of the conditions of the URL, whatever the crawl saw', () => {
    const conditions = {
      sitemap: { requirement: 'required' as const, rule: 'r2', observed: 'absent' as const },
      noindex: { requirement: 'allowed' as const, rule: 'r1', observed: null },
    }
    const base = trace('a', [])
    const withConditions = urlEvidenceOf({
      ...base,
      audit: { ...base.audit!, conditions },
    })
    expect(withConditions.conditions).toBe('noindex=allowed,sitemap=required')
    // What was observed is not what was asked: the same requirements are the same basis.
    const observedOtherwise = urlEvidenceOf({
      ...base,
      audit: {
        ...base.audit!,
        conditions: { ...conditions, sitemap: { ...conditions.sitemap, observed: 'present' } },
      },
    })
    expect(observedOtherwise.conditions).toBe(withConditions.conditions)
  })

  it('does not make up an audit state the analysis did not keep', () => {
    expect(urlEvidenceOf(trace('a', [], { audit: null }))).toMatchObject({
      participation: null,
      intent: null,
    })
  })

  it('knows a URL that was found and not requested', () => {
    const queued = trace('a', [])
    expect(
      urlEvidenceOf({ ...queued, snapshot: { ...queued.snapshot, state: 'queued' } }).requested,
    ).toBe(false)
  })
})

describe('findingChangesBetween', () => {
  const crawls = ['c1', 'c2', 'c3', 'c4'].map((id) => crawl(id))
  const evidence = (traces: CrawlUrlTrace[], list = crawls) =>
    evidenceOf(list, indexTraces(traces), 'h')

  it('classifies the findings between two crawls', () => {
    const e = evidence([
      trace('c1', ['title-missing']),
      trace('c2', []),
      trace('c3', ['h1-missing']),
      trace('c4', ['h1-missing']),
    ])
    expect(
      findingChangesBetween(crawls, e, 'c3', 'c4')?.map((c) => `${c.kind}:${c.issue}`),
    ).toEqual(['persistent:h1-missing'])
    expect(
      findingChangesBetween(crawls, e, 'c1', 'c2')?.map((c) => `${c.kind}:${c.issue}`),
    ).toEqual(['resolved:title-missing'])
  })

  it('finds a reappearance through the crawls before and between', () => {
    const e = evidence([
      trace('c1', ['title-missing']),
      trace('c2', []),
      trace('c3', []),
      trace('c4', ['title-missing']),
    ])
    expect(findingChangesBetween(crawls, e, 'c3', 'c4')?.[0]).toMatchObject({ kind: 'reappeared' })
    expect(findingChangesBetween(crawls, e, 'c1', 'c4')?.[0]).toMatchObject({ kind: 'reappeared' })
  })

  it('does not call it a reappearance when the crawl that would show the gap has no results', () => {
    const list = [crawls[0]!, crawl('gap', { pruned: true }), crawls[3]!]
    const e = evidence([trace('c1', ['title-missing']), trace('c4', ['title-missing'])], list)
    expect(findingChangesBetween(list, e, 'c1', 'c4')?.[0]).toMatchObject({ kind: 'persistent' })
  })

  it('does not call a missing URL a resolved finding', () => {
    const e = evidence([trace('c1', ['title-missing'])])
    expect(findingChangesBetween(crawls, e, 'c1', 'c2')?.[0]).toMatchObject({
      kind: 'unverified',
      reasons: ['not-seen'],
    })
  })

  it('is null for crawls it was not given, or given the wrong way round', () => {
    const e = evidence([])
    expect(findingChangesBetween(crawls, e, 'c1', 'nope')).toBeNull()
    expect(findingChangesBetween(crawls, e, 'c3', 'c1')).toBeNull()
  })
})
