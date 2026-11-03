import { auditResultsState, type AuditResultsState } from '@seotools/core/crawl/audit'
import type { Crawl, CrawlUrl, CrawlUrlAudit, CrawlUrlIssue } from '@seotools/db'
import { crawlUrlHash, type CrawlLinkKind } from '@seotools/core'
import { currentAuditOf, type UrlAuditCurrent } from './audit-rules'
import { automaticFileChecks } from './automatic-checks'
import { getDb } from './db'
import { crawlUrlsInEvidence } from './issue-evidence'
import { canRecheck, viewRecheck, type RecheckView } from './recheck'

export interface UrlDetailData {
  automaticCheck: boolean
  crawl: Crawl
  url: CrawlUrl
  issues: CrawlUrlIssue[]
  /**
   * The addresses in the evidence of `issues` that the crawl has a page for, as normalized URLs:
   * the only ones the detail links to its own detail.
   */
  evidenceUrls: ReadonlySet<string>
  /** Pages of the crawl that link here, and what this URL links to: capped, see `hasMore*`. */
  linksIn: { url: string; kind: CrawlLinkKind }[]
  linksOut: { url: string; kind: CrawlLinkKind }[]
  hasMoreIn: boolean
  hasMoreOut: boolean
  priority: boolean
  /**
   * What the analysis concluded about this URL: whether it was audited, what is expected of it and
   * what the crawl saw. `null` for an external URL, or one in a crawl analysed before this existed.
   */
  audit: CrawlUrlAudit | null
  /**
   * What the URL is under the rules in force now, with the exceptions set on it: what its actions
   * start from and show under each choice. Not what the last analysis concluded.
   */
  current: UrlAuditCurrent
  /** Whether the analysis reflects the audit configuration in force. */
  results: AuditResultsState
  /**
   * Rechecking this URL without a crawl. It is kept apart from the crawl, which it never changes.
   */
  recheck: {
    /** A URL of the site that is not a file for crawlers: the only kind that can be rechecked. */
    available: boolean
    /** The latest recheck that finished, read next to the crawl. `null`: none, or the crawl is newer. */
    view: RecheckView | null
    /** It is waiting in a recheck that has not ended. */
    waiting: boolean
    /** The domain has a recheck under way (a domain runs one at a time). */
    busy: boolean
  }
}

/**
 * Everything the detail of a URL shows, as the crawl saw it, or `null` if the crawl does not have
 * that URL. A page linked from every other page (the home) has thousands of links, hence the cap.
 */
export async function loadUrlDetail(input: {
  domainId: string
  /** The host of the domain, to resolve the rules the way an analysis does. */
  host: string
  crawl: Crawl
  urlHash: string
  linkLimit: number
  /**
   * The crawl is not the latest one. Its analysis is never recalculated when the rules change, so
   * it is not "behind" the configuration: it is what it was analysed with.
   */
  historical?: boolean
}): Promise<UrlDetailData | null> {
  const { domainId, host, crawl, urlHash, linkLimit, historical = false } = input
  const db = await getDb()
  const url = await db.crawls.getUrl(crawl.id, urlHash)
  if (!url) return null
  const [issues, audit, config, linksIn, linksOut, priorities, verified, activeRecheck] =
    await Promise.all([
      db.crawls.issuesOf(crawl.id, [urlHash]),
      db.crawls.auditOf(crawl.id, [urlHash]),
      db.audit.config(domainId),
      db.crawls.linkSources(crawl.id, urlHash, { limit: linkLimit + 1 }),
      db.crawls.linkTargets(crawl.id, urlHash, { limit: linkLimit + 1 }),
      db.priorityUrls.list(domainId),
      db.verifications.latestFor(domainId, [urlHash]),
      db.verifications.active(domainId),
    ])
  const waiting = activeRecheck
    ? (await db.verifications.urlsOf(activeRecheck.id)).some(
        (queued) => queued.urlHash === urlHash && queued.state === 'queued',
      )
    : false
  const evidenceUrls = await crawlUrlsInEvidence(
    issues,
    async (address) => (await db.crawls.getUrl(crawl.id, crawlUrlHash(address))) !== null,
  )
  return {
    automaticCheck: (await automaticFileChecks(db.crawls, crawl.id, [url])).has(urlHash),
    crawl,
    url,
    issues,
    evidenceUrls,
    linksIn: linksIn.slice(0, linkLimit),
    linksOut: linksOut.slice(0, linkLimit),
    hasMoreIn: linksIn.length > linkLimit,
    hasMoreOut: linksOut.length > linkLimit,
    priority: priorities.some((p) => p.urlHash === urlHash),
    audit: audit[0] ?? null,
    current: currentAuditOf(config, host, url.url),
    results: historical
      ? auditResultsState(crawl, { version: crawl.auditVersion ?? 0, recomputeError: null })
      : auditResultsState(crawl, config),
    recheck: {
      available: canRecheck(url),
      view: viewRecheck({
        verified: verified[0] ?? null,
        crawl,
        crawledAt: url.fetchedAt,
        crawlIssues: issues.map(({ issue }) => issue),
        configVersion: config.version,
      }),
      waiting,
      busy: activeRecheck !== null,
    },
  }
}
