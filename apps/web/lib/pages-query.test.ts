import { describe, expect, it } from 'vitest'
import { detailHref, nextSort, parseDetailQuery, type DetailQuery } from './pages-query'

const base: DetailQuery = {
  crawl: null,
  view: 'pages',
  page: 1,
  sort: null,
  direction: 'asc',
  search: '',
  issue: null,
  participation: null,
  intent: null,
  rule: null,
  url: null,
}

describe('parseDetailQuery', () => {
  it('has defaults for an empty query', () => {
    expect(parseDetailQuery({})).toEqual(base)
  })

  it('reads every parameter', () => {
    const hash = 'a'.repeat(32)
    expect(
      parseDetailQuery({
        crawl: '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f12',
        view: 'pages',
        page: '3',
        sort: 'responseTime',
        dir: 'desc',
        q: '  blog ',
        issue: 'title-missing',
        audit: 'excluded',
        intent: 'not-indexable',
        rule: '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f11',
        url: hash,
      }),
    ).toEqual({
      crawl: '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f12',
      view: 'pages',
      page: 3,
      sort: 'responseTime',
      direction: 'desc',
      search: 'blog',
      issue: 'title-missing',
      participation: 'excluded',
      intent: 'not-indexable',
      rule: '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f11',
      url: hash,
    })
  })

  it('ignores what is not valid', () => {
    expect(
      parseDetailQuery({
        view: 'everything',
        page: '-2',
        sort: 'nope',
        dir: 'sideways',
        issue: 'toString',
        audit: 'maybe',
        intent: 'whatever',
        rule: "x' or 1=1 --",
        url: 'not-a-hash',
        crawl: "x' or 1=1 --",
      }),
    ).toEqual(base)
    expect(parseDetailQuery({ page: 'abc' }).page).toBe(1)
    expect(parseDetailQuery({ page: '2.9' }).page).toBe(2)
  })

  it('shows an issue wherever its URLs are, whatever view the address says', () => {
    expect(parseDetailQuery({ view: 'other', issue: 'client-error' })).toMatchObject({
      view: 'pages',
      issue: 'client-error',
    })
    expect(parseDetailQuery({ view: 'other', issue: 'nope' }).view).toBe('other')
  })

  it('takes the first value of a repeated parameter and caps the search', () => {
    expect(parseDetailQuery({ view: ['other', 'external'] }).view).toBe('other')
    expect(parseDetailQuery({ q: 'x'.repeat(500) }).search).toHaveLength(200)
  })
})

describe('detailHref', () => {
  it('leaves defaults out', () => {
    expect(detailHref('acme.com', base)).toBe('/domains/acme.com/pages/details')
  })

  it('writes what differs from the defaults', () => {
    expect(
      detailHref('acme.com', {
        ...base,
        search: 'a b',
        issue: 'client-error',
        sort: 'title',
        direction: 'desc',
        page: 2,
      }),
    ).toBe('/domains/acme.com/pages/details?q=a+b&issue=client-error&sort=title&dir=desc&page=2')
  })

  it('applies changes without touching the query', () => {
    const query = { ...base, search: 'blog', page: 4 }
    expect(detailHref('acme.com', query, { page: 1, issue: 'title-missing' })).toBe(
      '/domains/acme.com/pages/details?q=blog&issue=title-missing',
    )
    expect(query.page).toBe(4)
  })

  it('does not carry an issue to views that have none', () => {
    expect(detailHref('acme.com', { ...base, issue: 'client-error' }, { view: 'other' })).toBe(
      '/domains/acme.com/pages/details?view=other',
    )
  })

  it('keeps the crawl being browsed in every address, and leaves the latest out', () => {
    const crawl = '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f12'
    expect(detailHref('acme.com', { ...base, crawl })).toBe(
      `/domains/acme.com/pages/details?crawl=${crawl}`,
    )
    expect(detailHref('acme.com', { ...base, crawl }, { view: 'other', page: 1 })).toBe(
      `/domains/acme.com/pages/details?crawl=${crawl}&view=other`,
    )
    expect(detailHref('acme.com', { ...base, crawl }, { crawl: null })).toBe(
      '/domains/acme.com/pages/details',
    )
  })

  it('round-trips through parseDetailQuery', () => {
    const query: DetailQuery = {
      crawl: '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f12',
      view: 'pages',
      page: 5,
      sort: 'bytes',
      direction: 'desc',
      search: '50% off & more',
      issue: 'description-missing',
      participation: 'audited',
      intent: 'indexable',
      rule: null,
      url: 'b'.repeat(32),
    }
    const href = detailHref('acme.com', query)
    const params = Object.fromEntries(new URL(href, 'https://x').searchParams)
    expect(parseDetailQuery(params)).toEqual(query)
  })
})

describe('nextSort', () => {
  it('goes ascending, descending, then back to the default', () => {
    const first = nextSort(base, 'title')
    expect(first).toEqual({ sort: 'title', direction: 'asc' })
    const second = nextSort(first, 'title')
    expect(second).toEqual({ sort: 'title', direction: 'desc' })
    expect(nextSort(second, 'title')).toEqual({ sort: null, direction: 'asc' })
  })

  it('starts ascending on another column', () => {
    expect(nextSort({ sort: 'title', direction: 'desc' }, 'url')).toEqual({
      sort: 'url',
      direction: 'asc',
    })
  })
})

describe('the filters on the audit', () => {
  it('are kept in the address, and left out when they are not set', () => {
    const query = { ...base, participation: 'excluded', intent: 'indexable' } as DetailQuery
    const href = detailHref('acme.com', query)
    expect(href).toBe('/domains/acme.com/pages/details?audit=excluded&intent=indexable')
    expect(parseDetailQuery(Object.fromEntries(new URL(href, 'http://x').searchParams))).toEqual(
      query,
    )
    expect(detailHref('acme.com', query, { participation: null, intent: null })).toBe(
      '/domains/acme.com/pages/details',
    )
  })

  it('go with the other filters, and the rule of a link from the settings', () => {
    const rule = '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f11'
    const href = detailHref('acme.com', { ...base, rule, search: 'cart', page: 2 })
    expect(
      parseDetailQuery(Object.fromEntries(new URL(href, 'http://x').searchParams)),
    ).toMatchObject({
      rule,
      search: 'cart',
      page: 2,
    })
  })
})
