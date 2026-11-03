import { crawlUrlHash, normalizeCrawlUrl, type IssueEvidence } from '@seotools/core'

/**
 * At most this many addresses of a finding's evidence are looked up in the crawl to link to their
 * detail: evidence is bounded, and a URL has few findings with any.
 */
export const MAX_EVIDENCE_LOOKUPS = 60

/**
 * The addresses of evidence that may be pages of the crawl, from the findings of one URL:
 * what elements of the page point at, and what its canonicals resolve to. Without those that are
 * pages of the crawl by construction (`related-urls`), and each address once.
 */
export function evidenceAddresses(issues: readonly { evidence?: IssueEvidence }[]): string[] {
  const found = new Set<string>()
  for (const { evidence } of issues) {
    if (!evidence || evidence.kind === 'related-urls') continue
    for (const item of evidence.items) {
      const url = item.url === null ? null : normalizeCrawlUrl(item.url)
      if (url) found.add(url)
    }
  }
  return [...found]
}

/**
 * The addresses in the evidence of some findings that the crawl has a page for, which are the only
 * ones the detail links to its own detail. The other pages of a duplicate are in the crawl by
 * construction. `has` says whether the crawl has an address (a query, so it is only asked for
 * `limit` of them).
 */
export async function crawlUrlsInEvidence(
  issues: readonly { evidence?: IssueEvidence }[],
  has: (url: string) => Promise<boolean>,
  limit = MAX_EVIDENCE_LOOKUPS,
): Promise<Set<string>> {
  const known = new Set<string>()
  for (const { evidence } of issues) {
    if (evidence?.kind !== 'related-urls') continue
    for (const url of evidence.urls) {
      const normalized = normalizeCrawlUrl(url)
      if (normalized) known.add(normalized)
    }
  }
  const asked = evidenceAddresses(issues)
    .filter((url) => !known.has(url))
    .slice(0, limit)
  const answers = await Promise.all(asked.map(has))
  asked.forEach((url, index) => {
    if (answers[index]) known.add(url)
  })
  return known
}

/**
 * How an address in evidence is shown. Evidence is what a site wrote, so an address becomes a link
 * only when it is an HTTP(S) URL after the crawler's own rules (`normalizeCrawlUrl`: never
 * `javascript:`, `data:` and the like): to the detail of the page if the crawl has it, and to the
 * address itself, opened apart, if not. Anything else is text.
 */
export type EvidenceTarget =
  | { kind: 'crawl'; hash: string; url: string }
  | { kind: 'external'; url: string }
  | { kind: 'text' }

export function evidenceTarget(url: string | null, known: ReadonlySet<string>): EvidenceTarget {
  const normalized = url === null ? null : normalizeCrawlUrl(url)
  if (normalized === null) return { kind: 'text' }
  return known.has(normalized)
    ? { kind: 'crawl', hash: crawlUrlHash(normalized), url: normalized }
    : { kind: 'external', url: normalized }
}
