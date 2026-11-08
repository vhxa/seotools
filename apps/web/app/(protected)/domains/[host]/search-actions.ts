'use server'

import { getDb } from '@/lib/db'
import { searchUrls, type UrlSearchHit } from '@/lib/url-search'
import { requireDomain } from '@/lib/workspace'

/**
 * The URLs of a domain that the header's search offers for a text. It only reads what the latest
 * full crawl stored: nothing is requested. The domain is the one `requireDomain` resolved, never
 * anything the browser claims.
 */
export async function searchUrlsAction(host: string, text: unknown): Promise<UrlSearchHit[]> {
  const { domain } = await requireDomain(host)
  return searchUrls((await getDb()).crawls, domain.id, text)
}
