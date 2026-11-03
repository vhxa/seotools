import { auditSnapshotOf } from '@seotools/core/crawl/audit'
import type { Crawl, CrawlUrlComparison, CrawlUrlTrace } from '@seotools/db'
import { describe, expect, it } from 'vitest'
import { parseCompareQuery } from './compare-query'
import { loadComparison, type ComparisonSource } from './crawl-compare'

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
    acceptNofollow: false,
    indexability: 'indexable',
    blockers: [],
  },
})

/** A source that records what it was asked and answers from fixtures. */
function source(options: {
  rows?: CrawlUrlComparison[]
  total?: number
  traces?: CrawlUrlTrace[]
}) {
  const calls: { listed?: unknown; counted?: unknown; history?: unknown } = {}
  const db: ComparisonSource = {
    async compareCounts() {
      return {
        added: 0,
        missing: 0,
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
})
