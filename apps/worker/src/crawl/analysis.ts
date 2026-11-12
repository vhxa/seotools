import {
  EMPTY_AUDIT_SNAPSHOT,
  ISSUE_CATALOG_VERSION,
  PAGE_ISSUES,
  auditSnapshotOf,
  isSecondaryFinding,
  worstIssueType,
  type AuditSnapshot,
  type PagesAudit,
  type PagesByWorstIssue,
  type PagesWithType,
} from '@seotools/core'
import type {
  Crawl,
  CrawlUrlAcceptedIssue,
  CrawlUrlAudit,
  CrawlUrlIssue,
  Database,
} from '@seotools/db'
import { conditionStatesOf } from './conditions'
import { detectFindings } from './issue-checks'
import { unobservedIssues } from './observed-inputs'
import { loadSite } from './site-audit'

export interface CrawlAnalysis {
  /** Pages of the crawl, audited or not. */
  pages: number
  /** Over the audited pages. */
  pagesByWorstIssue: PagesByWorstIssue
  pagesWithType: PagesWithType
  audit: PagesAudit
  /**
   * `false` when a later configuration got there first, or the results were pruned meanwhile: this
   * analysis was dropped and nothing was written.
   */
  saved: boolean
}

/** The audit configuration of a domain as it is now, in one consistent read. */
export async function currentAuditConfig(db: Database, domainId: string): Promise<AuditSnapshot> {
  const { version, rules, languages, thresholds, findingStates } = await db.audit.config(domainId)
  return auditSnapshotOf(version, rules, languages, thresholds, findingStates)
}

/**
 * The configuration a crawl was analysed with, to analyse it again exactly as before. A crawl
 * analysed before configuration existed was analysed without rules.
 */
export const recordedAuditConfig = (crawl: Pick<Crawl, 'auditSnapshot'>): AuditSnapshot =>
  crawl.auditSnapshot ?? EMPTY_AUDIT_SNAPSHOT

/**
 * Checks every URL of a crawl against `PAGE_ISSUES` under an audit configuration, and stores what it
 * finds, replacing any earlier analysis. It reads only what the crawl stored: no request is made.
 * Safe to repeat, e.g. after the list of issues or the configuration changes. Pages parsed before a
 * check existed have nothing for it to look at, so only a new crawl makes the result complete.
 *
 * The whole analysis uses `config` as it is given, so a change made meanwhile cannot reach half of
 * it; whoever changed it has asked for another one.
 */
export async function analyseCrawl(
  db: Database,
  crawlId: string,
  given: AuditSnapshot,
): Promise<CrawlAnalysis> {
  const crawl = await db.crawls.get(crawlId)
  if (!crawl) throw new Error(`Crawl ${crawlId} not found`)

  // What the crawl could not observe is about the crawl, not the configuration: it is worked out
  // again each time, never carried over from the snapshot that came with it.
  const { unobserved: _recorded, ...config } = given
  const site = await loadSite(db, crawl, config)
  const issues: CrawlUrlIssue[] = []
  const acceptedIssues: CrawlUrlAcceptedIssue[] = []
  const urls: CrawlUrlAudit[] = []
  const pagesByWorstIssue: PagesByWorstIssue = { issue: 0, warning: 0, opportunity: 0 }
  const pagesWithType: PagesWithType = { issue: 0, warning: 0, opportunity: 0 }
  const audit: PagesAudit = {
    audited: 0,
    excluded: 0,
    indexable: 0,
    notIndexable: 0,
    unknownIndexability: 0,
  }
  for (const url of site.urls) {
    // Nothing for a URL left out: it has none of its own, and the other URLs were checked above it.
    const { found, accepted } = detectFindings(url, site)
    for (const { issue, details, evidence, by, acceptance } of accepted) {
      acceptedIssues.push({
        urlHash: url.url.urlHash,
        issue,
        acceptedBy: by.url.urlHash,
        acceptance,
        ...(details ? { details } : {}),
        ...(evidence ? { evidence } : {}),
      })
    }
    for (const { issue, details, evidence } of found) {
      issues.push({
        urlHash: url.url.urlHash,
        issue,
        ...(details ? { details } : {}),
        ...(evidence ? { evidence } : {}),
      })
    }
    if (!url.internal) continue
    urls.push({
      urlHash: url.url.urlHash,
      participation: url.participation,
      participationRule: url.participationRule?.id ?? null,
      intent: url.intent,
      intentRule: url.intentRule?.id ?? null,
      conditions: conditionStatesOf(url, site),
      indexability: url.indexability.state,
      blockers: url.indexability.blockers,
    })
    // A page is HTML that answered 2xx: a page that fails is an error, counted with the errors.
    if (!url.contentPage) continue

    // Indexability is a fact about the page: it counts whether or not the page is audited.
    if (url.indexability.state === 'indexable') audit.indexable++
    else if (url.indexability.state === 'not-indexable') audit.notIndexable++
    else audit.unknownIndexability++

    if (url.excluded) {
      audit.excluded++
      continue
    }
    audit.audited++
    // Secondary findings (search-result matters on a page that cannot be indexed) are listed, not counted.
    const counted = found.filter(
      (finding) => !isSecondaryFinding(finding.issue, url.indexability.state),
    )
    const worst = worstIssueType(counted.map((finding) => finding.issue))
    if (worst) pagesByWorstIssue[worst]++
    for (const type of new Set(counted.map((finding) => PAGE_ISSUES[finding.issue].type))) {
      pagesWithType[type]++
    }
  }
  const unobserved = unobservedIssues(
    site.urls.flatMap((url) => (url.internal && url.facts ? [url.facts] : [])),
    (await db.vitals.origins(crawlId)).some(
      (row) => row.formFactor === 'all' && row.status === 'collected',
    ),
  )
  const saved = await db.crawls.saveAnalysis({
    crawlId,
    issues,
    accepted: acceptedIssues,
    pages: pagesByWorstIssue,
    withType: pagesWithType,
    catalog: ISSUE_CATALOG_VERSION,
    audit: {
      snapshot: { ...config, ...(unobserved.length > 0 ? { unobserved } : {}) },
      pages: audit,
      urls,
    },
  })
  return {
    pages: audit.audited + audit.excluded,
    pagesByWorstIssue,
    pagesWithType,
    audit,
    saved,
  }
}
