import type { VitalMetrics } from '@seotools/core'
import { vitalPosition, vitalState, type VitalState } from '@seotools/core/vitals-state'
import { getFormatter, getTranslations } from 'next-intl/server'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const DOT: Record<VitalState, string> = {
  good: 'bg-chart-3',
  'needs-improvement': 'bg-chart-4',
  poor: 'bg-chart-2',
  'no-data': 'bg-muted-foreground/40',
}

/** The colour of the value above the bar, dark enough to read on the page. */
const TEXT: Record<VitalState, string> = {
  good: 'text-green-700 dark:text-green-400',
  'needs-improvement': 'text-amber-600 dark:text-amber-400',
  poor: 'text-red-600 dark:text-red-400',
  'no-data': 'text-muted-foreground',
}

/**
 * One block per metric: a dot with its state, its full name and acronym (underlined: hovering it
 * explains the metric) and, when it has thresholds, a bar with the value above the marker.
 */
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
    <dl className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-5">
      {keys.map((metric) => {
        const value = metrics?.[metric]
        const stateful = !lab && metric !== 'tbt'
        const state = stateful ? vitalState(metric, value) : 'no-data'
        const text =
          value == null
            ? '—'
            : `${format.number(value, { minimumFractionDigits: metric === 'cls' ? 2 : 0, maximumFractionDigits: metric === 'cls' ? 2 : 0 })}${metric === 'cls' ? '' : ' ms'}`
        const position = value == null || !stateful ? null : vitalPosition(metric, value)
        return (
          <div key={metric} className="grid min-w-0 content-start gap-1">
            <dt className="flex min-w-0 items-center gap-1.5 text-xs">
              {stateful && (
                <span
                  aria-hidden="true"
                  className={cn('size-1.5 shrink-0 rounded-full', DOT[state])}
                />
              )}
              <Tooltip>
                <TooltipTrigger
                  className="cursor-help truncate text-left underline decoration-foreground/60 underline-offset-2"
                  type="button"
                >
                  {t(`names.${metric}`)} ({t(`metrics.${metric}`)})
                </TooltipTrigger>
                <TooltipContent className="max-w-64">{t(`help.${metric}`)}</TooltipContent>
              </Tooltip>
            </dt>
            {stateful ? (
              <dd
                className="relative mt-6"
                aria-label={`${text}${state === 'no-data' ? '' : ` · ${t(`states.${state}`)}`}`}
              >
                {position !== null && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute bottom-full mb-2 -translate-x-1/2 text-xs leading-none font-medium whitespace-nowrap tabular-nums',
                      TEXT[state],
                    )}
                    style={{ left: `${Math.min(Math.max(position, 0.05), 0.95) * 100}%` }}
                  >
                    {text}
                  </span>
                )}
                <span aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full">
                  <span className="w-[60%] bg-chart-3/80" />
                  <span className="w-[15%] bg-chart-4/80" />
                  <span className="w-[25%] bg-chart-2/80" />
                </span>
                {position !== null && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
                    style={{ left: `${position * 100}%` }}
                  />
                )}
                {position === null && (
                  <span className="mt-1 block text-xs text-muted-foreground">{text}</span>
                )}
              </dd>
            ) : (
              <dd className="text-xl font-semibold tabular-nums">{text}</dd>
            )}
          </div>
        )
      })}
    </dl>
  )
}
