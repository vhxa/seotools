import { auditScopeKey } from '@seotools/core'
import type { Database } from '@seotools/db'

/** Stable stored audit output, including all URLs rather than only the scenario's target. */
export async function htmlBaseline(db: Database, crawlId: string) {
  const crawl = (await db.crawls.get(crawlId))!
  const urls = await db.crawls.listUrls({ crawlId, view: 'all', limit: 10000, offset: 0 })
  const hashes = urls.map((url) => url.urlHash)
  const rules = crawl.auditSnapshot?.rules ?? []
  const stable = (value: unknown) => {
    let json = JSON.stringify(value)
    for (const [index, rule] of rules.entries()) json = json.replaceAll(rule.id, `rule-${index}`)
    return JSON.parse(
      json.replaceAll(crawlId, 'crawl').replaceAll(crawl.domainId, 'domain'),
    ) as unknown
  }
  const sort = <T>(rows: T[]) =>
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return stable({
    issues: sort(await db.crawls.issuesOf(crawlId, hashes)),
    accepted: sort(await db.crawls.acceptedOf(crawlId, hashes)),
    audit: sort(await db.crawls.auditOf(crawlId, hashes)),
    counts: await db.crawls.countUrls(crawlId),
    pagesByWorstIssue: crawl.pagesByWorstIssue,
    pagesWithType: crawl.pagesWithType,
    pagesAudit: crawl.pagesAudit,
    snapshot: crawl.auditSnapshot,
    scope: auditScopeKey(crawl.auditSnapshot!),
  })
}
