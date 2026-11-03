import type { IssueEvidence } from '@seotools/core'
import { describe, expect, it } from 'vitest'
import {
  crawlIssueRows,
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
