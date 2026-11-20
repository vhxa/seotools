'use server'

import { crawlActivity, type CrawlActivity } from '@/lib/crawl-activity'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

/**
 * What the domain's crawling is doing, for the sidebar's button to follow. It only reads; the
 * domain is the one `requireDomain` resolved, never anything the browser claims.
 */
export async function crawlActivityAction(host: string): Promise<CrawlActivity> {
  const { domain } = await requireDomain(host)
  return crawlActivity(await getDb(), domain.id)
}
