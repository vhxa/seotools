import { describe, expect, it } from 'vitest'
import { PAGE_ISSUE_IDS } from './issues'
import {
  SITE_SCOPED_ISSUES,
  URL_SCOPED_ISSUES,
  compareWithCrawl,
  isSiteScopedIssue,
  isUrlScopedIssue,
  verificationIsCurrent,
  verificationScopeOf,
} from './verification'

describe('what a recheck can settle', () => {
  it('classifies every issue of the catalog exactly once', () => {
    expect(URL_SCOPED_ISSUES.length + SITE_SCOPED_ISSUES.length).toBe(PAGE_ISSUE_IDS.length)
    expect(new Set([...URL_SCOPED_ISSUES, ...SITE_SCOPED_ISSUES]).size).toBe(PAGE_ISSUE_IDS.length)
  })

  it.each([
    'title-duplicate',
    'description-duplicate',
    'h1-duplicate',
    'content-duplicate',
    'content-near-duplicate',
    'only-nofollow-inlinks',
    'only-noindex-inlinks',
    'orphan-in-sitemap',
    'deep-page',
    'indexable-not-in-sitemap',
    'sitemap-not-indexable',
    'redirect-chain',
    'redirect-loop',
    'canonical-not-indexable',
    'hreflang-no-return',
    'hreflang-no-self',
    'broken-external-link',
  ] as const)('leaves %s to a full crawl', (issue) => {
    expect(verificationScopeOf(issue)).toBe('site')
    expect(isSiteScopedIssue(issue)).toBe(true)
    expect(isUrlScopedIssue(issue)).toBe(false)
  })

  it.each(['title-missing', 'noindex', 'client-error', 'http-url', 'robots-blocked'] as const)(
    'settles %s from the URL itself',
    (issue) => {
      expect(verificationScopeOf(issue)).toBe('url')
      expect(isUrlScopedIssue(issue)).toBe(true)
    },
  )

  it('does not settle an id the code no longer defines', () => {
    expect(isUrlScopedIssue('made-up')).toBe(false)
    expect(isSiteScopedIssue('made-up')).toBe(false)
  })
})

describe('compareWithCrawl', () => {
  it('tells what was fixed, what remains and what appeared, over the issues a recheck settles', () => {
    expect(
      compareWithCrawl({
        crawl: ['title-missing', 'h1-missing', 'noindex'],
        recheck: ['h1-missing', 'description-missing'],
      }),
    ).toEqual({
      // In the order of the catalog.
      fixed: ['noindex', 'title-missing'],
      remaining: ['h1-missing'],
      appeared: ['description-missing'],
      nowAccepted: [],
      pendingFullCrawl: [],
    })
  })

  it('puts what a rule now accepts apart from fixed', () => {
    const result = compareWithCrawl({
      crawl: ['noindex', 'title-missing'],
      recheck: [],
      accepted: ['noindex'],
    })
    expect(result.fixed).toEqual(['title-missing'])
    expect(result.nowAccepted).toEqual(['noindex'])
  })

  it('never calls a site-wide finding fixed or new: it waits for a full crawl', () => {
    const result = compareWithCrawl({
      crawl: ['title-duplicate', 'orphan-in-sitemap', 'title-missing'],
      // A recheck cannot see duplicates, so it can never contain one.
      recheck: [],
    })
    expect(result.fixed).toEqual(['title-missing'])
    expect(result.pendingFullCrawl).toEqual(['title-duplicate', 'orphan-in-sitemap'])
    expect(result.appeared).toEqual([])
  })

  it('does not report as new a site-wide issue a recheck happens to carry', () => {
    const result = compareWithCrawl({ crawl: [], recheck: ['content-duplicate', 'noindex'] })
    expect(result.appeared).toEqual(['noindex'])
  })

  it('treats what a recheck could not check as pending, never as fixed', () => {
    const result = compareWithCrawl({
      crawl: ['title-missing', 'noindex'],
      recheck: [],
      unchecked: ['title-missing'],
    })
    expect(result.fixed).toEqual(['noindex'])
    expect(result.pendingFullCrawl).toEqual(['title-missing'])
  })

  it('ignores ids the code no longer defines', () => {
    expect(compareWithCrawl({ crawl: ['gone'], recheck: ['gone'] })).toEqual({
      fixed: [],
      remaining: [],
      appeared: [],
      nowAccepted: [],
      pendingFullCrawl: [],
    })
  })
})

describe('verificationIsCurrent', () => {
  it('holds only for the configuration in force', () => {
    expect(verificationIsCurrent({ auditVersion: 3 }, 3)).toBe(true)
    expect(verificationIsCurrent({ auditVersion: 2 }, 3)).toBe(false)
    expect(verificationIsCurrent({ auditVersion: null }, 0)).toBe(false)
  })
})
