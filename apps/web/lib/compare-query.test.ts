import { describe, expect, it } from 'vitest'
import { CRAWL_CHANGES } from '@seotools/core/crawl/compare'
import {
  COMPARE_GROUPS,
  compareHref,
  groupOfChange,
  parseCompareQuery,
  type CompareQuery,
} from './compare-query'

const base: CompareQuery = {
  from: null,
  to: null,
  change: 'missing',
  view: 'pages',
  page: 1,
  search: '',
  issue: null,
  reason: null,
  row: null,
}
const a = '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f11'
const b = '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f12'

describe('parseCompareQuery', () => {
  it('has defaults for an empty address', () => {
    expect(parseCompareQuery({})).toEqual(base)
  })

  it('reads every parameter', () => {
    expect(
      parseCompareQuery({
        from: a,
        to: b,
        change: 'gained',
        view: 'other',
        page: '4',
        q: ' blog ',
        issue: 'title-missing',
      }),
    ).toEqual({
      from: a,
      to: b,
      change: 'gained',
      view: 'other',
      page: 4,
      search: 'blog',
      issue: 'title-missing',
      reason: null,
      row: null,
    })
  })

  it('ignores what is not valid', () => {
    expect(
      parseCompareQuery({
        from: "x' or 1=1 --",
        to: 'nope',
        change: 'deleted',
        view: 'external',
        page: '-3',
        issue: 'toString',
      }),
    ).toEqual(base)
  })

  it('takes the first value of a repeated parameter and caps the search', () => {
    expect(parseCompareQuery({ change: ['lost', 'gained'] }).change).toBe('lost')
    expect(parseCompareQuery({ q: 'x'.repeat(500) }).search).toHaveLength(200)
  })
})

describe('compareHref', () => {
  it('leaves defaults out', () => {
    expect(compareHref('acme.com', base)).toBe('/domains/acme.com/crawls/compare')
  })

  it('writes what differs from the defaults, the crawls first', () => {
    expect(
      compareHref('acme.com', {
        ...base,
        from: a,
        to: b,
        change: 'lost',
        view: 'other',
        search: 'a b',
        issue: 'noindex',
        page: 2,
      }),
    ).toBe(
      `/domains/acme.com/crawls/compare?from=${a}&to=${b}&change=lost&view=other&q=a+b&issue=noindex&page=2`,
    )
  })

  it('does not carry an issue to changes that have no findings', () => {
    expect(compareHref('acme.com', { ...base, issue: 'noindex' }, { change: 'title' })).toBe(
      '/domains/acme.com/crawls/compare?change=title',
    )
  })

  it('keeps a reason only for the URLs one crawl lacks, and ignores one it does not know', () => {
    expect(compareHref('acme.com', { ...base, change: 'added', reason: 'notReached' })).toBe(
      '/domains/acme.com/crawls/compare?change=added&why=notReached',
    )
    expect(compareHref('acme.com', { ...base, reason: 'unlinked' }, { change: 'title' })).toBe(
      '/domains/acme.com/crawls/compare?change=title',
    )
    expect(parseCompareQuery({ change: 'configuration', why: 'merged' })).toMatchObject({
      change: 'configuration',
      reason: 'merged',
    })
    expect(parseCompareQuery({ why: 'gone' }).reason).toBeNull()
  })

  it('keeps the open row only for the URLs one crawl lacks, and only a real hash', () => {
    const row = 'a'.repeat(32)
    expect(compareHref('acme.com', { ...base, change: 'added', row })).toBe(
      `/domains/acme.com/crawls/compare?change=added&row=${row}`,
    )
    expect(compareHref('acme.com', { ...base, row }, { change: 'title' })).toBe(
      '/domains/acme.com/crawls/compare?change=title',
    )
    expect(parseCompareQuery({ change: 'missing', row }).row).toBe(row)
    expect(parseCompareQuery({ row: 'nope' }).row).toBeNull()
  })

  it('round-trips through parseCompareQuery', () => {
    const query: CompareQuery = {
      from: a,
      to: b,
      change: 'gained',
      view: 'other',
      page: 3,
      search: '50% off & more',
      issue: 'noindex',
      reason: null,
      row: null,
    }
    const params = Object.fromEntries(
      new URL(compareHref('acme.com', query), 'https://x').searchParams,
    )
    expect(parseCompareQuery(params)).toEqual(query)
  })
})

describe('COMPARE_GROUPS', () => {
  it('puts every kind of change in exactly one group', () => {
    const grouped = COMPARE_GROUPS.flatMap((group) => [...group.changes])
    expect([...grouped].sort()).toEqual([...CRAWL_CHANGES].sort())
    for (const change of CRAWL_CHANGES) expect(groupOfChange(change).changes).toContain(change)
  })
})
