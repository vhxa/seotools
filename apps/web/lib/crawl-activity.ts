import type { Database } from '@seotools/db'

/**
 * What a domain's crawling is doing right now, for the buttons and the overview.
 * - `starting`: a crawl is waiting for the worker, or has not counted a URL yet.
 * - `crawling`: URLs are being requested; `done` of `total` known so far (the total grows while the
 *   crawl finds more).
 * - `processing`: every URL has been requested and the crawl is finishing (the links it points at,
 *   the files) or the finished crawl is being checked for issues and saved. The page counts stand
 *   at 100% for all of it, which is why it is told apart.
 */
export type CrawlState =
  | { kind: 'idle' }
  | { kind: 'starting'; crawlId: string }
  | { kind: 'crawling'; crawlId: string; done: number; total: number }
  | { kind: 'processing'; crawlId: string }

/**
 * A state and when it was read. Answers reach the browser out of order (the page that a click
 * renders can arrive after a later poll), so the browser keeps the one read last: `newest`.
 */
export interface CrawlActivity {
  state: CrawlState
  /** Milliseconds since the epoch, taken before the database was read. */
  at: number
}

/** Dispatched on `window` when a page changed what the crawl is doing (a cancel), so the sidebar's button asks now. */
export const CRAWL_CHANGED_EVENT = 'seotools:crawl-changed'

export const IDLE: CrawlActivity = { state: { kind: 'idle' }, at: 0 }

/**
 * The reading to keep: the later one, and the same object when nothing changed (no re-render).
 * Within one crawl the button never goes back to "starting" once it has shown figures: a reading
 * that says so is one of the first moments of that crawl (or a count not saved yet), arriving late.
 */
export function newest(current: CrawlActivity, incoming: CrawlActivity): CrawlActivity {
  if (incoming.at < current.at) return current
  const before = current.state
  const after = incoming.state
  if (
    after.kind === 'starting' &&
    (before.kind === 'crawling' || before.kind === 'processing') &&
    before.crawlId === after.crawlId
  )
    return current
  return JSON.stringify(after) === JSON.stringify(before) ? current : incoming
}

/**
 * Reads it from the active crawl and, once that has ended, from the job that still analyses it: the
 * crawl is no longer active then, but its job only completes after the analysis is saved.
 */
export async function crawlActivity(db: Database, domainId: string): Promise<CrawlActivity> {
  const at = Date.now()
  return { state: await readState(db, domainId), at }
}

async function readState(db: Database, domainId: string): Promise<CrawlState> {
  const active = await db.crawls.active(domainId)
  if (active) {
    if (active.status === 'pending' || active.urlsCount === 0)
      return { kind: 'starting', crawlId: active.id }
    return active.urlsDoneCount >= active.urlsCount
      ? { kind: 'processing', crawlId: active.id }
      : {
          kind: 'crawling',
          crawlId: active.id,
          done: active.urlsDoneCount,
          total: active.urlsCount,
        }
  }
  const [last] = await db.crawls.list(domainId, { type: 'full', limit: 1 })
  if (last && (last.status === 'completed' || last.status === 'incomplete')) {
    const job = await db.jobs.get(last.jobId)
    if (job && (job.status === 'pending' || job.status === 'running'))
      return { kind: 'processing', crawlId: last.id }
  }
  return { kind: 'idle' }
}
