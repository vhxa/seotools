/**
 * The issues a URL can have, in the order and groups the UI shows them. This is the one place that
 * says which ones exist and how serious each is; `CHECKS` in the worker says how each is detected.
 * To add one, add it to `ISSUE_CATALOG`, to `CHECKS` (types fail until you do) and its
 * `PageIssues.<id>` messages (`name` and `description`) to the web app (a test fails until you do).
 * The worker checks a full crawl when it ends, so a change shows up from the next crawl.
 *
 * Pure on purpose (no Node imports): client components import it through
 * `@seotools/core/crawl/issues`.
 */

/** Worst first. */
export const ISSUE_TYPES = ['issue', 'warning', 'opportunity'] as const
export type IssueType = (typeof ISSUE_TYPES)[number]

/** Highest first. */
export const ISSUE_IMPORTANCES = ['high', 'medium', 'low'] as const
export type IssueImportance = (typeof ISSUE_IMPORTANCES)[number]

/**
 * What an issue says about each URL that has it, beyond having it. Shown in a column of its own
 * when the table is filtered by that issue.
 * - `hreflang-source`: where the hreflang came from, one of `HREFLANG_SOURCES`.
 * - `security-header`: the names of the headers that are missing.
 * - `indexability-blocker`: what keeps a URL from being indexable, from `INDEXABILITY_BLOCKERS`.
 */
export type IssueDetailKind = 'hreflang-source' | 'security-header' | 'indexability-blocker'

type Entry = readonly [type: IssueType, importance: IssueImportance, detail?: IssueDetailKind]

/**
 * By category, each in the order it is listed. Groups of categories are in `ISSUE_GROUPS`.
 *
 * The type says what kind of finding it is, and the importance how much it matters, independently:
 * - `issue`: crawling and indexing problems.
 * - `warning`: something to review, which can be as important as an issue (a security problem is a
 *   high-importance warning).
 * - `opportunity`: an improvement.
 */
