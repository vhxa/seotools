import { describe, expect, it } from 'vitest'
import {
  activeFilters,
  detailHref,
  filterAvailability,
  listingOf,
  nextSort,
  parseDetailQuery,
  unappliedFilters,
  withoutFilter,
  type DetailQuery,
} from './pages-query'

const base: DetailQuery = {
  crawl: null,
  view: 'pages',
  page: 1,
  sort: null,
  direction: 'asc',
  search: '',
  issue: null,
  accepted: null,
  status: null,
  type: null,
  indexability: null,
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
        view: 'resources',
        page: '3',
        sort: 'responseTime',
        dir: 'desc',
        q: '  blog ',
        issue: 'title-missing',
        status: '4xx',
        type: 'redirect',
        indexability: 'unknown',
        audit: 'excluded',
        intent: 'not-indexable',
        rule: '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f11',
        url: hash,
      }),
    ).toEqual({
      crawl: '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f12',
      view: 'all',
      page: 3,
      sort: 'responseTime',
      direction: 'desc',
      search: 'blog',
      issue: 'title-missing',
      accepted: null,
      status: '4xx',
      type: 'redirect',
      indexability: 'unknown',
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
        status: '404',
        type: 'image',
        indexability: 'maybe',
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

  it('shows an issue wherever its URLs are: that is every view, whatever the address says', () => {
    expect(parseDetailQuery({ view: 'other', issue: 'client-error' })).toMatchObject({
      view: 'all',
      issue: 'client-error',
    })
    expect(parseDetailQuery({ issue: 'client-error' }).view).toBe('all')
    expect(parseDetailQuery({ view: 'other', issue: 'nope' }).view).toBe('other')
  })

  it('knows every view, and the old one that links may still have', () => {
    for (const view of ['pages', 'resources', 'redirects', 'external', 'all', 'other']) {
      expect(parseDetailQuery({ view }).view).toBe(view)
    }
    expect(parseDetailQuery({ view: 'unknown' }).view).toBe('pages')
  })

  it('takes the first value of a repeated parameter and caps the search', () => {
    expect(parseDetailQuery({ view: ['other', 'external'] }).view).toBe('other')
    expect(parseDetailQuery({ status: ['5xx', '2xx'] }).status).toBe('5xx')
    expect(parseDetailQuery({ q: 'x'.repeat(500) }).search).toHaveLength(200)
  })
})

