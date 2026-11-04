/**
 * Rechecking some URLs after a fix, without a full crawl: what a recheck can establish and what it
 * cannot. Pure (no Node imports), so client components import it through
 * `@seotools/core/crawl/verification`.
 *
 * A recheck requests the URLs again and has the fresh answer of each one. That is enough to settle
 * the findings that are a fact about the URL itself, and not enough for the ones that are a fact
 * about the site (a duplicate needs every other page, an orphan needs every link): those can only
 * be confirmed by a full crawl, so a recheck never reports one as fixed, nor as new.
 */
import { PAGE_ISSUE_IDS, isPageIssueId, type PageIssueId } from './issues'
import type { UrlAuditState } from './audit'

/** Most URLs one recheck takes: a recheck is a few requests, not a crawl. */
export const MAX_VERIFICATION_URLS = 50

export const VERIFICATION_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

/** Still to be done, or done and with its result. */
export type VerificationUrlState = 'queued' | 'done'

/**
 * What it takes to tell whether a URL has an issue.
 * - `url`: the fresh answer of the URL itself, its address and the audit configuration. A recheck
 *   settles these.
 * - `site`: other pages, links, sitemaps or the redirect trail. A recheck cannot: only a full crawl.
 *
 * Every issue is classified here, and TypeScript fails until a new one is: guessing `url` for an
 * issue that reads the rest of the site would report as fixed what nobody checked. The worker
 * enforces it too: checks of the first kind run without access to the rest of the site.
 */
export type VerificationScope = 'url' | 'site'

const U = 'url'
const S = 'site'

const SCOPE: Record<PageIssueId, VerificationScope> = {
  // response codes. The redirect trail goes through other URLs; a broken link is not on this site.
  'no-response': U,
  'server-error': U,
  'client-error': U,
  'redirect-loop': S,
  'soft-404-confirmed': U,
  'soft-404-possible': U,
  'redirect-chain': S,
  'refresh-redirect': U,
  'robots-blocked': U, // against a robots.txt the recheck requests again, not the one of the crawl
  'redirect-3xx': U,
  'broken-external-link': S,
  // what is expected of the indexation, against what the recheck saw
  'expected-indexable-blocked': U,
  'expected-not-indexable-but-indexable': U,
  // what a rule requires or forbids of a directive or file. The directives and robots.txt are read
  // again by a recheck; the sitemaps are not, so no recheck can say a URL is, or is not, in one.
  'noindex-required-missing': U,
  'nofollow-required-missing': U,
  'robots-block-required-missing': U,
  'sitemap-required-missing': S,
  'sitemap-forbidden-present': S,
  // directives
  'directive-outside-head': U,
  'directives-conflict': U,
  'directives-conflict-snippets': U,
  noindex: U,
  nofollow: U,
  nosnippet: U,
  'max-snippet-limited': U,
  noimageindex: U,
  'unavailable-after-expired': U,
  'unavailable-after-future': U,
  // canonicals. Whether the target can be indexed is a fact about another URL.
  'canonical-outside-head': U,
  'canonical-conflict': U,
  'canonical-not-indexable': S,
  'canonical-fragment': U,
  'canonical-missing': U,
  canonicalised: U,
  'canonical-relative': U,
  'canonical-repeated': U,
  // sitemaps: what they list is not read again by a recheck
  'sitemap-too-big': U,
  'sitemap-not-indexable': S,
  'indexed-not-in-sitemap': S,
  'indexable-not-in-sitemap': S,
  // hreflang: a cluster of pages, and sitemaps declare alternates too
  'hreflang-unreachable': S,
  'hreflang-redirect': S,
  'hreflang-no-return': S,
  'hreflang-invalid-code': S,
  'hreflang-outside-head': S,
  'hreflang-non-canonical': S,
  'hreflang-noindex': S,
  'hreflang-same-language': S,
  'hreflang-no-self': S,
  'hreflang-no-x-default': S,
  // title and description: copies are other pages
  'title-missing': U,
  'title-outside-head': U,
  'title-multiple': U,
  'title-duplicate': S,
  'title-too-long': U,
  'title-too-short': U,
  'description-multiple': U,
  'description-outside-head': U,
  'description-missing': U,
  'description-duplicate': S,
  'description-too-long': U,
  'description-too-short': U,
  // headings
  'h1-missing': U,
  'h1-multiple': U,
  'heading-empty': U,
  'heading-skipped-level': U,
  'h2-missing': U,
  'h1-duplicate': S,
  'heading-too-long': U,
  // content
  'content-duplicate': S,
  'content-near-duplicate': S,
  'content-placeholder': U,
  'content-thin': U,
  // images
  'img-no-alt': U,
  'img-empty-alt': U,
  'img-too-heavy': U,
  'img-no-size': U,
  'img-long-alt': U,
  // structured data
  'json-ld-invalid': U,
  'no-structured-data': U,
  // links. The links a page has are its own; who links to it, and how far it is, are not.
  'link-to-localhost': U,
  'uncrawlable-links': U,
  'only-nofollow-inlinks': S,
  'only-noindex-inlinks': S,
  'orphan-in-sitemap': S,
  'no-outgoing-links': U,
  'internal-nofollow-links': U,
  'deep-page': S,
  'anchor-empty': U,
  'anchor-vague': U,
  // URLs: the address itself
  'url-multiple-slashes': U,
  'url-spaces': U,
  'url-tracking': U,
  'url-uppercase': U,
  'url-repetitive-path': U,
  'url-internal-search': U,
  'url-underscores': U,
  'url-too-long': U,
  // security
  'http-url': U,
  'mixed-content': U,
  'insecure-form': U,
  'missing-security-header': U,
  'unsafe-cross-origin-links': U,
  'protocol-relative': U,
  // HTML
  'invalid-head-elements': U,
  'html-structure-broken': U,
  'multiple-head-or-body': U,
  'document-too-big': U,
  'content-before-head': U,
}

