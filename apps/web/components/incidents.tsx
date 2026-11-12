import { robotsChangeSummary } from '@seotools/core/incidents'
import type { SiteIncident } from '@seotools/db'
import { getFormatter, getTranslations } from 'next-intl/server'
export async function Incidents({
  open,
  history,
}: {
  open: SiteIncident[]
  history?: SiteIncident[]
}) {
  if (!open.length && !history) return null
  const t = await getTranslations('Incidents'),
    format = await getFormatter()
  const rows = (items: SiteIncident[]) =>
    items.map((i) => (
      <li key={i.id} className="grid gap-1 rounded border p-3 text-sm">
        <p className="font-medium">
          {t(`kinds.${i.kind}`)}
          {i.kind === 'certificate' ? ` · ${t(`stages.${i.stage}`)}` : ''}
        </p>
        <p className="break-all">{i.subject}</p>
        <p className="text-muted-foreground">
          {t('since', {
            when: format.dateTime(i.openedAt, { dateStyle: 'medium', timeStyle: 'short' }),
          })}
        </p>
        {i.resolvedAt && (
          <p>
            {t('resolved', {
              when: format.dateTime(i.resolvedAt, { dateStyle: 'medium', timeStyle: 'short' }),
            })}
          </p>
        )}
        {i.kind === 'robots-changed' && (
          <ul className="grid gap-1 text-xs break-all">
            {robotsChangeSummary(i.details).map((row) => (
              <li key={row.key}>
                {t(`summary.${row.key}`)}: {row.value}
              </li>
            ))}
          </ul>
        )}
      </li>
    ))
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-medium">{t('title')}</h2>
      <p className="text-sm text-muted-foreground">{t('daily')}</p>
      {open.length ? (
        <ul className="grid gap-2">{rows(open)}</ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      )}
      {history && (
        <>
          <h3 className="font-medium">{t('history')}</h3>
          <ul className="grid gap-2">{rows(history)}</ul>
        </>
      )}
    </section>
  )
}
