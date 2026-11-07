import type { CrawlRepository } from '@seotools/db'

/** Count each parameter at most once per URL, including repeated keys and empty values. */
export function countParameters(urls: readonly string[], counts = new Map<string, number>()) {
  for (const address of urls) {
    try {
      for (const name of new Set(new URL(address).searchParams.keys())) {
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    } catch {
      /* Malformed legacy URLs have no readable parameters. */
    }
  }
  return counts
}

/** Internal URLs with a query string read to count parameters, at most. */
export const PARAMETER_SCAN_LIMIT = 100_000
const BATCH = 2_000
/** Crawls whose summary is kept in memory: a finished crawl's URLs never change. */
const CACHED = 16

export interface ParameterSummary {
  /** Each parameter with how many internal URLs carry it, most first. */
  parameters: [name: string, urls: number][]
  /** More URLs had a query string than were read. */
  bounded: boolean
}

const summaries = new Map<string, ParameterSummary>()

/**
 * The parameters of a crawl, counted once and remembered for the few crawls looked at last, so
 * paging through where they enter does not read every URL again. Reads only the addresses, a
 * bounded page at a time, in the order the crawler numbered them.
 */
export async function parameterSummary(
  source: Pick<CrawlRepository, 'queryUrls'>,
  crawlId: string,
): Promise<ParameterSummary> {
  const known = summaries.get(crawlId)
  if (known) {
    summaries.delete(crawlId)
    summaries.set(crawlId, known)
    return known
  }
  const counts = new Map<string, number>()
  let read = 0
  let after: number | null = null
  let bounded = false
  for (;;) {
    const page: { urls: string[]; next: number | null } = await source.queryUrls(crawlId, {
      after,
      limit: Math.min(BATCH, PARAMETER_SCAN_LIMIT - read),
    })
    countParameters(page.urls, counts)
    read += page.urls.length
    if (page.next === null) break
    if (read >= PARAMETER_SCAN_LIMIT) {
      bounded = true
      break
    }
    after = page.next
  }
  const summary: ParameterSummary = {
    parameters: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    bounded,
  }
  summaries.set(crawlId, summary)
  if (summaries.size > CACHED) summaries.delete(summaries.keys().next().value!)
  return summary
}
