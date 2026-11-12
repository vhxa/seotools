import type { FindingStateRecord } from '@seotools/db'
import { getFormatter, getTranslations } from 'next-intl/server'
import { getDb } from '@/lib/db'
import { IssueLabel } from '@/components/pages/issue-mark'
import { FindingStateActions } from './finding-state-actions'

/** Human decisions stay separate from rule acceptances, including the decision maker and note. */
export async function FindingStatesList({
  host,
  rows: all,
  compact = false,
  limit,
}: {
  host: string
  rows: FindingStateRecord[]
  compact?: boolean
  /** Shows the newest ones only; the rest are in Settings → Audit → Dismissed. */
  limit?: number
}) {
  const sorted = [...all].sort((a, b) => b.setAt.getTime() - a.setAt.getTime())
  const rows = limit === undefined ? sorted : sorted.slice(0, limit)
  const t = await getTranslations('FindingStates')
  const format = await getFormatter()
  const db = await getDb()
  const domain = await db.domains.findByHost(host)
  const crawl = domain ? await db.crawls.latestWithResults(domain.id, 'full') : null
  const hashes = [...new Set(rows.flatMap((r) => (r.urlHash ? [r.urlHash] : [])))]
  const addresses = new Map<string, string>()
  if (crawl)
    for (let n = 0; n < hashes.length; n += 200)
      for (const url of await db.crawls.urlsOf(crawl.id, hashes.slice(n, n + 200)))
        addresses.set(url.urlHash, url.url)
  const people = new Map(
    await Promise.all(
      [...new Set(rows.flatMap((r) => (r.setBy ? [r.setBy] : [])))].map(
        async (id) => [id, (await db.users.get(id))?.name ?? t('deletedUser')] as const,
      ),
    ),
  )
  return (
    <section className="grid gap-3">
      {!compact && <h2 className="text-lg font-medium">{t('title')}</h2>}
      {!rows.length && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      <ul className="divide-y">
        {rows.map((row) => (
          <li key={row.id} className="grid gap-1 py-3 text-sm">
            {!compact && <IssueLabel issue={row.issue} />}
            {!compact && (
              <span>
                {row.urlHash ? (
                  <a className="underline" href={`/domains/${host}/urls/${row.urlHash}`}>
                    {addresses.get(row.urlHash) ?? row.urlHash}
                  </a>
                ) : (
                  t('domain')
                )}
              </span>
            )}
            <span>{t(row.state)}</span>
            <p>
              {t(row.state === 'dismissed' ? 'dismissedBy' : 'by', {
                name: row.setBy ? (people.get(row.setBy) ?? t('deletedUser')) : t('deletedUser'),
                date: format.dateTime(row.setAt, { dateStyle: 'medium', timeStyle: 'short' }),
              })}
            </p>
            {/* A member wrote it: rendered as text, never HTML. */}
            {row.note && (
              <p className="break-words whitespace-pre-wrap text-muted-foreground">
                {t('noteLabel', { note: row.note })}
              </p>
            )}
            {!compact && (
              <FindingStateActions
                host={host}
                issue={row.issue}
                hashes={[row.urlHash ?? '*']}
                restoreOnly
              />
            )}
          </li>
        ))}
      </ul>
      {sorted.length > rows.length && (
        <p className="text-sm text-muted-foreground">
          <a className="underline" href={`/domains/${host}/settings/audit?tab=dismissed`}>
            {t('more', { count: sorted.length - rows.length })}
          </a>
        </p>
      )}
    </section>
  )
}
