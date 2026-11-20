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
  if (!open.length && !history?.length) return null
  const t = await getTranslations('Incidents'),
    format = await getFormatter()
  const rows = (items: SiteIncident[]) =>
    items.map((i) => (
      <li
        key={i.id}
        className="grid gap-1 rounded-xl bg-card p-4 text-sm shadow-card ring-1 ring-foreground/10"
      >
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
      {open.length > 0 && (
        <>
          <h2 className="text-base font-medium">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('daily')}</p>
          <ul className="grid gap-2">{rows(open)}</ul>
        </>
      )}
      {history && history.length > 0 && (
        <>
          <h2
            className={
              open.length > 0
                ? 'text-sm font-medium text-muted-foreground'
                : 'text-base font-medium'
            }
          >
            {t('history')}
          </h2>
          <ul className="grid gap-2">{rows(history)}</ul>
        </>
      )}
    </section>
  )
}
