import type { Database } from '@seotools/db'

/**
 * A short text that changes whenever what a domain's pages show changes without the user doing
 * anything: a crawl or a recheck starts or ends, an analysis is saved, the rules move to a new
 * version. The browser keeps the pages it has visited for a while (`staleTimes` in `next.config.ts`)
 * and asks for this now and then: when it differs, the cached pages are dropped and the current one
 * is drawn again. What the user does themselves reaches the pages through the actions'
 * `revalidatePath`. Not the progress of a running crawl: the pages that show it refresh themselves.
 */
export async function dataStamp(db: Database, domainId: string): Promise<string> {
  const [crawls, rechecks, config] = await Promise.all([
    db.crawls.list(domainId, { limit: 3 }),
    db.verifications.list(domainId, { limit: 1 }),
    db.audit.config(domainId),
  ])
  return JSON.stringify([
    crawls.map((crawl) => [
      crawl.id,
      crawl.status,
      crawl.finishedAt?.getTime() ?? null,
      crawl.auditVersion,
      crawl.issueCatalog,
    ]),
    rechecks.map((recheck) => [recheck.id, recheck.status, recheck.finishedAt?.getTime() ?? null]),
    config.version,
    config.recomputeError?.version ?? null,
  ])
}
