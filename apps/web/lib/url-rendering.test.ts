import type { CrawlUrl, CrawlUrlRender } from '@seotools/db'
import type { CrawlPageFacts } from '@seotools/core'
import { describe, expect, it } from 'vitest'
import { comparisonRows, renderViewOf, requestsOf } from './url-rendering'

/** Only the fields the detail reads: the rest of a page's facts are not what this tests. */
const facts = (words: number, extra: Partial<CrawlPageFacts> = {}) =>
  ({ canonicals: [], structuredData: 0, words, ...extra }) as CrawlPageFacts
const served = (extra: Partial<CrawlUrl> = {}): CrawlUrl =>
  ({
    url: 'https://example.com/',
    urlHash: 'h',
    scope: 'internal',
    kind: 'page',
    statusCode: 200,
    title: 'Served title',
    metaRobots: 'index, follow',
    data: { description: 'Served description', h1: ['Served'], hreflang: [], facts: facts(40) },
    ...extra,
  }) as CrawlUrl
const render = (extra: Partial<CrawlUrlRender> = {}): CrawlUrlRender => ({
  urlHash: 'h',
  status: 'rendered',
  settled: true,
  truncated: false,
  finalUrl: 'https://example.com/',
  durationMs: 1200,
  failure: null,
  data: {
    facts: facts(400),
    requests: {},
    scriptErrors: { count: 0, first: [] },
    page: {
      title: 'Rendered title',
      description: 'Served description',
      h1: null,
      metaRobots: 'noindex',
      botRobots: {},
      hreflang: [{ lang: 'es', url: 'https://example.com/es', source: 'html' }],
    },
  },
  ...extra,
})
const rendered = { rendering: { mode: 'rendered' as const, waitMs: 5000, omittedHosts: [] } }

describe('comparisonRows', () => {
  it('marks what differs and what is the same, from two observed values', () => {
    const rows = Object.fromEntries(
      comparisonRows(served(), render()).map((row) => [row.field, row.outcome]),
    )
    expect(rows).toMatchObject({
      title: 'differs',
      description: 'same',
      h1: 'differs',
      robots: 'differs',
      words: 'differs',
      hreflang: 'differs',
      canonical: 'same',
    })
  })

  it('never claims a difference from a value the crawl did not record', () => {
    const rows = comparisonRows(
      served({ data: { facts: undefined } as CrawlUrl['data'] }),
      render({ data: { ...render().data, page: undefined, facts: null } }),
    )
    expect(rows.find((row) => row.field === 'words')?.outcome).toBe('unknown')
    expect(rows.find((row) => row.field === 'title')?.outcome).toBe('unknown')
    expect(rows.find((row) => row.field === 'title')?.rendered).toEqual({ kind: 'unknown' })
  })

  it('compares robots directives as sets, and reads only HTML canonicals', () => {
    const rows = comparisonRows(
      served({ metaRobots: 'nofollow,  NOINDEX' }),
      render({
        data: {
          ...render().data,
          facts: facts(40, {
            canonicals: [
              { url: 'https://example.com/x', raw: '/x', inHead: true, source: 'header' },
            ],
          }),
          page: { ...render().data.page!, metaRobots: 'noindex, nofollow' },
        },
      }),
    )
    expect(rows.find((row) => row.field === 'robots')?.outcome).toBe('same')
    expect(rows.find((row) => row.field === 'canonical')?.rendered).toEqual({ kind: 'none' })
  })
})

describe('renderViewOf', () => {
  it('says an HTML crawl did not render, never an empty comparison', () => {
    expect(renderViewOf({ crawl: { rendering: null }, url: served(), render: null })).toMatchObject(
      {
        kind: 'not-rendered',
        reason: 'html-crawl',
      },
    )
    expect(
      renderViewOf({
        crawl: { rendering: { mode: 'html', waitMs: 5000, omittedHosts: [] } },
        url: served(),
        render: render(),
      }).kind,
    ).toBe('not-rendered')
  })

  it('explains a page without a render in a rendered crawl', () => {
    const reason = (url: CrawlUrl) =>
      renderViewOf({ crawl: rendered, url, render: null }) as { reason: string }
    expect(reason(served({ statusCode: 204 })).reason).toBe('status')
    expect(reason(served({ kind: 'resource' })).reason).toBe('not-page')
    expect(reason(served({ scope: 'external' })).reason).toBe('external')
    expect(reason(served()).reason).toBe('missing')
  })

  it('says which part of an incomplete render is missing', () => {
    const view = (override: Partial<CrawlUrlRender>, url = served()) =>
      renderViewOf({ crawl: rendered, url, render: render(override) })
    expect(view({ status: 'failed', settled: false, failure: 'navigation' })).toMatchObject({
      kind: 'incomplete',
      state: 'failed',
      failure: 'navigation',
    })
    expect(view({ truncated: true })).toMatchObject({
      state: 'truncated',
      cut: { rendered: true, served: false },
    })
    expect(view({}, served({ data: { truncated: true } as CrawlUrl['data'] }))).toMatchObject({
      state: 'truncated',
      cut: { rendered: false, served: true },
    })
    expect(view({ settled: false })).toMatchObject({ state: 'unsettled', waitMs: 5000 })
    expect(view({ truncated: null })).toMatchObject({ state: 'unknown' })
  })

  it('compares nothing for a redirect by JavaScript', () => {
    expect(
      renderViewOf({
        crawl: rendered,
        url: served(),
        render: render({
          settled: false,
          finalUrl: 'https://example.com/new',
          data: { ...render().data, redirected: true },
        }),
      }),
    ).toEqual({ kind: 'redirect', target: 'https://example.com/new', durationMs: 1200 })
  })

  it('shows a complete observation with its rows', () => {
    const view = renderViewOf({ crawl: rendered, url: served(), render: render() })
    expect(view.kind).toBe('complete')
  })
})

describe('requestsOf', () => {
  it('reads bounded samples and keeps the true counts', () => {
    expect(
      requestsOf({
        failedCount: 30,
        failed: [{ url: 'https://cdn.test/a.js', code: 'HTTP_404' }, { nope: 1 }],
        blockedByRobotsCount: 2,
        blockedByRobots: ['https://x.test/', 4],
        omittedCount: 1,
        omitted: [{ url: 'https://a.test/', reason: 'analytics' }],
      }),
    ).toEqual({
      failed: { count: 30, items: [{ url: 'https://cdn.test/a.js', code: 'HTTP_404' }] },
      blockedByRobots: { count: 2, items: ['https://x.test/'] },
      omitted: { count: 1, items: [{ url: 'https://a.test/', reason: 'analytics' }] },
      refused: { count: 0, items: [] },
    })
    expect(requestsOf(1)).toBeNull()
    expect(requestsOf({})?.failed.count).toBe(0)
  })
})