const ISSUE_CATALOG = {
  'response-codes': {
    'no-response': ['issue', 'high'],
    'server-error': ['issue', 'high'],
    'client-error': ['issue', 'high'],
    'redirect-loop': ['issue', 'high'],
    'soft-404-confirmed': ['warning', 'high'],
    'soft-404-possible': ['warning', 'high'],
    'redirect-chain': ['warning', 'medium'],
    'refresh-redirect': ['warning', 'medium'],
    'robots-blocked': ['issue', 'high'],
    'redirect-3xx': ['warning', 'low'],
    'broken-external-link': ['warning', 'low'],
  },
  // What the user declared of a URL, against what the crawl saw. See `crawl/audit`: the expectation
  // about indexing as a whole, and what a rule requires or forbids of one directive or file.
  'indexing-intent': {
    'expected-indexable-blocked': ['issue', 'high', 'indexability-blocker'],
    'expected-not-indexable-but-indexable': ['issue', 'high'],
    'noindex-required-missing': ['issue', 'high'],
    'nofollow-required-missing': ['issue', 'high'],
    'robots-block-required-missing': ['issue', 'high'],
    'sitemap-required-missing': ['issue', 'high'],
    'sitemap-forbidden-present': ['issue', 'high'],
  },
  directives: {
    'directive-outside-head': ['warning', 'low'],
    'directives-conflict': ['issue', 'high'],
    'directives-conflict-snippets': ['warning', 'medium'],
    noindex: ['issue', 'high'],
    nofollow: ['warning', 'medium'],
    nosnippet: ['warning', 'high'],
    'max-snippet-limited': ['warning', 'medium'],
    noimageindex: ['issue', 'medium'],
    'unavailable-after-expired': ['issue', 'high'],
    'unavailable-after-future': ['warning', 'medium'],
  },
  canonicals: {
    'canonical-outside-head': ['issue', 'high'],
    'canonical-conflict': ['issue', 'high'],
    'canonical-not-indexable': ['issue', 'high', 'indexability-blocker'],
    'canonical-fragment': ['warning', 'medium'],
    'canonical-missing': ['warning', 'low'],
    canonicalised: ['warning', 'low'],
    'canonical-relative': ['warning', 'low'],
    'canonical-repeated': ['warning', 'low'],
  },
  sitemaps: {
    'sitemap-too-big': ['issue', 'high'],
    'sitemap-not-indexable': ['issue', 'medium', 'indexability-blocker'],
    'indexed-not-in-sitemap': ['warning', 'high'],
    'indexable-not-in-sitemap': ['warning', 'low'],
  },
  hreflang: {
    'hreflang-unreachable': ['issue', 'high', 'hreflang-source'],
    'hreflang-redirect': ['warning', 'medium', 'hreflang-source'],
    'hreflang-no-return': ['warning', 'high', 'hreflang-source'],
    'hreflang-invalid-code': ['warning', 'high', 'hreflang-source'],
    'hreflang-outside-head': ['warning', 'high', 'hreflang-source'],
    'hreflang-non-canonical': ['warning', 'medium', 'hreflang-source'],
    'hreflang-noindex': ['issue', 'high', 'hreflang-source'],
    'hreflang-same-language': ['warning', 'medium', 'hreflang-source'],
    'hreflang-no-self': ['warning', 'medium', 'hreflang-source'],
    'hreflang-no-x-default': ['opportunity', 'low', 'hreflang-source'],
  },
  title: {
    'title-missing': ['warning', 'high'],
    'title-outside-head': ['warning', 'medium'],
    'title-multiple': ['warning', 'medium'],
    'title-duplicate': ['opportunity', 'medium'],
    'title-too-long': ['opportunity', 'low'],
    'title-too-short': ['opportunity', 'low'],
  },
  'meta-description': {
    'description-multiple': ['warning', 'low'],
    'description-outside-head': ['warning', 'low'],
    'description-missing': ['opportunity', 'medium'],
    'description-duplicate': ['opportunity', 'medium'],
    'description-too-long': ['opportunity', 'low'],
    'description-too-short': ['opportunity', 'low'],
  },
  headings: {
    'h1-missing': ['warning', 'medium'],
    'h1-multiple': ['warning', 'low'],
    'heading-empty': ['warning', 'low'],
    'heading-skipped-level': ['warning', 'low'],
    'h2-missing': ['opportunity', 'low'],
    'h1-duplicate': ['opportunity', 'low'],
    'heading-too-long': ['opportunity', 'low'],
  },
  content: {
    'content-duplicate': ['warning', 'high'],
    'content-near-duplicate': ['warning', 'medium'],
    'content-placeholder': ['warning', 'medium'],
    'content-thin': ['opportunity', 'low'],
  },
  images: {
    'img-no-alt': ['warning', 'high'],
    'img-empty-alt': ['opportunity', 'low'],
    'img-too-heavy': ['opportunity', 'low'],
    'img-no-size': ['opportunity', 'low'],
    'img-long-alt': ['opportunity', 'low'],
  },
  'structured-data': {
    'json-ld-invalid': ['warning', 'high'],
    'no-structured-data': ['opportunity', 'low'],
  },
  links: {
    'link-to-localhost': ['issue', 'high'],
    'uncrawlable-links': ['issue', 'medium'],
    'only-nofollow-inlinks': ['warning', 'medium'],
    'only-noindex-inlinks': ['warning', 'medium'],
    'orphan-in-sitemap': ['issue', 'medium'],
    'no-outgoing-links': ['warning', 'low'],
    'internal-nofollow-links': ['warning', 'low'],
    'deep-page': ['opportunity', 'medium'],
    'anchor-empty': ['opportunity', 'low'],
    'anchor-vague': ['opportunity', 'low'],
  },
  urls: {
    'url-multiple-slashes': ['warning', 'low'],
    'url-spaces': ['warning', 'medium'],
    'url-tracking': ['warning', 'medium'],
    'url-uppercase': ['warning', 'low'],
    'url-repetitive-path': ['warning', 'low'],
    'url-internal-search': ['warning', 'medium'],
    'url-underscores': ['opportunity', 'low'],
    'url-too-long': ['opportunity', 'low'],
  },
  security: {
    'http-url': ['warning', 'high'],
    'mixed-content': ['warning', 'high'],
    'insecure-form': ['warning', 'high'],
    'missing-security-header': ['warning', 'low', 'security-header'],
    'unsafe-cross-origin-links': ['warning', 'low'],
    'protocol-relative': ['warning', 'low'],
  },
  html: {
    'invalid-head-elements': ['warning', 'high'],
    'html-structure-broken': ['issue', 'high'],
    'multiple-head-or-body': ['warning', 'medium'],
    'document-too-big': ['issue', 'medium'],
    'content-before-head': ['warning', 'medium'],
  },
} as const satisfies Record<string, Record<string, Entry>>

type Catalog = typeof ISSUE_CATALOG

