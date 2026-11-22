import { auditSnapshotOf } from '@seotools/core/crawl/audit'
import type {
  ComparisonHeader,
  Crawl,
  CrawlUrlComparison,
  CrawlUrlTrace,
  ExplanationDetails,
  VerifiedUrl,
} from '@seotools/db'
import { EXPLANATION_VERSION } from '@seotools/core/crawl/comparison-reasons'
import { describe, expect, it } from 'vitest'
import { parseCompareQuery } from './compare-query'
import { loadComparison, type ComparisonSource } from './crawl-compare'

let n = 0
const crawl = (id: string, overrides: Partial<Crawl> = {}): Crawl => ({
  id,
  startedBuild: null,
  runBuilds: null,
  analysisBuild: null,
  discoverySettings: null,
  rendering: null,
  browserWaitMs: 0,
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
  renderObservation: null,
  robots: null,
  pruned: false,
  history: false,
  ref: 1,
  error: null,
  createdAt: new Date(2026, 0, ++n),
  startedAt: null,
  finishedAt: null,
  ...overrides,
})

const snapshot = {
  state: 'done' as const,
  kind: 'page' as const,
  statusCode: 200,
  redirectTo: null,
  title: 'Home',
  canonical: null,
  metaRobots: null,
  xRobotsTag: null,
  error: null,
  depth: 0,
}
const row = (urlHash: string): CrawlUrlComparison => ({
  urlHash,
  url: `https://acme.com/${urlHash}`,
  base: snapshot,
  target: snapshot,
})
const trace = (crawlId: string, urlHash: string, issues: string[]): CrawlUrlTrace => ({
  crawlId,
  urlHash,
  url: `https://acme.com/${urlHash}`,
  snapshot,
  issues: issues.map((issue) => ({ urlHash, issue })),
  audit: {
    urlHash,
    participation: 'audited',
    participationRule: null,
    intent: 'indexable',
    intentRule: null,
    conditions: {},
    indexability: 'indexable',
    blockers: [],
  },
})

const queued: ComparisonHeader = {
  baseRef: 1,
  targetRef: 2,
  version: EXPLANATION_VERSION,
  state: 'queued',
  runner: null,
  jobId: 'job',
  startedAt: new Date(),
  finishedAt: null,
  failures: 0,
  retryAt: null,
}
const done: ComparisonHeader = { ...queued, state: 'done', finishedAt: new Date() }

/** A source that records what it was asked and answers from fixtures. */
function source(options: {
  rows?: CrawlUrlComparison[]
  total?: number
  traces?: CrawlUrlTrace[]
  header?: ComparisonHeader | null
  details?: ExplanationDetails
}) {
  const calls: {
    listed?: unknown
    counted?: unknown
    history?: unknown
    requested?: unknown
    details?: unknown
  } = {}
  const db: ComparisonSource = {
    async comparisonHeader() {
      return options.header ?? null
    },
    async requestComparison(input) {
      calls.requested = input
      return { ...queued, ...(options.header ?? {}) }
    },
    async explanationDetails(input) {
      calls.details = input
      return (
        options.details ?? {
          urls: { base: new Map(), target: new Map() },
          links: { base: new Map(), target: new Map() },
        }
      )
    },
    async compareCounts() {
      return {
        added: 0,
        missing: 0,
        configuration: 0,
        explained: options.header?.state === 'done',
        reasons: { base: {}, target: {} },
        unrequested: 0,
        compared: 0,
        status: 0,
        title: 0,
        canonical: 0,
        robots: 0,
        gained: 0,
        lost: 0,
      }
    },
    async countCompared(query) {
      calls.counted = query
      return options.total ?? options.rows?.length ?? 0
    },
    async compareUrls(query) {
      calls.listed = query
      return options.rows ?? []
    },
    async urlHistory(input) {
      calls.history = input
      return options.traces ?? []
    },
  }
  return { db, calls }
}

