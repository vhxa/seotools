import type { FindingStateRecord } from '@seotools/db'
import { getFormatter, getTranslations } from 'next-intl/server'
import { getDb } from '@/lib/db'
import { dismissalAttribution, type DismissalAcceptance } from '@/lib/dismissal-attribution'

/** A historical dismissal names the recorded decision maker, even after the current decision changes. */
export async function DismissalAttribution({
  acceptance,
  rows,
}: {
  acceptance: DismissalAcceptance
  rows: readonly FindingStateRecord[]
}) {
  const t = await getTranslations('FindingStates')
  const format = await getFormatter()
  const db = await getDb()
  const recorded = await dismissalAttribution(
    acceptance,
    rows,
    async (id) => (await db.users.get(id))?.name ?? null,
  )
  return (
    <div className="grid gap-1">
      <p>
        {t('dismissedBy', {
          name: recorded.name ?? t('formerMember'),
          date: recorded.setAt
            ? format.dateTime(new Date(recorded.setAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              })
            : t('unknownDate'),
        })}
      </p>
      {!recorded.changed ? (
        recorded.note && (
          <p className="break-words whitespace-pre-wrap text-muted-foreground">
            {t('noteLabel', { note: recorded.note })}
          </p>
        )
      ) : (
        <p className="text-muted-foreground">{t('decisionChanged')}</p>
      )}
    </div>
  )
}
