import type { Crawl } from '@seotools/db'
import { describe, expect, it } from 'vitest'
import {
  browsableCrawls,
  coverageOf,
  findCrawl,
  selectCrawl,
  selectPair,
  type CrawlSource,
} from './crawl-history'

let counter = 0
function crawl(overrides: Partial<Crawl> & { id: string }): Crawl {
  counter++
  return {
    domainId: 'd1',
    type: 'full',
    status: 'completed',
    trigger: 'manual',
    jobId: 'job',
    pagesCount: 1,
    urlsCount: 1,
    urlsDoneCount: 1,
    externalCount: 0,
    pagesByWorstIssue: null,
    pagesWithType: null,
    issueCatalog: null,
    pagesAudit: null,
    auditVersion: null,
    auditSnapshot: null,
    robots: null,
    pruned: false,
    error: null,
    createdAt: new Date(2026, 0, counter),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  }
}

/** A database with the crawls of several domains, as `getInDomain` and `list` see them. */
function source(all: Crawl[]): CrawlSource {
  return {
    async getInDomain(domainId, id) {
      return all.find((c) => c.id === id && c.domainId === domainId) ?? null
    },
    async list(domainId, options) {
      return all
        .filter((c) => c.domainId === domainId && (!options?.type || c.type === options.type))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, options?.limit ?? 20)
    },
    async latestWithResults(domainId, type) {
      return (
        all
          .filter(
            (c) =>
              c.domainId === domainId &&
              c.type === type &&
              (c.status === 'completed' || c.status === 'incomplete') &&
              !c.pruned,
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
      )
    },
  }
}

const mine = [
  crawl({ id: 'a', pruned: true }),
  crawl({ id: 'b' }),
  crawl({ id: 'c', status: 'failed' }),
  crawl({ id: 'd', status: 'incomplete' }),
  crawl({ id: 'p', type: 'priority' }),
]
const foreign = crawl({ id: 'x', domainId: 'd2' })
const db = source([...mine, foreign])

describe('browsableCrawls', () => {
  it('lists the full crawls with results, newest first, pruned ones included', async () => {
    expect((await browsableCrawls(db, 'd1')).map((c) => c.id)).toEqual(['d', 'b', 'a'])
    expect((await browsableCrawls(db, 'd2')).map((c) => c.id)).toEqual(['x'])
    expect(await browsableCrawls(db, 'nobody')).toEqual([])
  })
})

describe('findCrawl', () => {
  it('finds a browsable crawl of the domain', async () => {
    expect((await findCrawl(db, 'd1', 'b'))?.id).toBe('b')
    expect((await findCrawl(db, 'd1', 'a'))?.pruned).toBe(true)
  })

  it('does not find another domain’s crawl, or one that does not exist', async () => {
    expect(await findCrawl(db, 'd1', 'x')).toBeNull()
    expect(await findCrawl(db, 'd2', 'b')).toBeNull()
    expect(await findCrawl(db, 'd1', 'nope')).toBeNull()
  })

  it('does not find a crawl without results, or a priority crawl', async () => {
    expect(await findCrawl(db, 'd1', 'c')).toBeNull()
    expect(await findCrawl(db, 'd1', 'p')).toBeNull()
  })
})

describe('coverageOf', () => {
  it('says whether a crawl still has its results', () => {
    expect(coverageOf({ pruned: false })).toBe('retained')
    expect(coverageOf({ pruned: true })).toBe('pruned')
  })
})

