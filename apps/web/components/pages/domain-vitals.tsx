import { loadVitalsKey } from '@seotools/core'
import { vitalFailure } from '@seotools/core/vitals-state'
import type { Crawl } from '@seotools/db'
import { getFormatter, getTranslations } from 'next-intl/server'
import { getDb } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { vitalsPoints } from '@/lib/vitals'
import { VitalsValues } from './vitals-values'
import { VitalsTrend } from './vitals-trend'
export async function DomainVitals({ crawls, domainId }: { crawls: Crawl[]; domainId: string }) {
  const t = await getTranslations('Vitals')
  const key = await loadVitalsKey(await getSettings())
  if (!key) return null
  const db = await getDb()
  if (!(await db.crawls.settings(domainId)).collectVitals) return null
  const format = await getFormatter()
  const latest = await db.vitals.latestCrawl(domainId)
  if (!latest) return null
  const candidates = crawls.some((crawl) => crawl.id === latest.id) ? crawls : [latest, ...crawls]
  const history = await Promise.all(
    candidates
      .filter(
        (crawl) =>
          crawl.type === 'full' && (crawl.status === 'completed' || crawl.status === 'incomplete'),
      )
      .map(async (crawl) => ({ crawl, rows: await db.vitals.origins(crawl.id) })),
  )
  const selected = history.find((entry) => entry.crawl.id === latest.id)
  if (!selected) return null
  const rows = selected.rows
  const state = rows.find((row) => row.formFactor === 'all')
  return (
    <section className="grid gap-4 rounded-lg border p-4">
      <h2 className="text-lg font-medium">{t('title')}</h2>
      <p>
        {t('crawlSource', {
          ref: selected.crawl.ref ?? '—',
          date: format.dateTime(selected.crawl.finishedAt ?? selected.crawl.createdAt),
        })}
      </p>
      {state?.status === 'failed' && (
        <p>{t('failed', { reason: t(`results.${vitalFailure(state.error)}`) })}</p>
      )}
      {(['PHONE', 'DESKTOP'] as const).map((factor) => (
        <div key={factor}>
          <h3>{t(factor)}</h3>
          <VitalsValues metrics={rows.find((row) => row.formFactor === factor)} />
        </div>
      ))}
      <VitalsTrend points={vitalsPoints(history)} />
    </section>
  )
}
