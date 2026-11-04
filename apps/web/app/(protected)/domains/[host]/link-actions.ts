'use server'

import { getDb } from '@/lib/db'
import { answerLinksRequest, type LinksResult } from '@/lib/link-request'
import { requireDomain } from '@/lib/workspace'

/**
 * A page of the links of one URL of a crawl, for the lists in the detail of a URL. It only reads
 * what the crawl stored: nothing is requested. Everything that comes from the browser is a claim,
 * which `answerLinksRequest` checks against the domain `requireDomain` resolved.
 */
export async function loadLinksAction(host: string, input: unknown): Promise<LinksResult> {
  const { domain } = await requireDomain(host)
  return answerLinksRequest((await getDb()).crawls, domain.id, input)
}
