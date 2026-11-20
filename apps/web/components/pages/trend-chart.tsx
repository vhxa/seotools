'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { BasisChange, SegmentedPoint } from '@/lib/dashboard'

export type TrendSeries = 'indexable' | 'issues' | 'warnings' | 'opportunities'

const COLORS: Record<TrendSeries, string> = {
  indexable: 'var(--chart-3)',
  issues: 'var(--chart-2)',
  warnings: 'var(--chart-4)',
  opportunities: 'var(--chart-1)',
}

/** With this many points or fewer each one gets a marker; past it the line is enough. */
const MARKER_LIMIT = 30

/** The key of a series within one stretch of comparable crawls: each stretch is drawn apart. */
const stretchKey = (id: TrendSeries, segment: number) => `${id}__${segment}`

interface TrendDotProps {
  cx?: number
  cy?: number
  index?: number
  payload?: SegmentedPoint
}

/** A stretch only draws its own points; the first one after a break is ringed. */
function TrendDot({
  cx,
  cy,
  payload,
  color,
  segment,
  plain,
}: TrendDotProps & { color: string; segment: number; plain: boolean }) {
  if (cx === undefined || cy === undefined || !payload || payload.segment !== segment) return <g />
  // Ringed whatever the number of points: it is what the caption explains.
  if (payload.changes.length > 0) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={8} fill="var(--background)" stroke={color} strokeWidth={2} />
        <circle cx={cx} cy={cy} r={3.5} fill={color} />
      </g>
    )
  }
  return plain ? (
    <circle cx={cx} cy={cy} r={4} fill={color} stroke="var(--background)" strokeWidth={2} />
  ) : (
    <g />
  )
}

/**
 * One chart of how the figures of full crawls moved. Only series counted over the same pages go
 * together in one: the caller draws indexable pages (over every page crawled) in a chart of its
 * own, apart from the findings (over audited pages).
 */
export function TrendChart({
  series,
  points,
  compact = false,
}: {
  series: readonly TrendSeries[]
  points: SegmentedPoint[]
  compact?: boolean
}) {
  const t = useTranslations('Dashboard')
  const format = useFormatter()
  const stretches = Array.from(
    { length: Math.max(0, ...points.map((p) => p.segment)) + 1 },
    (_, i) => i,
  )
  // A line never joins crawls that did not measure the same thing: each stretch is a series of its
  // own, with values only at its points, so the line ends and starts again at a break.
  const data = points.map((point) => ({
    ...point,
    ...Object.fromEntries(series.map((id) => [stretchKey(id, point.segment), point[id]] as const)),
  }))
  const config = Object.fromEntries(
    series.flatMap((id) =>
      stretches.map((segment) => [
        stretchKey(id, segment),
        { label: t(`series.${id}`), color: COLORS[id] },
      ]),
    ),
  ) satisfies ChartConfig
  const describe = (change: BasisChange): string => {
    switch (change.kind) {
      case 'rendering':
        return t(`basis.rendering.${change.to}`)
      case 'ignoredAdded':
      case 'ignoredRemoved':
        return t(`basis.${change.kind}`, {
          count: change.parameters.length,
          parameters: format.list(change.parameters.slice(0, 4)),
          more: Math.max(0, change.parameters.length - 4),
        })
      case 'settings':
        return t('basis.settings', {
          settings: format.list(change.settings.map((setting) => t(`basis.setting.${setting}`))),
        })
      case 'catalog':
        return t('basis.catalog')
      case 'rules':
        return t('basis.rules')
    }
  }
  const marked = points.some((point) => point.changes.length > 0)
  const dotOf = (id: TrendSeries, segment: number) => {
    const plain = points.length <= MARKER_LIMIT
    return function renderDot(props: TrendDotProps) {
      return <TrendDot {...props} color={COLORS[id]} segment={segment} plain={plain} />
    }
  }
  // Several crawls on one day would repeat its label: only the first point of each day gets a tick
  // (the tooltip keeps the exact time).
  const dayTicks: number[] = []
  let lastDay: string | null = null
  for (const point of points) {
    const day = format.dateTime(point.at, { year: 'numeric', month: 'numeric', day: 'numeric' })
    if (day !== lastDay) dayTicks.push(point.at)
    lastDay = day
  }
  const number = (value: number | null) => (value === null ? '—' : format.number(value))

  if (points.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        {t('chartEmpty')}
      </p>
    )
  }

  return (
    <>
      <ChartContainer
        config={config}
        className={compact ? 'aspect-auto h-40 w-full min-w-0' : 'aspect-auto h-64 w-full min-w-0'}
      >
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="at"
            ticks={dayTicks}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={(at: number) => format.dateTime(at, { month: 'short', day: 'numeric' })}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                indicator="dot"
                labelFormatter={(_, payload) => {
                  const point = payload?.[0]?.payload as SegmentedPoint | undefined
                  if (typeof point?.at !== 'number') return null
                  return (
                    <div className="grid gap-1">
                      <span>
                        {format.dateTime(point.at, { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                      {point.changes.map((change) => (
                        <span key={change.kind} className="font-normal text-muted-foreground">
                          {describe(change)}
                        </span>
                      ))}
                    </div>
                  )
                }}
              />
            }
          />
          {series.length > 1 && (
            // Recharts sorts legend entries by name by default; keep the order of the series, which
            // is the order of the tiles on the dashboard.
            <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
          )}
          {series.flatMap((id) =>
            stretches.map((segment) => (
              <Area
                key={stretchKey(id, segment)}
                dataKey={stretchKey(id, segment)}
                name={t(`series.${id}`)}
                // One entry per series in the legend, not one per stretch.
                legendType={segment === 0 ? undefined : 'none'}
                type="monotone"
                stroke={`var(--color-${stretchKey(id, segment)})`}
                strokeWidth={2}
                fill={`var(--color-${stretchKey(id, segment)})`}
                fillOpacity={0.1}
                dot={dotOf(id, segment)}
                activeDot={{
                  r: 5,
                  fill: `var(--color-${stretchKey(id, segment)})`,
                  fillOpacity: 1,
                  stroke: 'var(--background)',
                  strokeWidth: 2,
                }}
                connectNulls={false}
                isAnimationActive={false}
              />
            )),
          )}
        </AreaChart>
      </ChartContainer>
      {marked && (
        <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <svg aria-hidden className="mt-0.5 size-4 shrink-0" viewBox="0 0 16 16">
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="var(--background)"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle cx="8" cy="8" r="2.5" fill="currentColor" />
          </svg>
          {t('basis.legend')}
        </p>
      )}
      <table className="sr-only">
        <caption>
          {t('chartCaption', { series: series.map((id) => t(`series.${id}`)).join(', ') })}
        </caption>
        <thead>
          <tr>
            <th>{t('chartDate')}</th>
            {series.map((id) => (
              <th key={id}>{t(`series.${id}`)}</th>
            ))}
            <th>{t('basis.column')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.at}>
              <td>{format.dateTime(point.at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
              {series.map((id) => (
                <td key={id}>{number(point[id])}</td>
              ))}
              <td>{point.changes.map(describe).join('; ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
