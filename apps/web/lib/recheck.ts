import {
  MAX_VERIFICATION_URLS,
  compareWithCrawl,
  crawlFileKindOf,
  isInternalUrl,
  normalizeCrawlUrl,
  type CrawlUrlSource,
  type RecheckPreview,
  type VerificationComparison,
} from '@seotools/core'
import type { Verification, VerifiedUrl } from '@seotools/db'

export type RecheckUrlsError = 'none' | 'invalid' | 'tooMany'

/** More than this many entries is not a selection, whatever they hold: it is not even read. */
const MAX_ENTRIES = MAX_VERIFICATION_URLS * 4

/**
 * The URLs a client asks to recheck, as the server will take them: normalized, each once, all of
 * the domain. What comes from a client is checked, including that it is a list at all. Entries that
 * are not a URL of the domain are left out, and a list with none left is refused; a list that is
 * too long is refused whole, never cut, so nobody believes more URLs were rechecked than were.
 */
export function parseRecheckUrls(
  input: unknown,
  host: string,
): { ok: true; urls: string[] } | { ok: false; error: RecheckUrlsError } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'none' }
  if (input.length > MAX_ENTRIES) return { ok: false, error: 'tooMany' }
  const urls = new Set<string>()
  for (const entry of input) {
    if (typeof entry !== 'string') continue
    const url = normalizeCrawlUrl(entry)
    if (url && isInternalUrl(url, host)) urls.add(url)
  }
  if (urls.size === 0) return { ok: false, error: 'invalid' }
  if (urls.size > MAX_VERIFICATION_URLS) return { ok: false, error: 'tooMany' }
  return { ok: true, urls: [...urls] }
}

/**
 * Whether a URL of a crawl can be rechecked: one of the site that is not a crawl file. The files
 * for crawlers (robots.txt, sitemaps, llms.txt…) have their own refresh, and rechecking one would
 * not change what the rest of the site was judged against.
 */
export const canRecheck = (url: { scope: string; source: CrawlUrlSource }) =>
  url.scope === 'internal' && crawlFileKindOf(url.source) === null

/** How a recheck relates to the last full crawl, for the one URL it is shown on. */
export interface RecheckView {
  verified: VerifiedUrl
  /** When the URL was requested again. */
  verifiedAt: Date
  /** Under the audit configuration in force now. If not, rules changed after it was made. */
  current: boolean
  /**
   * Against what the crawl found at the URL. `null` when they cannot be compared: under different
   * configurations, a finding could appear or go away only because the rules moved.
   */
  comparison: VerificationComparison | null
  notComparable: 'rules-changed' | 'not-analysed' | null
}

/**
 * Reads a recheck next to the last full crawl, which it never changes. A recheck that is older than
 * what the crawl got from the same URL is not shown: the crawl has the later word.
 */
export function viewRecheck(input: {
  verified: VerifiedUrl | null
  crawl: {
    /** Required: an HTML-only recheck never settles a rendered crawl's document findings. */
    rendering: { mode: 'html' | 'rendered' } | null
    auditVersion: number | null
    pagesByWorstIssue: unknown
    auditSnapshot?: { unobserved?: string[] | undefined } | null
  }
  /** When the crawl requested this URL. */
  crawledAt: Date | null
  /** The issues the crawl found at this URL. */
  crawlIssues: readonly string[]
  /** The version of the audit configuration in force now. */
  configVersion: number
}): RecheckView | null {
  const { verified, crawl } = input
  if (!verified?.outcome || verified.fetchedAt === null) return null
  if (input.crawledAt && verified.fetchedAt.getTime() <= input.crawledAt.getTime()) return null

  const analysed = crawl.pagesByWorstIssue !== null
  const sameRules = (crawl.auditVersion ?? 0) === verified.auditVersion
  const comparable = analysed && sameRules
  return {
    verified,
    verifiedAt: verified.fetchedAt,
    current: verified.auditVersion === input.configVersion,
    comparison: comparable
      ? compareWithCrawl({
          renderedBase: input.crawl.rendering?.mode === 'rendered',
          crawl: input.crawlIssues,
          recheck: verified.outcome.findings.map((finding) => finding.issue),
          unchecked: verified.outcome.unchecked,
          accepted: (verified.outcome.accepted ?? []).map((finding) => finding.issue),
          unobserved: crawl.auditSnapshot?.unobserved ?? [],
        })
      : null,
    notComparable: comparable ? null : analysed ? 'rules-changed' : 'not-analysed',
  }
}

/**
 * What the newest recheck of a URL says about its share preview, when it is later than the latest
 * crawl: what it read of the page, or how the URL answered instead of a page.
 */
export type RecheckPreviewSource =
  | { kind: 'page'; at: Date; preview: RecheckPreview }
  | {
      kind: 'not-page'
      at: Date
      /** What it answered: a redirect, a status that is not a success, a failure or not HTML. */
      answer:
        | { type: 'redirect'; statusCode: number | null; to: string | null }
        | { type: 'status'; statusCode: number }
        | { type: 'not-html'; statusCode: number; contentType: string | null }
        | { type: 'no-answer' }
    }

/**
 * Whether the preview of the latest crawl is to be replaced by the one of a recheck. Only for the
 * latest crawl (`historical` is false): an older crawl is shown as it was. `view` is already `null`
 * for no recheck, a recheck older than the crawl and one pruned; one that saw a page but kept no
 * preview (made before it was kept) says nothing, and the crawl's preview stands.
 */
export function previewSourceOf(input: {
  view: RecheckView | null
  historical: boolean
}): RecheckPreviewSource | null {
  const { view } = input
  if (input.historical || !view) return null
  const { verified, verifiedAt } = view
  const preview = verified.outcome?.preview
  if (preview) return { kind: 'page', at: verifiedAt, preview }
  const status = verified.statusCode
  if (status === null) return { kind: 'not-page', at: verifiedAt, answer: { type: 'no-answer' } }
  if (verified.kind === 'redirect' || (status >= 300 && status < 400)) {
    return {
      kind: 'not-page',
      at: verifiedAt,
      answer: { type: 'redirect', statusCode: status, to: verified.redirectTo },
    }
  }
  if (status < 200 || status >= 300) {
    return { kind: 'not-page', at: verifiedAt, answer: { type: 'status', statusCode: status } }
  }
  if (verified.kind !== 'page') {
    return {
      kind: 'not-page',
      at: verifiedAt,
      answer: { type: 'not-html', statusCode: status, contentType: verified.contentType },
    }
  }
  // A page that answered, from a recheck that did not keep its preview: it says nothing.
  return null
}

/** How long a finished recheck is announced: a banner that never goes away is not news. */
export const ANNOUNCE_MS = 15 * 60_000

export type RecheckAnnouncement =
  | { kind: 'active'; verification: Verification }
  | { kind: 'done' | 'failed'; verification: Verification }

/**
 * What the domain has to say about its rechecks right now: the one under way, or the last one if it
 * ended a moment ago and either finished or failed. A cancelled one, or an old one, is not news.
 */
export function announceRecheck(input: {
  active: Verification | null
  latest: Verification | null
  now: number
}): RecheckAnnouncement | null {
  const { active, latest } = input
  if (active) return { kind: 'active', verification: active }
  if (!latest?.finishedAt || input.now - latest.finishedAt.getTime() >= ANNOUNCE_MS) return null
  if (latest.status === 'completed') return { kind: 'done', verification: latest }
  if (latest.status === 'failed') return { kind: 'failed', verification: latest }
  return null
}
