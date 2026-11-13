import type { CrawlPageFacts, PageIssueId } from '@seotools/core'
import type { Site } from './site-audit'

/**
 * The facts of a page that older crawls did not keep: optional in `CrawlPageFacts`, where `undefined`
 * means "not looked at", never "has none".
 */
type OptionalFact = {
  [K in keyof CrawlPageFacts]-?: undefined extends CrawlPageFacts[K] ? K : never
}[keyof CrawlPageFacts]

/**
 * The issues whose check reads each optional fact, and so stays silent without it. TypeScript fails
 * until a fact added as optional is listed (with `[]` when no check depends on it), which is what
 * keeps a later check from reading as "absent" in a crawl that never looked: comparisons use it to
 * tell what a crawl did not observe (`unobservedIssues`).
 */
export const OPTIONAL_FACT_ISSUES: Record<OptionalFact, readonly PageIssueId[]> = {
  structuredDataTypes: ['structured-data-required-missing', 'structured-data-recommended-missing'],
  structuredDataProblems: [
    'structured-data-required-missing',
    'structured-data-recommended-missing',
  ],
  social: [
    'og-missing',
    'og-incomplete',
    'og-image-broken',
    'og-url-mismatch',
    'twitter-card-missing',
  ],
  document: ['html-lang-missing', 'html-lang-invalid', 'viewport-missing', 'charset-missing'],
  // Only the samples of findings that already exist: the finding itself does not depend on it.
  evidence: [],
}

/** Whether the input of each of these issues was recorded for a page, by the facts it was kept with. */
export const INPUT_RECORDED: Partial<Record<PageIssueId, (facts: CrawlPageFacts) => boolean>> =
  (() => {
    const needs = new Map<PageIssueId, (keyof CrawlPageFacts)[]>()
    for (const [fact, issues] of Object.entries(OPTIONAL_FACT_ISSUES) as [
      OptionalFact,
      readonly PageIssueId[],
    ][]) {
      for (const issue of issues) needs.set(issue, [...(needs.get(issue) ?? []), fact])
    }
    return Object.fromEntries(
      [...needs].map(([issue, facts]) => [
        issue,
        (page: CrawlPageFacts) => facts.every((fact) => page[fact] !== undefined),
      ]),
    )
  })()

/**
 * The issues whose input was not recorded on at least one page: not reporting them says nothing,
 * so a comparison must not read their absence as "not there". Sorted, to be stored as it is.
 */
export function unobservedIssues(
  pages: Iterable<CrawlPageFacts>,
  vitalsCollected = false,
): PageIssueId[] {
  const pending = new Set(Object.keys(INPUT_RECORDED) as PageIssueId[])
  const unobserved = new Set<PageIssueId>()
  for (const facts of pages) {
    for (const issue of pending) {
      if (!INPUT_RECORDED[issue]!(facts)) {
        unobserved.add(issue)
        pending.delete(issue)
      }
    }
    if (pending.size === 0) break
  }
  if (!vitalsCollected)
    for (const issue of ['lcp-poor', 'inp-poor', 'cls-poor'] as const) unobserved.add(issue)
  return [...unobserved].sort()
}

/** Every issue reading the rendered-inclusive graph, including positive references and conditions.
 * Partial observations can support positive evidence, but cannot verify changes in either direction.
 */
export const RENDERED_GRAPH_ISSUES = [
  'orphan-in-sitemap',
  'only-nofollow-inlinks',
  'only-noindex-inlinks',
  'deep-page',
  'unlinked-required-missing',
  'linked-only-by-javascript',
  'links-only-after-rendering',
  'links-to-broken',
  'links-to-redirect',
  'links-to-canonicalised',
  'links-tracking-parameters',
] as const satisfies readonly PageIssueId[]

/** HTML observations retain their established behavior. Rendered absence needs every page whole. */
export const graphAbsenceKnown = (site: Pick<Site, 'config' | 'rendersUnobserved'>) =>
  site.config.rendering !== 'rendered' || site.rendersUnobserved === 0
