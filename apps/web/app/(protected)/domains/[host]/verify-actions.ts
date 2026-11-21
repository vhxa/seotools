'use server'

import { MAX_VERIFICATION_URLS, crawlIdentityHash } from '@seotools/core'
import type { NewVerificationUrl } from '@seotools/db'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { getDb } from '@/lib/db'
import { selectPair } from '@/lib/crawl-history'
import { canRecheck, parseRecheckUrls } from '@/lib/recheck'
import { archivedMessage, requireDomainEditor } from '@/lib/workspace'

export interface RecheckState {
  error?: string
  /** Set when the recheck was queued: how many URLs it takes, and how many were left out. */
  started?: { id: string; count: number; skipped: number }
}

/** Every page that shows a recheck, its progress or its result. */
function revalidateRechecks(host: string) {
  revalidatePath(`/domains/${host}`, 'layout')
}

/**
 * Asks the worker to request some URLs of the domain again and check what each one answers, without
 * a crawl. Nothing is requested here: this only validates and queues, and the worker does the rest
 * with the domain's own crawl settings.
 *
 * What comes from the client is checked here, not trusted: the list itself, that every URL is of
 * this domain, that the last full crawl has it (a recheck is compared with that crawl), and that it
 * is not a file for crawlers. A list with too many URLs is refused whole.
 */
export async function recheckUrlsAction(host: string, urls: unknown): Promise<RecheckState> {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await getTranslations('Verification.errors')

  const parsed = parseRecheckUrls(urls, domain.host)
  if (!parsed.ok) {
    return {
      error:
        parsed.error === 'tooMany'
          ? t('tooMany', { max: MAX_VERIFICATION_URLS })
          : t(parsed.error, { host: domain.host }),
    }
  }

  const db = await getDb()
  const crawl = await db.crawls.latestWithResults(domain.id, 'full')
  if (!crawl) return { error: t('noCrawl') }

  const accepted: NewVerificationUrl[] = []
  for (const url of parsed.urls) {
    const urlHash = crawlIdentityHash(url, crawl, domain.host)
    const stored = await db.crawls.getUrl(crawl.id, urlHash)
    if (stored && canRecheck(stored) && !accepted.some((item) => item.urlHash === urlHash))
      accepted.push({ url: stored.url, urlHash, source: stored.source })
  }
  if (accepted.length === 0) return { error: t('notInCrawl') }

  const verification = await db.verifications.start({
    domainId: domain.id,
    baseCrawlId: crawl.id,
    urls: accepted,
  })
  if (!verification) return { error: t('alreadyRunning') }

  revalidateRechecks(host)
  return {
    started: {
      id: verification.id,
      count: accepted.length,
      skipped: parsed.urls.length - accepted.length,
    },
  }
}

const HASH = /^[0-9a-f]{32}$/

/**
 * "Check now" on a comparison: requests again URLs that one crawl of the pair has and the other
 * lacks, to see what they answer today. The recheck is based on the crawl that has them (for "not
 * seen", the earlier one), which is the only one that knows them. What it answers is shown next to
 * the stored reason and never changes it.
 *
 * Everything from the client is checked here: both crawls must be a pair of this domain, and each
 * URL must be one the chosen crawl has and that a recheck may request.
 */
export async function checkComparedUrlsAction(
  host: string,
  input: { from: unknown; to: unknown; side: unknown; urlHashes: unknown },
): Promise<RecheckState> {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await getTranslations('Verification.errors')

  const { from, to, side, urlHashes } = input ?? {}
  if (
    typeof from !== 'string' ||
    typeof to !== 'string' ||
    (side !== 'base' && side !== 'target') ||
    !Array.isArray(urlHashes)
  ) {
    return { error: t('none') }
  }
  const hashes = [
    ...new Set(urlHashes.filter((hash): hash is string => typeof hash === 'string')),
  ].filter((hash) => HASH.test(hash))
  if (hashes.length === 0) return { error: t('none') }
  if (hashes.length > MAX_VERIFICATION_URLS) {
    return { error: t('tooMany', { max: MAX_VERIFICATION_URLS }) }
  }

  const db = await getDb()
  const pair = await selectPair(db.crawls, domain.id, from, to)
  if (pair.kind !== 'pair') return { error: t('notInCrawl') }
  const crawl = side === 'base' ? pair.base : pair.target
  if (crawl.pruned) return { error: t('notInCrawl') }

  const accepted: NewVerificationUrl[] = []
  for (const urlHash of hashes) {
    const stored = await db.crawls.getUrl(crawl.id, urlHash)
    if (stored && canRecheck(stored))
      accepted.push({ url: stored.url, urlHash, source: stored.source })
  }
  if (accepted.length === 0) return { error: t('notInCrawl') }

  const verification = await db.verifications.start({
    domainId: domain.id,
    baseCrawlId: crawl.id,
    urls: accepted,
  })
  if (!verification) return { error: t('alreadyRunning') }

  revalidateRechecks(host)
  return {
    started: {
      id: verification.id,
      count: accepted.length,
      skipped: hashes.length - accepted.length,
    },
  }
}

/** Stops a recheck that has not ended. What it already rechecked stays. */
export async function cancelRecheckAction(host: string, verificationId: string) {
  const { domain } = await requireDomainEditor(host)
  const db = await getDb()
  // The id comes from the client: it has to be a recheck of the domain being acted on.
  if (typeof verificationId !== 'string') return
  const verification = await db.verifications.get(verificationId)
  if (verification?.domainId === domain.id) await db.verifications.cancel(verification.id)
  revalidateRechecks(host)
}