export const verificationScopeOf = (issue: PageIssueId): VerificationScope => SCOPE[issue]

/** The issues a recheck settles, in catalog order. */
export const URL_SCOPED_ISSUES: readonly PageIssueId[] = PAGE_ISSUE_IDS.filter(
  (issue) => SCOPE[issue] === 'url',
)

/** The issues only a full crawl settles, in catalog order. */
export const SITE_SCOPED_ISSUES: readonly PageIssueId[] = PAGE_ISSUE_IDS.filter(
  (issue) => SCOPE[issue] === 'site',
)

/** Whether a stored issue id is one a recheck settles. An id the code no longer defines is not. */
export const isUrlScopedIssue = (issue: string): issue is PageIssueId =>
  isPageIssueId(issue) && SCOPE[issue] === 'url'

export const isSiteScopedIssue = (issue: string): issue is PageIssueId =>
  isPageIssueId(issue) && SCOPE[issue] === 'site'

/** What a recheck found at one URL (the shape of `crawl_url_issues`). */
export interface VerificationFinding {
  issue: string
  /** What `PAGE_ISSUES` says the issue details. Absent when it details nothing. */
  details?: string[]
}

/** What a recheck concluded about a URL, stored with the answer it concluded it from. */
export interface VerificationOutcome {
  /** Whether the URL is audited, what is expected of it and what the recheck saw. */
  audit: UrlAuditState
  /** What it found among the issues of `URL_SCOPED_ISSUES`. Empty for a URL left out of the audit. */
  findings: VerificationFinding[]
  /**
   * Issues of `URL_SCOPED_ISSUES` whose check could not be made from this URL alone. Not expected to
   * have any: it is what keeps a misclassified check from reporting as fixed what it did not see.
   */
  unchecked: string[]
}

/**
 * How the findings of a recheck compare with what the last full crawl found at the same URL, over
 * the issues a recheck settles. Meaningful only when both used the same audit configuration.
 */
export interface VerificationComparison {
  /** The crawl found it and the recheck does not. */
  fixed: PageIssueId[]
  /** Both found it. */
  remaining: PageIssueId[]
  /** The recheck found it and the crawl did not. */
  appeared: PageIssueId[]
  /**
   * What the crawl found at this URL that only a full crawl can confirm gone. It is the crawl's
   * word, from its date, and the recheck says nothing about it.
   */
  pendingFullCrawl: PageIssueId[]
}

const byCatalog = (ids: Iterable<PageIssueId>) =>
  [...new Set(ids)].sort((a, b) => PAGE_ISSUE_IDS.indexOf(a) - PAGE_ISSUE_IDS.indexOf(b))

/**
 * Compares the issues of the last full crawl at a URL with a recheck of it. An issue a recheck does
 * not settle is never `fixed` or `appeared`: it is `pendingFullCrawl` if the crawl had it. Issues
 * the recheck could not check (`unchecked`) are pending too, never fixed.
 */
export function compareWithCrawl(input: {
  crawl: readonly string[]
  recheck: readonly string[]
  unchecked?: readonly string[]
}): VerificationComparison {
  const unchecked = new Set(input.unchecked ?? [])
  const before = new Set(input.crawl.filter(isPageIssueId))
  const after = new Set(input.recheck.filter(isPageIssueId))
  const settled = (issue: PageIssueId) => SCOPE[issue] === 'url' && !unchecked.has(issue)
  return {
    fixed: byCatalog([...before].filter((issue) => settled(issue) && !after.has(issue))),
    remaining: byCatalog([...before].filter((issue) => settled(issue) && after.has(issue))),
    appeared: byCatalog([...after].filter((issue) => settled(issue) && !before.has(issue))),
    pendingFullCrawl: byCatalog([...before].filter((issue) => !settled(issue))),
  }
}

/**
 * Whether a recheck still reflects the audit configuration in force. A recheck made under another
 * version could have excluded, or expected something of, a URL differently.
 */
export const verificationIsCurrent = (verified: { auditVersion: number | null }, version: number) =>
  verified.auditVersion === version
