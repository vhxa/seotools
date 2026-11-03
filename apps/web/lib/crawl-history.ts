import { byAge, isBrowsableStatus, orderPair } from '@seotools/core/crawl/compare'
import type { Crawl, CrawlRepository } from '@seotools/db'

/** How many of the domain's newest full crawls the history lists. Older ones are still reachable by id. */
export const HISTORY_CRAWLS = 100

/** What choosing a crawl needs of the database. */
export type CrawlSource = Pick<CrawlRepository, 'getInDomain' | 'latestWithResults' | 'list'>

/**
 * The domain's full crawls that finished with results, newest first. A crawl whose results were
 * pruned is in the list: it has its totals and nothing else, and says so wherever it is shown.
 * Failed and cancelled crawls have only partial results and are never part of the history.
 */
export async function browsableCrawls(crawls: CrawlSource, domainId: string): Promise<Crawl[]> {
  const found = await crawls.list(domainId, { type: 'full', limit: HISTORY_CRAWLS })
  return found.filter((crawl) => isBrowsableStatus(crawl.status))
}

/**
 * A crawl asked for by id in an address. It must be a full crawl, with results, of this domain: the
 * query is made with the domain, so another domain's crawl is the same as one that does not exist.
 */
export async function findCrawl(
  crawls: CrawlSource,
  domainId: string,
  id: string,
): Promise<Crawl | null> {
  const crawl = await crawls.getInDomain(domainId, id)
  return crawl && crawl.type === 'full' && isBrowsableStatus(crawl.status) ? crawl : null
}

/** Whether the per-URL results of a crawl are still stored (`retained`) or only its totals remain. */
export const coverageOf = (crawl: Pick<Crawl, 'pruned'>) =>
  crawl.pruned ? ('pruned' as const) : ('retained' as const)

export type CrawlSelection =
  /** The domain has no crawl with results. */
  | { kind: 'empty' }
  /** The address names a crawl that is not one of the domain's browsable ones: a 404. */
  | { kind: 'missing' }
  | {
      kind: 'selected'
      crawl: Crawl
      /** The newest crawl that still has its results, which is what an address without one shows. */
      latest: Crawl | null
      /** The crawl is not the latest one. */
      historical: boolean
    }

/** The crawl to browse: the one in the address if there is one, and the latest otherwise. */
export async function selectCrawl(
  crawls: CrawlSource,
  domainId: string,
  requested: string | null,
): Promise<CrawlSelection> {
  const latest = await crawls.latestWithResults(domainId, 'full')
  if (requested === null) {
    return latest
      ? { kind: 'selected', crawl: latest, latest, historical: false }
      : { kind: 'empty' }
  }
  const crawl = await findCrawl(crawls, domainId, requested)
  if (!crawl) return { kind: 'missing' }
  return { kind: 'selected', crawl, latest, historical: crawl.id !== latest?.id }
}

export type PairSelection =
  /** There are not two crawls to compare. */
  | { kind: 'empty' }
  | { kind: 'missing' }
  /** The same crawl was chosen twice. */
  | { kind: 'same'; crawl: Crawl; crawls: Crawl[] }
  | {
      kind: 'pair'
      /** The earlier crawl and the later one, whichever order the address gave them in. */
      base: Crawl
      target: Crawl
      /** Every browsable crawl of the domain, oldest first, to choose from and to read history from. */
      crawls: Crawl[]
    }

/**
 * The two crawls to compare. Left out, the later one is the newest and the earlier one is the
 * retained crawl right before it (or the one before it if none of those has its results any more).
 */
export async function selectPair(
  crawls: CrawlSource,
  domainId: string,
  from: string | null,
  to: string | null,
): Promise<PairSelection> {
  const newestFirst = await browsableCrawls(crawls, domainId)
  // The history is capped, but a crawl asked for by id is always part of it.
  const withHistory = (...chosen: Crawl[]) =>
    [...new Map([...newestFirst, ...chosen].map((c) => [c.id, c])).values()].sort(byAge)

  const target = to === null ? newestFirst[0] : await findCrawl(crawls, domainId, to)
  if (to !== null && !target) return { kind: 'missing' }
  if (!target) return { kind: 'empty' }

  let base: Crawl | null | undefined
  if (from !== null) {
    base = await findCrawl(crawls, domainId, from)
    if (!base) return { kind: 'missing' }
  } else {
    const before = newestFirst.filter((crawl) => byAge(crawl, target) < 0)
    base = before.find((crawl) => !crawl.pruned) ?? before[0]
    if (!base) return { kind: 'empty' }
  }
  if (base.id === target.id) return { kind: 'same', crawl: base, crawls: withHistory(base) }
  return { kind: 'pair', ...orderPair(base, target), crawls: withHistory(base, target) }
}
