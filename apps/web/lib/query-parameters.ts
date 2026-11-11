import { stripIgnoredParameters } from '@seotools/core/crawl/normalize'
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
const CACHED = 2

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
  cache = true,
): Promise<ParameterSummary> {
  const known = cache ? summaries.get(crawlId) : undefined
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
    const page: { urls: string[]; observations?: ParameterObservation[]; next: number | null } =
      await source.queryUrls(crawlId, {
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
  if (cache) summaries.set(crawlId, summary)
  if (summaries.size > CACHED) summaries.delete(summaries.keys().next().value!)
  return summary
}

export interface ParameterObservation {
  url: string
  canonical: string | null
}
export type SuggestionReason = 'volatile' | 'canonical'
const TRACKING = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'dclid',
  'gbraid',
  'wbraid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'yclid',
  'igshid',
])

export const isTrackingParameter = (name: string) => name.startsWith('utm_') || TRACKING.has(name)

type Stats = { groups: Map<string, Set<string>>; canonical: number; total: number }
const index = (rows: readonly ParameterObservation[], names = new Map<string, Stats>()) => {
  for (const row of rows) {
    let parsed: URL
    try {
      parsed = new URL(row.url)
    } catch {
      continue
    }
    for (const name of new Set(parsed.searchParams.keys())) {
      const stats = names.get(name) ?? { groups: new Map(), canonical: 0, total: 0 }
      const key = stripIgnoredParameters(row.url, [name])
      const values = stats.groups.get(key) ?? new Set<string>()
      values.add(JSON.stringify(parsed.searchParams.getAll(name)))
      stats.groups.set(key, values)
      stats.total++
      if (row.canonical === key) stats.canonical++
      names.set(name, stats)
    }
  }
  return names
}

/** Compare unambiguous URL pairs only; multiple distinct values in a crawl are not volatility. */
export function parameterSuggestions(
  current: readonly ParameterObservation[],
  previous: readonly ParameterObservation[] = [],
): Map<string, SuggestionReason[]> {
  return suggestionsFrom(index(current), index(previous))
}

function suggestionsFrom(current: Map<string, Stats>, before: Map<string, Stats>) {
  const suggestions = new Map<string, SuggestionReason[]>()
  for (const [name, stats] of current) {
    const reasons: SuggestionReason[] = []
    if (isTrackingParameter(name)) continue
    if (stats.total >= 5 && stats.canonical / stats.total >= 0.9) reasons.push('canonical')
    let pairs = 0,
      changed = 0
    for (const [key, values] of stats.groups) {
      const old = before.get(name)?.groups.get(key)
      if (values.size !== 1 || old?.size !== 1) continue
      pairs++
      if ([...values][0] !== [...old][0]) changed++
    }
    if (pairs >= 5 && changed / pairs >= 0.9) reasons.push('volatile')
    if (reasons.length) suggestions.set(name, reasons)
  }
  return suggestions
}

/** Only the small computed suggestions survive a request; observations are consumed batch by batch. */
const suggestionCache = new Map<string, Map<string, SuggestionReason[]>>()
export async function crawlParameterSuggestions(
  source: Pick<CrawlRepository, 'queryUrls'>,
  ids: readonly string[],
) {
  const key = JSON.stringify(ids)
  const known = suggestionCache.get(key)
  if (known) return known
  const indexes = []
  for (const id of ids.slice(0, 2)) {
    const stats = new Map<string, Stats>()
    let after: number | null = null
    let read = 0
    for (;;) {
      const page = await source.queryUrls(id, {
        after,
        limit: Math.min(BATCH, PARAMETER_SCAN_LIMIT - read),
      })
      index(page.observations ?? page.urls.map((url) => ({ url, canonical: null })), stats)
      read += page.urls.length
      if (page.next === null || read >= PARAMETER_SCAN_LIMIT) break
      after = page.next
    }
    indexes.push(stats)
  }
  const result = suggestionsFrom(indexes[0] ?? new Map(), indexes[1] ?? new Map())
  suggestionCache.clear()
  suggestionCache.set(key, result)
  return result
}
