import { MAX_VERIFICATION_URLS } from '@seotools/core'
import type { Verification, VerifiedUrl } from '@seotools/db'
import { describe, expect, it } from 'vitest'
import { ANNOUNCE_MS, announceRecheck, canRecheck, parseRecheckUrls, viewRecheck } from './recheck'

describe('parseRecheckUrls', () => {
  it('normalizes the URLs of the domain, each once', () => {
    expect(
      parseRecheckUrls(
        [
          'https://example.com/a#top',
          'HTTPS://EXAMPLE.COM/a',
          'http://www.example.com/b',
          ' https://example.com/c ',
        ],
        'example.com',
      ),
    ).toEqual({
      ok: true,
      urls: ['https://example.com/a', 'http://www.example.com/b', 'https://example.com/c'],
    })
  })

  it('leaves out what is not a URL of the domain, and refuses a list with nothing else', () => {
    expect(
      parseRecheckUrls(
        ['https://other.com/a', 'https://example.com:8443/a', 'javascript:alert(1)', 7, null, '/a'],
        'example.com',
      ),
    ).toEqual({ ok: false, error: 'invalid' })
    expect(
      parseRecheckUrls(['https://blog.example.com/a', 'https://example.com/a'], 'example.com'),
    ).toEqual({ ok: true, urls: ['https://example.com/a'] })
  })

  it.each([undefined, null, 'https://example.com/', {}, 3, []])('refuses %j as a list', (input) => {
    expect(parseRecheckUrls(input, 'example.com')).toEqual({ ok: false, error: 'none' })
  })

  it('refuses a list that is too long instead of cutting it', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, i) => `https://example.com/${i}`)
    expect(parseRecheckUrls(many(MAX_VERIFICATION_URLS), 'example.com')).toMatchObject({ ok: true })
    expect(parseRecheckUrls(many(MAX_VERIFICATION_URLS + 1), 'example.com')).toEqual({
      ok: false,
      error: 'tooMany',
    })
    // Not even read: a million entries are not worth normalizing to find out they are too many.
    expect(parseRecheckUrls(many(10_000), 'example.com')).toEqual({ ok: false, error: 'tooMany' })
  })

  it('does not count repeats against the limit', () => {
    const repeated = Array.from({ length: 150 }, () => 'https://example.com/a')
    expect(parseRecheckUrls(repeated, 'example.com')).toEqual({
      ok: true,
      urls: ['https://example.com/a'],
    })
  })
})

describe('canRecheck', () => {
  it('holds for URLs of the site, except the files for crawlers', () => {
    expect(canRecheck({ scope: 'internal', source: 'link' })).toBe(true)
    expect(canRecheck({ scope: 'internal', source: 'seed' })).toBe(true)
    expect(canRecheck({ scope: 'internal', source: 'sitemap' })).toBe(true)
    expect(canRecheck({ scope: 'internal', source: 'robots' })).toBe(false)
    expect(canRecheck({ scope: 'internal', source: 'sitemap-file' })).toBe(false)
    expect(canRecheck({ scope: 'internal', source: 'llms' })).toBe(false)
    expect(canRecheck({ scope: 'external', source: 'link' })).toBe(false)
  })
})

