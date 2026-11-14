import type { FindingStateRecord } from '@seotools/db'
import { auditResultsState, type AuditResultsState } from '@seotools/core/crawl/audit'
import type {
  Crawl,
  CrawlUrl,
  CrawlUrlRender,
  CrawlUrlAudit,
  CrawlUrlAcceptedIssue,
  CrawlUrlIssue,
} from '@seotools/db'
import { crawlIdentityHash, normalizeCrawlUrl } from '@seotools/core'
import { currentAuditOf, type UrlAuditCurrent } from './audit-rules'
import { automaticFileChecks } from './automatic-checks'
import { getDb } from './db'
import { crawlUrlsInEvidence } from './issue-evidence'
import {
  canRecheck,
  previewSourceOf,
  viewRecheck,
  type RecheckPreviewSource,
  type RecheckView,
} from './recheck'
import { loadUrlLinks, type UrlLinksPage } from './url-links'
import { RENDER_DETAIL_SAMPLE, renderViewOf, type RenderView } from './url-rendering'

/** At most this many findings of other URLs are named in the detail of the URL that accepts them. */
const MAX_ACCEPTED_ELSEWHERE = 10

export interface UrlDetailData {
  findingStates?: FindingStateRecord[]
  render: CrawlUrlRender | null
  automaticCheck: boolean
  crawl: Crawl
  url: CrawlUrl
  issues: CrawlUrlIssue[]
  /** What the crawl saw of this URL and a rule accepts: not pending, and not fixed either. */
  accepted: CrawlUrlAcceptedIssue[]
  /** The findings of other URLs that what is declared of this one accepts. */
  acceptedElsewhere: {
    total: number
    findings: { urlHash: string; url: string; issue: string }[]
  }
  /**
   * The addresses in the evidence of `issues` that the crawl has a page for, as normalized URLs:
   * the only ones the detail links to its own detail.
   */
  evidenceUrls: ReadonlyMap<string, string>
  /**
   * The first page of the links that arrive at this URL and of those that leave it, navigation
   * links as a list opens on. The rest is read a page at a time (`loadLinksAction`).
   */
  links: { in: UrlLinksPage; out: UrlLinksPage }
  priority: boolean
  /** What the crawl's JavaScript rendering observed of this URL, or why it did not. */
  rendering: {
    view: RenderView
    /** Complete observations only: the anchors that exist only after rendering, and the served ones. */
    links: { served: number; total: number; items: { url: string; urlHash: string }[] } | null
    /** The addresses of the render that are pages of the crawl, to link to their detail. */
    known: ReadonlyMap<string, string>
  }
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
    /**
     * What the newest recheck, if later than this crawl, says of the share preview. `null` for an
     * older crawl, no such recheck, or one that says nothing of it.
     */
    preview: RecheckPreviewSource | null
    /** It is waiting in a recheck that has not ended. */
    waiting: boolean
    /** The domain has a recheck under way (a domain runs one at a time). */
    busy: boolean
    /** The domain is archived: nothing can be rechecked until it is restored. */
    archived: boolean
  }
}

/**
 * Everything the detail of a URL shows, as the crawl saw it, or `null` if the crawl does not have
 * that URL. A page linked from every other page (the home) has thousands of links, so only a
 * page of them is read here.
 */
export async function loadUrlDetail(input: {
  domainId: string
  /** The host of the domain, to resolve the rules the way an analysis does. */
  host: string
  crawl: Crawl
  urlHash: string
  /**
   * The crawl is not the latest one. Its analysis is never recalculated when the rules change, so
   * it is not "behind" the configuration: it is what it was analysed with.
   */
  historical?: boolean
}): Promise<UrlDetailData | null> {
  const { domainId, host, crawl, urlHash, historical = false } = input
  const db = await getDb()
  const url = await db.crawls.getUrl(crawl.id, urlHash)
  if (!url) return null
  const [
    render,
    issues,
    accepted,
    acceptedElsewhere,
    audit,
    config,
    linksIn,
    linksOut,
    priorities,
    verified,
    finishedPreview,
    activeRecheck,
    owner,
  ] = await Promise.all([
    db.crawls.renderOf(crawl.id, urlHash),
    db.crawls.issuesOf(crawl.id, [urlHash]),
    db.crawls.acceptedOf(crawl.id, [urlHash]),
    db.crawls.acceptedBecauseOf(crawl.id, urlHash, { limit: MAX_ACCEPTED_ELSEWHERE }),
    db.crawls.auditOf(crawl.id, [urlHash]),
    db.audit.config(domainId),
    loadUrlLinks(db.crawls, { crawlId: crawl.id, urlHash, direction: 'in' }),
    loadUrlLinks(db.crawls, { crawlId: crawl.id, urlHash, direction: 'out' }),
    db.priorityUrls.list(domainId),
    db.verifications.latestFor(domainId, [urlHash]),
    db.verifications.latestFinishedFor(domainId, urlHash),
    db.verifications.active(domainId),
    db.domains.get(domainId),
  ])
  const waiting = activeRecheck
    ? (await db.verifications.urlsOf(activeRecheck.id)).some(
        (queued) => queued.urlHash === urlHash && queued.state === 'queued',
      )
    : false
  const rendering = renderViewOf({ crawl, url, render })
  const renderedLinks =
    rendering.kind === 'complete'
      ? await db.crawls.renderedLinksOf(crawl.id, urlHash, RENDER_DETAIL_SAMPLE)
      : null
  const redirectKnown = new Map<string, string>()
  if (rendering.kind === 'redirect') {
    const target = normalizeCrawlUrl(rendering.target)
    const hash = target ? crawlIdentityHash(target, crawl, host) : null
    if (target && hash && (await db.crawls.getUrl(crawl.id, hash))) redirectKnown.set(target, hash)
  }
  const evidenceUrls = await crawlUrlsInEvidence(
    [...issues, ...accepted],
    async (address) =>
      (await db.crawls.getUrl(crawl.id, crawlIdentityHash(address, crawl, host))) !== null,
    undefined,
    { ...crawl, host: host },
  )
  const view = viewRecheck({
    verified: verified[0] ?? null,
    crawl,
    crawledAt: url.fetchedAt,
    crawlIssues: issues.map(({ issue }) => issue),
    configVersion: config.version,
  })
  return {
    findingStates: config.findingStates,
    automaticCheck: (await automaticFileChecks(db.crawls, crawl.id, [url])).has(urlHash),
    crawl,
    url,
    render,
    issues,
    accepted,
    acceptedElsewhere,
    evidenceUrls,
    links: { in: linksIn, out: linksOut },
    priority: priorities.some((p) => p.urlHash === urlHash),
    rendering: { view: rendering, links: renderedLinks, known: redirectKnown },
    audit: audit[0] ?? null,
    current: currentAuditOf(config, host, url.url),
    results: historical
      ? auditResultsState(crawl, { version: crawl.auditVersion ?? 0, recomputeError: null })
      : auditResultsState(crawl, config),
    recheck: {
      available: canRecheck(url),
      view,
      preview: previewSourceOf({
        view: viewRecheck({
          verified: finishedPreview,
          crawl,
          crawledAt: crawl.finishedAt ?? url.fetchedAt,
          crawlIssues: [],
          configVersion: config.version,
        }),
        historical,
      }),
      waiting,
      busy: activeRecheck !== null,
      archived: owner?.archivedAt != null,
    },
  }
}
