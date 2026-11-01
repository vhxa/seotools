import { describe, expect, it } from 'vitest'
import { detailHref, nextSort, parseDetailQuery, type DetailQuery } from './pages-query'

const base: DetailQuery = {
  view: 'pages',
  page: 1,
  sort: null,
  direction: 'asc',
  search: '',
  issue: null,
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
        view: 'pages',
        page: '3',
        sort: 'responseTime',
        dir: 'desc',
        q: '  blog ',
        issue: 'missing-title',
        url: hash,
      }),
    ).toEqual({
      view: 'pages',
      page: 3,
      sort: 'responseTime',
      direction: 'desc',
      search: 'blog',
      issue: 'missing-title',
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
        url: 'not-a-hash',
      }),
    ).toEqual(base)
    expect(parseDetailQuery({ page: 'abc' }).page).toBe(1)
    expect(parseDetailQuery({ page: '2.9' }).page).toBe(2)
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
        issue: 'http-error',
        sort: 'title',
        direction: 'desc',
        page: 2,
      }),
    ).toBe('/domains/acme.com/pages/details?q=a+b&issue=http-error&sort=title&dir=desc&page=2')
  })

  it('applies changes without touching the query', () => {
    const query = { ...base, search: 'blog', page: 4 }
    expect(detailHref('acme.com', query, { page: 1, issue: 'missing-title' })).toBe(
      '/domains/acme.com/pages/details?q=blog&issue=missing-title',
    )
    expect(query.page).toBe(4)
  })

  it('does not carry an issue to views that have none', () => {
    expect(detailHref('acme.com', { ...base, issue: 'http-error' }, { view: 'other' })).toBe(
      '/domains/acme.com/pages/details?view=other',
    )
  })

  it('round-trips through parseDetailQuery', () => {
    const query: DetailQuery = {
      view: 'pages',
      page: 5,
      sort: 'bytes',
      direction: 'desc',
      search: '50% off & more',
      issue: 'missing-description',
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