describe('detailHref', () => {
  it('leaves defaults out', () => {
    expect(detailHref('acme.com', base)).toBe('/domains/acme.com/urls')
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
    ).toBe('/domains/acme.com/urls?q=a+b&issue=client-error&sort=title&dir=desc&page=2')
  })

  it('applies changes without touching the query', () => {
    const query = { ...base, search: 'blog', page: 4 }
    expect(detailHref('acme.com', query, { page: 1, issue: 'title-missing' })).toBe(
      '/domains/acme.com/urls?q=blog&issue=title-missing',
    )
    expect(query.page).toBe(4)
  })

  it('leaves the issue when a view is chosen', () => {
    expect(
      detailHref('acme.com', { ...base, view: 'all', issue: 'client-error' }, { view: 'other' }),
    ).toBe('/domains/acme.com/urls?view=other')
    expect(
      detailHref('acme.com', { ...base, view: 'all', issue: 'client-error' }, { view: 'pages' }),
    ).toBe('/domains/acme.com/urls')
  })

  it('writes an issue without a view, since it always means every one', () => {
    expect(detailHref('acme.com', base, { view: 'all', issue: 'client-error', page: 1 })).toBe(
      '/domains/acme.com/urls?issue=client-error',
    )
    expect(detailHref('acme.com', base, { issue: 'client-error' })).toBe(
      '/domains/acme.com/urls?issue=client-error',
    )
  })

  it('keeps the view when an issue is removed, so that only that filter goes', () => {
    const query = parseDetailQuery({ issue: 'client-error', q: 'blog' })
    expect(detailHref('acme.com', query, withoutFilter('issue'))).toBe(
      '/domains/acme.com/urls?view=all&q=blog',
    )
  })

  it('keeps the crawl being browsed in every address, and leaves the latest out', () => {
    const crawl = '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f12'
    expect(detailHref('acme.com', { ...base, crawl })).toBe(`/domains/acme.com/urls?crawl=${crawl}`)
    expect(detailHref('acme.com', { ...base, crawl }, { view: 'other', page: 1 })).toBe(
      `/domains/acme.com/urls?crawl=${crawl}&view=other`,
    )
    expect(detailHref('acme.com', { ...base, crawl }, { crawl: null })).toBe(
      '/domains/acme.com/urls',
    )
  })

  it('round-trips through parseDetailQuery', () => {
    const query: DetailQuery = {
      crawl: '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f12',
      view: 'all',
      page: 5,
      sort: 'bytes',
      direction: 'desc',
      search: '50% off & more',
      issue: 'description-missing',
      accepted: null,
      status: '5xx',
      type: 'unknown',
      indexability: 'not-indexable',
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
    expect(href).toBe('/domains/acme.com/urls?audit=excluded&intent=indexable')
    expect(parseDetailQuery(Object.fromEntries(new URL(href, 'http://x').searchParams))).toEqual(
      query,
    )
    expect(detailHref('acme.com', query, { participation: null, intent: null })).toBe(
      '/domains/acme.com/urls',
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

describe('what a view carries when it is chosen', () => {
  const everything: DetailQuery = {
    ...base,
    search: 'blog',
    status: '4xx',
    type: 'resource',
    indexability: 'unknown',
    participation: 'excluded',
    intent: 'indexable',
    rule: '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f11',
    sort: 'status',
    direction: 'desc',
    view: 'all',
  }
  const go = (view: DetailQuery['view']) =>
    Object.fromEntries(
      new URL(detailHref('acme.com', everything, { view, page: 1, url: null }), 'http://x')
        .searchParams,
    )

  it('keeps the search, the status, the audit filters and the order', () => {
    expect(go('all')).toMatchObject({
      view: 'all',
      q: 'blog',
      status: '4xx',
      type: 'resource',
      indexability: 'unknown',
      audit: 'excluded',
      intent: 'indexable',
      sort: 'status',
      dir: 'desc',
    })
  })

  it('leaves out the type where a view has one only', () => {
    for (const view of ['pages', 'resources', 'redirects'] as const) {
      expect(go(view)).not.toHaveProperty('type')
      expect(go(view)).toMatchObject({
        q: 'blog',
        status: '4xx',
        audit: 'excluded',
        sort: 'status',
      })
    }
    expect(go('other')).toHaveProperty('type', 'resource')
  })

  it('leaves out what external URLs cannot have, because it would only list nothing', () => {
    const external = go('external')
    expect(external).toEqual({
      view: 'external',
      q: 'blog',
      status: '4xx',
      sort: 'status',
      dir: 'desc',
    })
  })

  it('does not forget the order when the view changes', () => {
    const query = parseDetailQuery({ sort: 'bytes', dir: 'desc' })
    expect(detailHref('acme.com', query, { view: 'resources', page: 1 })).toBe(
      '/domains/acme.com/urls?view=resources&sort=bytes&dir=desc',
    )
  })
})

describe('the filters that cannot apply', () => {
  const withFilters = {
    ...base,
    type: 'page',
    indexability: 'unknown',
    participation: 'audited',
    intent: 'indexable',
    rule: '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f11',
    status: '4xx',
    search: 'x',
  } as DetailQuery

  it('are none for URLs of the site with an audit, in a view with several types', () => {
    expect(unappliedFilters({ ...withFilters, view: 'all' }, { auditData: true })).toEqual({})
    expect(filterAvailability('all', { auditData: true })).toEqual({ audit: null, type: null })
  })

  it('include the audit ones on external URLs, which are not audited, and the type', () => {
    expect(unappliedFilters({ ...withFilters, view: 'external' }, { auditData: true })).toEqual({
      type: 'external',
      indexability: 'external',
      participation: 'external',
      intent: 'external',
      rule: 'external',
    })
    expect(filterAvailability('external', { auditData: true })).toEqual({
      audit: 'external',
      type: 'external',
    })
  })

  it('include the type where the view has one only', () => {
    expect(unappliedFilters({ ...withFilters, view: 'pages' }, { auditData: true })).toEqual({
      type: 'view',
    })
    expect(filterAvailability('redirects', { auditData: true }).type).toBe('view')
  })

  it('include the audit ones in a crawl with no audit data, never reading its silence as a no', () => {
    expect(unappliedFilters({ ...withFilters, view: 'all' }, { auditData: false })).toEqual({
      indexability: 'no-audit-data',
      participation: 'no-audit-data',
      intent: 'no-audit-data',
      rule: 'no-audit-data',
    })
    expect(filterAvailability('pages', { auditData: false }).audit).toBe('no-audit-data')
    // External wins as the reason: the crawl is not what keeps them from applying.
    expect(filterAvailability('external', { auditData: false }).audit).toBe('external')
  })

  it('say nothing about a filter that is not set', () => {
    expect(unappliedFilters({ ...base, view: 'external' }, { auditData: false })).toEqual({})
  })

  it('are not asked of the database, and the rest are', () => {
    const unapplied = unappliedFilters({ ...withFilters, view: 'external' }, { auditData: true })
    expect(listingOf({ ...withFilters, view: 'external' }, unapplied)).toEqual({
      view: 'external',
      search: 'x',
      status: '4xx',
    })
    expect(listingOf({ ...withFilters, view: 'all' }, {})).toEqual({
      view: 'all',
      search: 'x',
      status: '4xx',
      type: 'page',
      indexability: 'unknown',
      participation: 'audited',
      intent: 'indexable',
      rule: '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f11',
    })
  })

  it('send the issue on its own, whatever the view it is in', () => {
    const issue = parseDetailQuery({ issue: 'client-error', status: 'none' })
    expect(listingOf(issue, unappliedFilters(issue, { auditData: true }))).toEqual({
      view: 'all',
      issue: 'client-error',
      status: 'none',
    })
  })

  it('send what rules accept on its own too, and never next to an issue', () => {
    const accepted = parseDetailQuery({ accepted: 'noindex', view: 'resources' })
    expect(accepted.view).toBe('all')
    expect(listingOf(accepted, unappliedFilters(accepted, { auditData: true }))).toEqual({
      view: 'all',
      accepted: 'noindex',
    })
    expect(parseDetailQuery({ accepted: 'all' }).accepted).toBe('all')
    expect(parseDetailQuery({ accepted: 'retired' }).accepted).toBeNull()
    expect(parseDetailQuery({ accepted: 'noindex', issue: 'noindex' })).toMatchObject({
      issue: 'noindex',
      accepted: null,
    })
  })
})

describe('the link to what rules accept', () => {
  it('leaves the issue, and is left by choosing an issue or a view', () => {
    const issue = parseDetailQuery({ issue: 'noindex' })
    expect(detailHref('acme.com', issue, { accepted: 'all' })).toBe(
      '/domains/acme.com/urls?accepted=all',
    )
    const accepted = parseDetailQuery({ accepted: 'all' })
    expect(detailHref('acme.com', accepted, { issue: 'noindex' })).toBe(
      '/domains/acme.com/urls?issue=noindex',
    )
    expect(detailHref('acme.com', accepted, { view: 'pages' })).toBe('/domains/acme.com/urls')
  })
})

describe('the filters that are set', () => {
  it('are listed in order, and removed one at a time or all at once, keeping the view and the order', () => {
    const query = parseDetailQuery({
      view: 'resources',
      q: 'logo',
      status: '2xx',
      audit: 'audited',
      sort: 'bytes',
      dir: 'desc',
      page: '4',
    })
    expect(activeFilters(query)).toEqual(['search', 'status', 'participation'])
    expect(detailHref('acme.com', query, withoutFilter('status'))).toBe(
      '/domains/acme.com/urls?view=resources&q=logo&audit=audited&sort=bytes&dir=desc',
    )
    expect(detailHref('acme.com', query, withoutFilter('all'))).toBe(
      '/domains/acme.com/urls?view=resources&sort=bytes&dir=desc',
    )
    expect(activeFilters(base)).toEqual([])
  })
})