describe('selectCrawl', () => {
  it('is the latest one by default', async () => {
    const selection = await selectCrawl(db, 'd1', null)
    expect(selection).toMatchObject({ kind: 'selected', historical: false })
    expect(selection.kind === 'selected' && selection.crawl.id).toBe('d')
  })

  it('has nothing to select when the domain has no crawl with results', async () => {
    expect(await selectCrawl(db, 'nobody', null)).toEqual({ kind: 'empty' })
  })

  it('is a historical one when the address names an earlier crawl', async () => {
    const selection = await selectCrawl(db, 'd1', 'b')
    expect(selection).toMatchObject({ kind: 'selected', historical: true })
    expect(selection.kind === 'selected' && selection.latest?.id).toBe('d')
  })

  it('is not historical when the address names the latest crawl', async () => {
    expect(await selectCrawl(db, 'd1', 'd')).toMatchObject({ kind: 'selected', historical: false })
  })

  it('selects a pruned crawl, which the page then shows by its totals', async () => {
    expect(await selectCrawl(db, 'd1', 'a')).toMatchObject({
      kind: 'selected',
      historical: true,
      crawl: { id: 'a', pruned: true },
    })
  })

  it('is missing for a crawl of another domain, one that does not exist, or one with no results', async () => {
    for (const id of ['x', 'nope', 'c', 'p']) {
      expect(await selectCrawl(db, 'd1', id)).toEqual({ kind: 'missing' })
    }
    // Another domain's crawl cannot be reached through this domain even when it has no crawls of its own.
    expect(await selectCrawl(db, 'nobody', 'b')).toEqual({ kind: 'missing' })
  })
})

describe('selectPair', () => {
  it('defaults to the newest crawl against the retained one before it', async () => {
    const pair = await selectPair(db, 'd1', null, null)
    expect(pair).toMatchObject({ kind: 'pair', base: { id: 'b' }, target: { id: 'd' } })
    expect(pair.kind === 'pair' && pair.crawls.map((c) => c.id)).toEqual(['a', 'b', 'd'])
  })

  it('skips pruned crawls for the default earlier crawl, unless nothing else is left', async () => {
    const onlyPruned = source([
      crawl({ id: 'o1', pruned: true }),
      crawl({ id: 'o2', pruned: true }),
      crawl({ id: 'o3' }),
    ])
    expect(await selectPair(onlyPruned, 'd1', null, null)).toMatchObject({
      base: { id: 'o2' },
      target: { id: 'o3' },
    })
    const retainedFirst = source([
      crawl({ id: 'r1' }),
      crawl({ id: 'r2', pruned: true }),
      crawl({ id: 'r3' }),
    ])
    expect(await selectPair(retainedFirst, 'd1', null, null)).toMatchObject({
      base: { id: 'r1' },
      target: { id: 'r3' },
    })
  })

  it('has nothing to compare with fewer than two crawls', async () => {
    expect(await selectPair(source([crawl({ id: 'only' })]), 'd1', null, null)).toEqual({
      kind: 'empty',
    })
    expect(await selectPair(source([]), 'd1', null, null)).toEqual({ kind: 'empty' })
  })

  it('puts the crawls in order whichever way they were asked for', async () => {
    expect(await selectPair(db, 'd1', 'd', 'a')).toMatchObject({
      kind: 'pair',
      base: { id: 'a' },
      target: { id: 'd' },
    })
    expect(await selectPair(db, 'd1', 'a', 'd')).toMatchObject({
      base: { id: 'a' },
      target: { id: 'd' },
    })
  })

  it('takes either side from the address and the other from the defaults', async () => {
    expect(await selectPair(db, 'd1', 'a', null)).toMatchObject({
      base: { id: 'a' },
      target: { id: 'd' },
    })
    expect(await selectPair(db, 'd1', null, 'b')).toMatchObject({
      base: { id: 'a' },
      target: { id: 'b' },
    })
  })

  it('says when the same crawl was chosen twice', async () => {
    expect(await selectPair(db, 'd1', 'b', 'b')).toMatchObject({ kind: 'same', crawl: { id: 'b' } })
    expect(await selectPair(db, 'd1', 'd', null)).toMatchObject({ kind: 'same' })
  })

  it('is missing when either crawl is not the domain’s, whatever the other is', async () => {
    for (const [from, to] of [
      ['x', 'b'],
      ['b', 'x'],
      ['nope', null],
      [null, 'nope'],
      ['c', 'b'],
      ['p', 'b'],
    ] as const) {
      expect(await selectPair(db, 'd1', from, to), `${from} ${to}`).toEqual({ kind: 'missing' })
    }
  })
})
