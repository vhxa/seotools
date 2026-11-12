import type { IssueEvidence } from '@seotools/core'
import { describe, expect, it } from 'vitest'
import {
  crawlIssueRows,
  crawlHistoryRow,
  historyTrace,
  groupAcceptedIssues,
  foldIssueCounts,
  foldViewCounts,
  parseIssueDetails,
  serializeIssueDetails,
  toCrawlUrlIssue,
} from './mapping'

const evidence: IssueEvidence = {
  kind: 'images',
  total: 2,
  items: [{ src: '/a.png', url: 'https://example.com/a.png' }],
}

describe('what an issue row keeps in its details column', () => {
  it('keeps what rows have always kept, in the way they always did', () => {
    expect(serializeIssueDetails({ urlHash: 'a', issue: 'x' })).toBeNull()
    expect(serializeIssueDetails({ urlHash: 'a', issue: 'x', details: [] })).toBeNull()
    expect(serializeIssueDetails({ urlHash: 'a', issue: 'x', details: ['html', 'sitemap'] })).toBe(
      '["html","sitemap"]',
    )
  })

  it('reads a row written before there was evidence', () => {
    expect(parseIssueDetails('["html","sitemap"]')).toEqual({ details: ['html', 'sitemap'] })
    expect(parseIssueDetails(null)).toEqual({})
    expect(toCrawlUrlIssue({ urlHash: 'a', issue: 'x', details: '["noindex"]' })).toEqual({
      urlHash: 'a',
      issue: 'x',
      details: ['noindex'],
    })
  })

  it('stores evidence, with the details when there are any', () => {
    const only = serializeIssueDetails({ urlHash: 'a', issue: 'x', evidence })
    expect(parseIssueDetails(only)).toEqual({ evidence })
    const both = serializeIssueDetails({ urlHash: 'a', issue: 'x', details: ['d'], evidence })
    expect(parseIssueDetails(both)).toEqual({ details: ['d'], evidence })
  })

  it('drops evidence that does not check out, and keeps the rest of the finding', () => {
    expect(
      parseIssueDetails('{"details":["d"],"evidence":{"kind":"from-the-future","total":1}}'),
    ).toEqual({
      details: ['d'],
    })
    expect(parseIssueDetails('{"evidence":{"kind":"images","total":-5,"items":[]}}')).toEqual({})
  })

  it('does not take what is not JSON, or not an object, for anything', () => {
    expect(parseIssueDetails('not json')).toEqual({})
    expect(parseIssueDetails('42')).toEqual({})
    expect(parseIssueDetails('"text"')).toEqual({})
  })

  it('writes one row per URL and issue, with the evidence of the last one given', () => {
    const rows = crawlIssueRows('c1', [
      { urlHash: 'a', issue: 'x' },
      { urlHash: 'a', issue: 'x', evidence },
    ])
    expect(rows).toHaveLength(1)
    expect(parseIssueDetails(rows[0]!.details)).toEqual({ evidence })
  })
})

describe('how many URLs each view starts from', () => {
  it('splits the URLs of the site by what they turned out to be, and keeps external ones apart', () => {
    expect(
      foldViewCounts([
        { scope: 'internal', kind: 'page', state: 'done', statusCode: 200, count: 5 },
        { scope: 'internal', kind: 'page', state: 'done', statusCode: 404, count: 2 },
        { scope: 'internal', kind: 'resource', state: 'done', statusCode: 200, count: '3' },
        { scope: 'internal', kind: 'resource', state: 'done', statusCode: 404, count: 1 },
        { scope: 'internal', kind: 'redirect', state: 'done', statusCode: 301, count: 2 },
        { scope: 'internal', kind: 'unknown', state: 'done', statusCode: null, count: 1 },
        { scope: 'internal', kind: 'unknown', state: 'queued', statusCode: null, count: 1 },
        { scope: 'external', kind: 'unknown', state: 'done', statusCode: 404, count: 4 },
      ]),
    ).toEqual({
      pages: 5,
      resources: 3,
      redirects: 2,
      // A page, an image and a URL that never answered: whatever they were meant to be.
      errors: 4,
      other: 10,
      external: 4,
      all: 19,
    })
  })

  it('is zero for a crawl with no URLs', () => {
    expect(foldViewCounts([])).toEqual({
      pages: 0,
      resources: 0,
      redirects: 0,
      errors: 0,
      other: 0,
      external: 0,
      all: 0,
    })
  })
})

describe('issue counts', () => {
  it('counts search-result findings on a URL that cannot be indexed apart, as secondary', () => {
    expect(
      foldIssueCounts([
        { issue: 'title-too-long', indexability: 'indexable', pages: 3 },
        { issue: 'title-too-long', indexability: 'not-indexable', pages: '2' },
        { issue: 'img-no-alt', indexability: 'not-indexable', pages: 4 },
        { issue: 'title-too-long', indexability: null, pages: 1 },
      ]),
    ).toEqual([
      { issue: 'title-too-long', pages: 4, secondary: 2 },
      // Accessibility counts wherever it is.
      { issue: 'img-no-alt', pages: 4, secondary: 0 },
    ])
  })
})

it('keeps human dismissal kinds in compact history without confusing rule acceptances', () => {
  const rows = groupAcceptedIssues([
    {
      urlHash: 'h',
      issue: 'title-missing',
      details: JSON.stringify({
        acceptance: { kind: 'dismissal', state: 'dismissed', scope: 'url', id: 'd' },
      }),
    },
    {
      urlHash: 'h',
      issue: 'noindex',
      details: JSON.stringify({ acceptance: { kind: 'expectation', rule: null } }),
    },
  ])
  const row = crawlHistoryRow(
    'c',
    {
      urlHash: 'h',
      url: 'https://example.com/',
      state: 'done',
      kind: 'page',
      statusCode: 200,
      redirectTo: null,
      title: null,
      canonical: null,
      metaRobots: null,
      xRobotsTag: null,
      error: null,
      depth: 0,
    },
    [],
    rows.get('h')!,
    null,
  )
  expect(historyTrace(row)).toMatchObject({
    accepted: ['title-missing', 'noindex'],
    dismissed: ['title-missing'],
  })
  expect(historyTrace({ ...row, accepted: '["noindex"]' })).toMatchObject({
    accepted: ['noindex'],
    dismissed: [],
  })
})
