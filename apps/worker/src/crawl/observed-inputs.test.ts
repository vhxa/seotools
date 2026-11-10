import type { CrawlPageFacts } from '@seotools/core'
import { describe, expect, it } from 'vitest'
import { extractHtml } from './extract'
import { CHECKS } from './issue-checks'
import { INPUT_RECORDED, OPTIONAL_FACT_ISSUES, unobservedIssues } from './observed-inputs'
import { emptyPageFacts } from './page-facts'
import type { AuditedUrl, Site } from './site-audit'

const collected = () =>
  extractHtml('<html lang="en"><head></head></html>', 'https://example.com/').facts
const older = (...without: (keyof CrawlPageFacts)[]): CrawlPageFacts => {
  const facts = { ...collected() }
  for (const key of without) delete facts[key]
  return facts
}

describe('the issues whose input an older crawl did not record', () => {
  it('lists, for each optional fact, the issues that read it, and only those are silent without it', () => {
    // A page parsed by the crawler today has every optional fact that issues depend on...
    const facts = collected()
    for (const [fact, issues] of Object.entries(OPTIONAL_FACT_ISSUES)) {
      if (issues.length > 0) expect(facts[fact as keyof CrawlPageFacts]).toBeDefined()
    }
    // ...an older one has none of them, and none of those checks says anything about it.
    const bare = emptyPageFacts()
    for (const fact of Object.keys(OPTIONAL_FACT_ISSUES)) {
      expect(bare[fact as keyof CrawlPageFacts]).toBeUndefined()
    }
    const url = { internal: true, contentPage: true, facts: bare } as unknown as AuditedUrl
    for (const issue of Object.keys(INPUT_RECORDED) as (keyof typeof CHECKS)[]) {
      const verdict = CHECKS[issue](url, {} as Site)
      // A list is a finding unless it is empty.
      expect(Array.isArray(verdict) ? verdict.length > 0 : verdict !== false).toBe(false)
    }
  })

  it('covers the social, document and structured data issues', () => {
    expect(Object.keys(INPUT_RECORDED).sort()).toEqual([
      'charset-missing',
      'html-lang-invalid',
      'html-lang-missing',
      'og-image-broken',
      'og-incomplete',
      'og-missing',
      'og-url-mismatch',
      'structured-data-recommended-missing',
      'structured-data-required-missing',
      'twitter-card-missing',
      'viewport-missing',
    ])
  })

  it('says nothing is unobserved when every page recorded its input', () => {
    expect(unobservedIssues([collected(), collected()])).toEqual([])
    expect(unobservedIssues([])).toEqual([])
  })

  it('names the issues of what a single page did not record, sorted', () => {
    expect(unobservedIssues([collected(), older('social')])).toEqual([
      'og-image-broken',
      'og-incomplete',
      'og-missing',
      'og-url-mismatch',
      'twitter-card-missing',
    ])
    expect(unobservedIssues([older('document')])).toEqual([
      'charset-missing',
      'html-lang-invalid',
      'html-lang-missing',
      'viewport-missing',
    ])
    expect(unobservedIssues([older('structuredDataTypes', 'structuredDataProblems')])).toEqual([
      'structured-data-recommended-missing',
      'structured-data-required-missing',
    ])
  })
})