export type IssueCategoryId = keyof Catalog
export type PageIssueId = { [C in IssueCategoryId]: keyof Catalog[C] & string }[IssueCategoryId]

export const ISSUE_GROUPS = [
  { id: 'crawling', categories: ['response-codes'] },
  {
    id: 'indexing',
    categories: ['indexing-intent', 'directives', 'canonicals', 'sitemaps', 'hreflang'],
  },
  {
    id: 'on-page',
    categories: ['title', 'meta-description', 'headings', 'content', 'images', 'structured-data'],
  },
  { id: 'architecture', categories: ['links', 'urls'] },
  { id: 'technical', categories: ['security', 'html'] },
] as const satisfies readonly { id: string; categories: readonly IssueCategoryId[] }[]

export type IssueGroupId = (typeof ISSUE_GROUPS)[number]['id']

export interface PageIssueDefinition {
  category: IssueCategoryId
  type: IssueType
  importance: IssueImportance
  detail?: IssueDetailKind
}

export const PAGE_ISSUES = Object.fromEntries(
  Object.entries(ISSUE_CATALOG).flatMap(([category, issues]) =>
    Object.entries(issues as Record<string, Entry>).map(([id, [type, importance, detail]]) => [
      id,
      { category, type, importance, ...(detail ? { detail } : {}) },
    ]),
  ),
) as Record<PageIssueId, PageIssueDefinition>

/** Every issue, in the order they are listed. */
export const PAGE_ISSUE_IDS = Object.keys(PAGE_ISSUES) as PageIssueId[]

/**
 * Bump when a check in the worker changes what it finds without the catalog changing (the catalog
 * changing is noticed by itself).
 * - 6: a sitemap lists what its `<loc>` says and not the alternates, images and videos an entry
 *   names (`sitemap-not-indexable` and the sitemap conditions), and `sitemap-not-indexable` says
 *   what keeps the URL from being indexed. Analysing a crawl again does not repair one that stored
 *   every URL of a sitemap alike: it stops claiming a listing it cannot prove.
 */
const CHECKS_REVISION = 6

/**
 * Identifies this list of issues with their types and importance, and the way they are detected.
 * Crawls keep the one they were analysed with, and the worker analyses again those that have
 * another.
 */
export const ISSUE_CATALOG_VERSION = (() => {
  let hash = 5381
  for (const char of PAGE_ISSUE_IDS.map(
    (id) => `${id}:${PAGE_ISSUES[id].type}:${PAGE_ISSUES[id].importance}`,
  ).join('|')) {
    hash = (Math.imul(hash, 33) + char.charCodeAt(0)) >>> 0
  }
  return `${CHECKS_REVISION}.${hash.toString(36)}`
})()

export const isPageIssueId = (value: unknown): value is PageIssueId =>
  typeof value === 'string' && Object.hasOwn(PAGE_ISSUES, value)

/** The issues of a category, in the order they are listed. */
export const issuesOfCategory = (category: IssueCategoryId) =>
  Object.keys(ISSUE_CATALOG[category]) as PageIssueId[]

/** The worst type among some issues. `null` if there are none. */
export function worstIssueType(ids: Iterable<PageIssueId>): IssueType | null {
  let worst: number | null = null
  for (const id of ids) {
    const rank = ISSUE_TYPES.indexOf(PAGE_ISSUES[id].type)
    if (worst === null || rank < worst) worst = rank
  }
  return worst === null ? null : (ISSUE_TYPES[worst] ?? null)
}

/** Worst type first, then the most important. For lists that are not in catalog order. */
export function compareIssueSeverity(a: PageIssueId, b: PageIssueId): number {
  return (
    ISSUE_TYPES.indexOf(PAGE_ISSUES[a].type) - ISSUE_TYPES.indexOf(PAGE_ISSUES[b].type) ||
    ISSUE_IMPORTANCES.indexOf(PAGE_ISSUES[a].importance) -
      ISSUE_IMPORTANCES.indexOf(PAGE_ISSUES[b].importance)
  )
}

/**
 * How many audited pages of a crawl have each type as the worst of their findings. A page is
 * counted once, so with the audited pages that have none these add up to the audited pages. Pages
 * excluded from the audit have no findings and are in none.
 */
export type PagesByWorstIssue = Record<IssueType, number>

/**
 * How many audited pages of a crawl have at least one finding of each type. A page can be in
 * several.
 */
export type PagesWithType = Record<IssueType, number>
