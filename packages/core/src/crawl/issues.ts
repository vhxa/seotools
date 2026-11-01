/**
 * The issues a page can have. This is the one place that says what counts as an issue: a page with
 * none is "correct", one with at least one is "with issues". To add, change or drop an issue, edit
 * `PAGE_ISSUES` and add its `PageIssues.<id>` messages (`name` and `description`) to the web app;
 * a test fails if a message is missing. The worker re-checks every page of a full crawl when it
 * ends, so a change shows up from the next crawl.
 *
 * Pure on purpose (no Node imports): client components import it through
 * `@seotools/core/crawl/issues`.
 */

export const ISSUE_SEVERITIES = ['error', 'warning'] as const
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number]

/** What the checks may look at: a subset of what the crawler stores for a page. */
export interface PageSubject {
  statusCode: number | null
  title: string | null
  data: { description?: string; h1?: string[] } | null
}

export interface PageIssueDefinition {
  severity: IssueSeverity
  /** Whether the page has the issue. Looks at one page only. */
  detect: (page: PageSubject) => boolean
}

const isBlank = (value: string | null | undefined) => !value || value.trim() === ''

/**
 * PLACEHOLDERS: three simple checks so the pages overview and detail have something to show. The
 * real list is still to be defined.
 */
export const PAGE_ISSUES = {
  'http-error': {
    severity: 'error',
    detect: (page) => page.statusCode !== null && page.statusCode >= 400,
  },
  'missing-title': {
    severity: 'warning',
    detect: (page) => isBlank(page.title),
  },
  'missing-description': {
    severity: 'warning',
    detect: (page) => isBlank(page.data?.description),
  },
} as const satisfies Record<string, PageIssueDefinition>

export type PageIssueId = keyof typeof PAGE_ISSUES

export const PAGE_ISSUE_IDS = Object.keys(PAGE_ISSUES) as PageIssueId[]

export const isPageIssueId = (value: unknown): value is PageIssueId =>
  typeof value === 'string' && Object.hasOwn(PAGE_ISSUES, value)

/** The issues a page has, in the order of `PAGE_ISSUES`. */
export function detectPageIssues(page: PageSubject): PageIssueId[] {
  return PAGE_ISSUE_IDS.filter((id) => PAGE_ISSUES[id].detect(page))
}
