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
 */
export type IssueDetailKind = 'hreflang-source' | 'security-header'

type Entry = readonly [type: IssueType, importance: IssueImportance, detail?: IssueDetailKind]

/** By category, each in the order it is listed. Groups of categories are in `ISSUE_GROUPS`. */
const ISSUE_CATALOG = {
  'response-codes': {
    'no-response': ['issue', 'high'],
    'server-error': ['issue', 'high'],
    'client-error': ['issue', 'high'],
    'redirect-loop': ['issue', 'high'],
    'soft-404': ['warning', 'high'],
    'redirect-chain': ['warning', 'medium'],
    'refresh-redirect': ['warning', 'medium'],
    'robots-blocked': ['warning', 'medium'],
    'redirect-3xx': ['warning', 'low'],
    'broken-external-link': ['warning', 'low'],
  },
  directives: {
    'directive-outside-head': ['issue', 'high'],
    'directives-conflict': ['issue', 'high'],
    noindex: ['warning', 'high'],
    nofollow: ['warning', 'medium'],
    'snippet-limited': ['warning', 'medium'],
    noimageindex: ['warning', 'low'],
    'unavailable-after': ['warning', 'low'],
  },
  canonicals: {
    'canonical-outside-head': ['issue', 'high'],
    'canonical-conflict': ['issue', 'high'],
    'canonical-not-indexable': ['issue', 'high'],
    'canonical-fragment': ['issue', 'medium'],
    'canonical-missing': ['warning', 'medium'],
    canonicalised: ['warning', 'low'],
    'canonical-relative': ['warning', 'low'],
    'canonical-repeated': ['warning', 'low'],
  },
  sitemaps: {
    'sitemap-too-big': ['issue', 'high'],
    'sitemap-not-indexable': ['issue', 'high'],
    'orphan-in-sitemap': ['issue', 'medium'],
    'indexable-not-in-sitemap': ['issue', 'medium'],
    'in-many-sitemaps': ['warning', 'low'],
  },
  hreflang: {
    'hreflang-not-200': ['issue', 'high', 'hreflang-source'],
    'hreflang-no-return': ['issue', 'high', 'hreflang-source'],
    'hreflang-invalid-code': ['issue', 'high', 'hreflang-source'],
    'hreflang-outside-head': ['issue', 'high', 'hreflang-source'],
    'hreflang-non-canonical': ['issue', 'medium', 'hreflang-source'],
    'hreflang-noindex': ['issue', 'medium', 'hreflang-source'],
    'hreflang-same-language': ['issue', 'medium', 'hreflang-source'],
    'hreflang-no-self': ['warning', 'low', 'hreflang-source'],
    'hreflang-no-x-default': ['warning', 'low', 'hreflang-source'],
  },
  title: {
    'title-missing': ['issue', 'high'],
    'title-outside-head': ['issue', 'high'],
    'title-multiple': ['issue', 'medium'],
    'title-duplicate': ['opportunity', 'medium'],
    'title-too-long': ['opportunity', 'low'],
    'title-too-short': ['opportunity', 'low'],
    'title-same-as-h1': ['opportunity', 'low'],
  },
  'meta-description': {
    'description-multiple': ['issue', 'medium'],
    'description-outside-head': ['issue', 'medium'],
    'description-missing': ['opportunity', 'medium'],
    'description-duplicate': ['opportunity', 'medium'],
    'description-too-long': ['opportunity', 'low'],
    'description-too-short': ['opportunity', 'low'],
  },
  headings: {
    'h1-missing': ['issue', 'medium'],
    'h1-multiple': ['warning', 'low'],
    'heading-empty': ['warning', 'low'],
    'heading-skipped-level': ['warning', 'low'],
    'h2-missing': ['warning', 'low'],
    'h1-duplicate': ['opportunity', 'low'],
    'heading-too-long': ['opportunity', 'low'],
  },
  content: {
    'content-duplicate': ['issue', 'high'],
    'content-near-duplicate': ['warning', 'medium'],
    'content-placeholder': ['warning', 'medium'],
    'content-thin': ['opportunity', 'low'],
  },
  images: {
    'img-no-alt': ['issue', 'medium'],
    'img-empty-alt': ['warning', 'low'],
    'img-too-heavy': ['opportunity', 'low'],
    'img-no-size': ['opportunity', 'low'],
    'img-long-alt': ['opportunity', 'low'],
  },
  'structured-data': {
    'json-ld-invalid': ['issue', 'high'],
    'no-structured-data': ['opportunity', 'low'],
  },
  links: {
    'link-to-localhost': ['issue', 'high'],
    'uncrawlable-links': ['warning', 'medium'],
    'only-nofollow-inlinks': ['warning', 'medium'],
    'only-noindex-inlinks': ['warning', 'medium'],
    'no-outgoing-links': ['warning', 'low'],
    'internal-nofollow-links': ['warning', 'low'],
    'deep-page': ['opportunity', 'medium'],
    'anchor-empty': ['opportunity', 'low'],
    'anchor-vague': ['opportunity', 'low'],
  },
  urls: {
    'url-multiple-slashes': ['issue', 'medium'],
    'url-spaces': ['issue', 'medium'],
    'url-tracking': ['warning', 'medium'],
    'url-uppercase': ['warning', 'low'],
    'url-non-ascii': ['warning', 'low'],
    'url-parameters': ['warning', 'low'],
    'url-repetitive-path': ['warning', 'low'],
    'url-internal-search': ['warning', 'low'],
    'url-underscores': ['opportunity', 'low'],
    'url-too-long': ['opportunity', 'low'],
  },
  security: {
    'http-url': ['issue', 'high'],
    'mixed-content': ['issue', 'high'],
    'insecure-form': ['issue', 'medium'],
    'missing-security-header': ['warning', 'low', 'security-header'],
    'unsafe-cross-origin-links': ['warning', 'low'],
    'protocol-relative': ['warning', 'low'],
  },
  html: {
    'invalid-head-elements': ['issue', 'high'],
    'missing-head-or-body': ['issue', 'high'],
    'multiple-head-or-body': ['issue', 'high'],
    'document-too-big': ['issue', 'medium'],
    'head-not-first': ['warning', 'medium'],
  },
} as const satisfies Record<string, Record<string, Entry>>

type Catalog = typeof ISSUE_CATALOG

export type IssueCategoryId = keyof Catalog
export type PageIssueId = { [C in IssueCategoryId]: keyof Catalog[C] & string }[IssueCategoryId]

export const ISSUE_GROUPS = [
  { id: 'crawling', categories: ['response-codes'] },
  { id: 'indexing', categories: ['directives', 'canonicals', 'sitemaps', 'hreflang'] },
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

/** How many pages of a crawl have each type as the worst of their issues. */
export type PagesByWorstIssue = Record<IssueType, number>

/** The pages that count as having issues when `threshold` is the mildest type that counts. */
export function pagesWithIssues(pages: PagesByWorstIssue, threshold: IssueType): number {
  const last = ISSUE_TYPES.indexOf(threshold)
  return ISSUE_TYPES.slice(0, last + 1).reduce((total, type) => total + pages[type], 0)
}