describe('loadComparison', () => {
  const older = crawl('c1')
  const middle = crawl('c2')
  const newer = crawl('c3')
  const history = [older, middle, newer]
  const run = (
    db: ComparisonSource,
    params: Record<string, string>,
    base = older,
    target = newer,
    crawls = history,
  ) =>
    loadComparison({
      crawls: db,
      domainId: 'd1',
      base,
      target,
      history: crawls,
      query: parseCompareQuery(params),
    })

  it('reads only the totals when a crawl was pruned, asking the database for nothing', async () => {
    const { db, calls } = source({ rows: [row('a')] })
    const data = await run(db, {}, crawl('p', { pruned: true }), newer)
    expect(data).toMatchObject({ counts: null, total: 0, rows: [] })
    expect(data.assessment).toMatchObject({ urls: false, findings: false })
    expect(calls).toEqual({})
  })

  it('pages the listing on the server and clamps a page past the end', async () => {
    const { db, calls } = source({ rows: [row('a')], total: 120 })
    const data = await run(db, { change: 'title', page: '9', q: 'blog' })
    expect(data).toMatchObject({ total: 120, pageCount: 3, page: 3 })
    expect(calls.listed).toMatchObject({
      baseId: 'c1',
      targetId: 'c3',
      change: 'title',
      view: 'pages',
      search: 'blog',
      limit: 50,
      offset: 100,
    })
    // Only a page of rows is read, and nothing about findings for a change that has none.
    expect(calls.history).toBeUndefined()
  })

  it('narrows by issue only for the changes that list findings', async () => {
    const { db, calls } = source({ rows: [], total: 0 })
    await run(db, { change: 'title', issue: 'noindex' })
    expect(calls.listed).not.toHaveProperty('issue')
    await run(db, { change: 'gained', issue: 'noindex' })
    expect(calls.listed).toMatchObject({ issue: 'noindex' })
  })

  it('classifies the findings of the URLs on the page, reading the history of just those', async () => {
    const { db, calls } = source({
      rows: [row('a'), row('b')],
      traces: [
        trace('c1', 'a', []),
        trace('c3', 'a', ['title-missing']),
        trace('c1', 'b', ['title-missing']),
        trace('c2', 'b', []),
        trace('c3', 'b', ['title-missing']),
      ],
    })
    const data = await run(db, { change: 'gained' })
    expect(calls.history).toEqual({
      domainId: 'd1',
      crawlIds: ['c1', 'c2', 'c3'],
      urlHashes: ['a', 'b'],
    })
    expect(data.rows.map((r) => r.findings?.map((f) => f.kind))).toEqual([['new'], ['reappeared']])
  })

  it('leaves out the crawls without results when it reads the history', async () => {
    const { db, calls } = source({ rows: [row('a')] })
    await run(db, { change: 'lost' }, older, newer, [older, crawl('gone', { pruned: true }), newer])
    expect(calls.history).toMatchObject({ crawlIds: ['c1', 'c3'] })
  })

  it('does not say anything about findings when a crawl was not analysed', async () => {
    const { db, calls } = source({ rows: [row('a')] })
    const data = await run(
      db,
      { change: 'gained' },
      crawl('na', { pagesByWorstIssue: null }),
      newer,
    )
    expect(data.assessment).toMatchObject({ urls: true, findings: false })
    expect(data.rows.map((r) => r.findings)).toEqual([null])
    expect(calls.history).toBeUndefined()
  })

  it('does not call a finding new or resolved when the issue catalog changed', async () => {
    const other = crawl('c3', { issueCatalog: 'other' })
    const { db } = source({
      rows: [row('a')],
      traces: [trace('c1', 'a', []), trace('c3', 'a', ['title-missing'])],
    })
    const data = await run(db, { change: 'gained' }, older, other, [older, other])
    expect(data.assessment.notes.map((note) => note.code)).toContain('catalog')
    expect(data.rows[0]?.findings).toEqual([
      { issue: 'title-missing', kind: 'unverified', reportedBy: 'target', reasons: ['catalog'] },
    ])
  })

  it('asks for a pair to be explained when it has no current explanation, and says it is under way', async () => {
    const { db, calls } = source({ rows: [] })
    const data = await run(db, { change: 'missing' })
    expect(calls.requested).toEqual({ domainId: 'd1', baseId: 'c1', targetId: 'c3' })
    expect(data.explanation).toBe('preparing')
    expect(data.summary.find((line) => line.kind === 'urls')).toMatchObject({ state: 'preparing' })

    const stale = source({ rows: [], header: { ...done, version: EXPLANATION_VERSION - 1 } })
    expect((await run(stale.db, {})).explanation).toBe('preparing')
    expect(stale.calls.requested).toBeDefined()

    const current = source({ rows: [], header: done })
    expect((await run(current.db, {})).explanation).toBe('done')
    expect(current.calls.requested).toBeUndefined()
  })

  // Finding 7: a pair stored before crawls were numbered says it cannot be explained.
  it('says a pair that cannot be explained cannot be, instead of waiting for it', async () => {
    const { db, calls } = source({ rows: [{ ...row('a'), target: null }] })
    db.requestComparison = async (input) => {
      calls.requested = input
      return null
    }
    const data = await run(db, { change: 'missing' })
    expect(data.explanation).toBe('unavailable')
    expect(data.summary.find((line) => line.kind === 'urls')).toMatchObject({
      state: 'unavailable',
    })
    expect(data.rows[0]?.why).toBeNull()
  })

  it('filters by reason only the URLs one crawl lacks', async () => {
    const { db, calls } = source({ rows: [], header: done })
    await run(db, { change: 'missing', why: 'notReached' })
    expect(calls.listed).toMatchObject({ reason: 'notReached' })
    await run(db, { change: 'title', why: 'notReached' })
    expect(calls.listed).not.toHaveProperty('reason')
  })

  it('gives each row the pages its reason names, the link, and only answers rechecked after the later crawl', async () => {
    const later = crawl('c3', { finishedAt: new Date(2026, 5, 1) })
    const explained: CrawlUrlComparison = {
      ...row('a'),
      target: null,
      explanation: {
        side: 'base',
        seq: 7,
        reason: 'unlinked',
        detail: null,
        via: 1,
        viaKind: 'anchor',
        viaRendered: false,
        through: null,
        sources: 1,
        into: null,
      },
    }
    const answer = (urlHash: string, fetchedAt: Date) =>
      ({
        urlHash,
        statusCode: 404,
        redirectTo: null,
        error: null,
        kind: 'page',
        fetchedAt,
        verificationId: 'v',
      }) as VerifiedUrl
    const { db, calls } = source({
      rows: [explained, { ...row('b'), target: null, explanation: null }],
      header: done,
      details: {
        urls: { base: new Map([[1, 'https://acme.com/']]), target: new Map() },
        links: {
          base: new Map([[7, { kind: 'anchor', rendered: false, context: { text: 'Old' } }]]),
          target: new Map(),
        },
      },
    })
    const data = await loadComparison({
      crawls: db,
      verifications: {
        async latestFor() {
          return [answer('a', new Date(2026, 6, 1)), answer('b', new Date(2026, 4, 1))]
        },
        async active() {
          return null
        },
      },
      domainId: 'd1',
      base: older,
      target: later,
      history: [older, later],
      query: parseCompareQuery({ change: 'missing' }),
    })
    // Asked for the exact edge the reason is about (finding 11).
    expect(calls.details).toMatchObject({
      rows: [{ side: 'base', seq: 7, via: 1, viaKind: 'anchor', through: null }],
    })
    expect(data.rows[0]?.why).toMatchObject({
      via: { url: 'https://acme.com/' },
      link: { kind: 'anchor', context: { text: 'Old' } },
    })
    expect(data.rows[0]?.check).toMatchObject({ statusCode: 404 })
    // Rechecked before the later crawl: the comparison already says more than that.
    expect(data.rows[1]?.check).toBeNull()
    expect(data.rows[1]?.why).toBeNull()
  })
})
