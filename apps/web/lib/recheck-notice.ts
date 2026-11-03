import { getDb } from './db'
import { announceRecheck, type RecheckAnnouncement } from './recheck'

/** What a domain has to say about its rechecks right now: see `announceRecheck`. */
export async function loadRecheckAnnouncement(
  domainId: string,
): Promise<RecheckAnnouncement | null> {
  const db = await getDb()
  const [active, [latest]] = await Promise.all([
    db.verifications.active(domainId),
    db.verifications.list(domainId, { limit: 1 }),
  ])
  return announceRecheck({ active, latest: latest ?? null, now: Date.now() })
}
