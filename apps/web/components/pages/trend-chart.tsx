'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { TrendPoint } from '@/lib/dashboard'

export type TrendSeries = 'indexable' | 'issues' | 'warnings' | 'opportunities'

const COLORS: Record<TrendSeries, string> = {
  indexable: 'var(--chart-3)',
  issues: 'var(--chart-2)',
  warnings: 'var(--chart-4)',
  opportunities: 'var(--chart-1)',
}

/** With this many points or fewer each one gets a marker; past it the line is enough. */
const MARKER_LIMIT = 30

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
  points: TrendPoint[]
  compact?: boolean
}) {
  const t = useTranslations('Dashboard')
  const format = useFormatter()
  const config = Object.fromEntries(
    series.map((id) => [id, { label: t(`series.${id}`), color: COLORS[id] }]),
  ) satisfies ChartConfig
  const marker = (id: TrendSeries) =>
    points.length <= MARKER_LIMIT
      ? {
          r: 4,
          fill: `var(--color-${id})`,
          // The area's own fill is a faint wash, and markers would inherit it.
          fillOpacity: 1,
          stroke: 'var(--background)',
          strokeWidth: 2,
        }
      : false
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
        <AreaChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            allowDecimals={false}
            tickFormatter={(value: number) => format.number(value)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                indicator="dot"
                labelFormatter={(_, payload) => {
                  const at = payload?.[0]?.payload?.at
                  return typeof at === 'number'
                    ? format.dateTime(at, { dateStyle: 'medium', timeStyle: 'short' })
                    : null
                }}
              />
            }
          />
          {series.length > 1 && (
            // Recharts sorts legend entries by name by default; keep the order of the series, which
            // is the order of the tiles on the dashboard.
            <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
          )}
          {series.map((id) => (
            <Area
              key={id}
              dataKey={id}
              name={t(`series.${id}`)}
              type="monotone"
              stroke={`var(--color-${id})`}
              strokeWidth={2}
              fill={`var(--color-${id})`}
              fillOpacity={0.1}
              dot={marker(id)}
              activeDot={{
                r: 5,
                fill: `var(--color-${id})`,
                fillOpacity: 1,
                stroke: 'var(--background)',
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ChartContainer>
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
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.at}>
              <td>{format.dateTime(point.at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
              {series.map((id) => (
                <td key={id}>{number(point[id])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