describe('viewRecheck', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 12, minute))
  const verified = (overrides: Partial<VerifiedUrl> = {}): VerifiedUrl =>
    ({
      verificationId: 'v',
      url: 'https://example.com/a',
      urlHash: 'h',
      source: 'link',
      state: 'done',
      auditVersion: 2,
      fetchedAt: at(30),
      outcome: {
        audit: {
          participation: 'audited',
          participationRule: null,
          intent: 'indexable',
          intentRule: null,
          conditions: {},
          indexability: 'indexable',
          blockers: [],
        },
        findings: [{ issue: 'h1-missing' }],
        unchecked: [],
      },
      ...overrides,
    }) as VerifiedUrl
  const crawl = { auditVersion: 2, pagesByWorstIssue: { issue: 0, warning: 1, opportunity: 0 } }
  const input = {
    verified: verified(),
    crawl,
    crawledAt: at(0),
    crawlIssues: ['title-missing', 'h1-missing', 'title-duplicate'],
    configVersion: 2,
  }

  it('compares with what the crawl found, and leaves what only a crawl settles pending', () => {
    const view = viewRecheck(input)
    expect(view?.current).toBe(true)
    expect(view?.verifiedAt).toEqual(at(30))
    expect(view?.comparison).toEqual({
      fixed: ['title-missing'],
      remaining: ['h1-missing'],
      appeared: [],
      pendingFullCrawl: ['title-duplicate'],
    })
    expect(view?.notComparable).toBeNull()
  })

  it('does not show a recheck the crawl has since overtaken', () => {
    expect(viewRecheck({ ...input, crawledAt: at(30) })).toBeNull()
    expect(viewRecheck({ ...input, crawledAt: at(45) })).toBeNull()
    expect(viewRecheck({ ...input, crawledAt: null })).not.toBeNull()
  })

  it('has nothing to show for a URL never rechecked, or a recheck that did not finish', () => {
    expect(viewRecheck({ ...input, verified: null })).toBeNull()
    expect(viewRecheck({ ...input, verified: verified({ outcome: null }) })).toBeNull()
    expect(viewRecheck({ ...input, verified: verified({ fetchedAt: null }) })).toBeNull()
  })

  it('says rules changed since, and does not compare, when the configuration moved', () => {
    const view = viewRecheck({ ...input, configVersion: 3 })
    expect(view?.current).toBe(false)
    // The crawl and the recheck still agree with each other: both used version 2.
    expect(view?.comparison).not.toBeNull()
  })

  it('does not compare a recheck with a crawl analysed under other rules', () => {
    const view = viewRecheck({ ...input, crawl: { ...crawl, auditVersion: 1 } })
    expect(view).toMatchObject({ comparison: null, notComparable: 'rules-changed' })
    // A crawl from before configuration existed is version 0.
    expect(
      viewRecheck({
        ...input,
        crawl: { ...crawl, auditVersion: null },
        verified: verified({ auditVersion: 0 }),
        configVersion: 0,
      })?.comparison,
    ).not.toBeNull()
  })

  it('does not compare with a crawl that was never analysed', () => {
    const view = viewRecheck({ ...input, crawl: { auditVersion: 2, pagesByWorstIssue: null } })
    expect(view).toMatchObject({ comparison: null, notComparable: 'not-analysed' })
  })
})

describe('announceRecheck', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0)
  const recheck = (overrides: Partial<Verification>): Verification =>
    ({
      id: 'v',
      status: 'completed',
      finishedAt: new Date(now - 60_000),
      ...overrides,
    }) as Verification

  it('announces the recheck that is under way, whatever else there is', () => {
    const active = recheck({ status: 'running', finishedAt: null })
    expect(announceRecheck({ active, latest: recheck({ status: 'failed' }), now })).toEqual({
      kind: 'active',
      verification: active,
    })
  })

  it('announces one that finished or failed a moment ago', () => {
    expect(announceRecheck({ active: null, latest: recheck({}), now })?.kind).toBe('done')
    expect(
      announceRecheck({ active: null, latest: recheck({ status: 'failed' }), now })?.kind,
    ).toBe('failed')
  })

  it('says nothing of an old one, a cancelled one, or none', () => {
    const old = recheck({ finishedAt: new Date(now - ANNOUNCE_MS) })
    expect(announceRecheck({ active: null, latest: old, now })).toBeNull()
    expect(
      announceRecheck({ active: null, latest: recheck({ status: 'cancelled' }), now }),
    ).toBeNull()
    expect(announceRecheck({ active: null, latest: null, now })).toBeNull()
  })
})
