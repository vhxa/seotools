'use server'

import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

export type PairedExamplesResult =
  { kind: 'ok'; examples: { urlHash: string; url: string }[] } | { kind: 'unavailable' }

/**
 * The URLs a crawl's paired check found answering differently, for the details of that crawl. It
 * only reads what the crawl stored: nothing is requested. The crawl id comes from the browser, so it
 * must belong to the domain `requireDomain` resolved.
 */
export async function loadPairedExamplesAction(
  host: string,
  crawlId: unknown,
): Promise<PairedExamplesResult> {
  const { domain } = await requireDomain(host)
  if (typeof crawlId !== 'string') return { kind: 'unavailable' }
  const db = await getDb()
  const crawl = await db.crawls.get(crawlId)
  if (!crawl || crawl.domainId !== domain.id || crawl.pruned || !crawl.pairedSummary) {
    return { kind: 'unavailable' }
  }
  const rows = await Promise.all(
    crawl.pairedSummary.examples.map((hash) => db.crawls.getUrl(crawl.id, hash)),
  )
  return {
    kind: 'ok',
    examples: rows.flatMap((row) => (row ? [{ urlHash: row.urlHash, url: row.url }] : [])),
  }
}
