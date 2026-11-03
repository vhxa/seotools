import { describe, expect, it } from 'vitest'
import { compareHref, parseCompareQuery, type CompareQuery } from './compare-query'

const base: CompareQuery = {
  from: null,
  to: null,
  change: 'added',
  view: 'pages',
  page: 1,
  search: '',
  issue: null,
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
    expect(compareHref('acme.com', base)).toBe('/domains/acme.com/pages/compare')
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
      `/domains/acme.com/pages/compare?from=${a}&to=${b}&change=lost&view=other&q=a+b&issue=noindex&page=2`,
    )
  })

  it('does not carry an issue to changes that have no findings', () => {
    expect(compareHref('acme.com', { ...base, issue: 'noindex' }, { change: 'title' })).toBe(
      '/domains/acme.com/pages/compare?change=title',
    )
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
    }
    const params = Object.fromEntries(
      new URL(compareHref('acme.com', query), 'https://x').searchParams,
    )
    expect(parseCompareQuery(params)).toEqual(query)
  })
})
