import { loadVitalsKey } from '@seotools/core'
import { vitalFailure } from '@seotools/core/vitals-state'
import type { Crawl } from '@seotools/db'
import { getTranslations } from 'next-intl/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
    <section aria-labelledby="vitals">
      <Card>
        <CardHeader>
          <CardTitle id="vitals">{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          {state?.status === 'failed' && (
            <p className="text-sm text-destructive">
              {t('failed', { reason: t(`results.${vitalFailure(state.error)}`) })}
            </p>
          )}
          {(['PHONE', 'DESKTOP'] as const).map((factor) => (
            <div key={factor} className="grid gap-3">
              <h3 className="text-sm text-muted-foreground">{t(factor)}</h3>
              <VitalsValues metrics={rows.find((row) => row.formFactor === factor)} />
            </div>
          ))}
          <VitalsTrend points={vitalsPoints(history)} />
        </CardContent>
      </Card>
    </section>
  )
}
