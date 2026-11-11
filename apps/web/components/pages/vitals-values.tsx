import type { VitalMetrics } from '@seotools/core'
import { vitalState } from '@seotools/core/vitals-state'
import { getFormatter, getTranslations } from 'next-intl/server'

export async function VitalsValues({
  metrics,
  lab = false,
}: {
  metrics?: VitalMetrics
  lab?: boolean
}) {
  const t = await getTranslations('Vitals')
  const format = await getFormatter()
  const keys = lab
    ? (['lcp', 'cls', 'tbt', 'fcp'] as const)
    : (['lcp', 'inp', 'cls', 'fcp', 'ttfb'] as const)
  return (
    <dl className="flex flex-wrap gap-6">
      {keys.map((metric) => (
        <div key={metric}>
          <dt>{t(`metrics.${metric}`)}</dt>
          <dd>
            {metrics?.[metric] == null
              ? '—'
              : `${format.number(metrics[metric], { minimumFractionDigits: metric === 'cls' ? 2 : 0, maximumFractionDigits: metric === 'cls' ? 2 : 0 })}${metric === 'cls' ? '' : ' ms'}`}
            {!lab && (metric === 'lcp' || metric === 'inp' || metric === 'cls') && (
              <> · {t(`states.${vitalState(metric, metrics?.[metric])}`)}</>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
