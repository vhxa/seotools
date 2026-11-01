'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'

/** How the pages of a full crawl were when it ended. */
export interface PagesPoint {
  /** When the crawl ended, in milliseconds since the epoch. */
  at: number
  correct: number
  issues: number
}

export interface PagesStats {
  total: number | null
  /** `null` when the last crawl has not been checked for issues. */
  correct: number | null
  issues: number | null
}

type Series = 'correct' | 'issues'

const config = {
  correct: { color: 'var(--chart-1)' },
  issues: { color: 'var(--chart-2)' },
} satisfies ChartConfig

/** With this many points or fewer each one gets a marker; past it the line is enough. */
const MARKER_LIMIT = 30

function Tile({
  label,
  value,
  hint,
  series,
  pressed,
  onToggle,
  toggleLabel,
}: {
  label: string
  value: string
  hint?: string
  series?: Series
  pressed?: boolean
  onToggle?: () => void
  toggleLabel?: string
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {series && (
          <span
            aria-hidden
            className="size-3 rounded-[3px] border-2 transition-colors"
            // Outside the chart container, which is where `--color-<series>` exists.
            style={{
              borderColor: config[series].color,
              backgroundColor: pressed ? config[series].color : 'transparent',
            }}
          />
        )}
        {label}
      </span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </>
  )
  const base = 'grid content-start gap-1 rounded-lg border p-4 text-left'
  return onToggle ? (
    <button
      type="button"
      aria-pressed={pressed}
      title={toggleLabel}
      onClick={onToggle}
      className={cn(
        base,
        'transition-colors outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        pressed && 'bg-muted/40',
      )}
    >
      {body}
    </button>
  ) : (
    <div className={base}>{body}</div>
  )
}

/**
 * The three figures of the pages overview and the history behind two of them, in the manner of
 * Search Console: clicking "correct" or "with issues" shows or hides its line. One line always
 * stays on.
 */
export function PagesChart({ stats, points }: { stats: PagesStats; points: PagesPoint[] }) {
  const t = useTranslations('Pages')
  const format = useFormatter()
  const [hidden, setHidden] = useState<Series[]>([])

  const toggle = (series: Series) =>
    setHidden((current) =>
      current.includes(series)
        ? current.filter((s) => s !== series)
        : current.length === 0
          ? [series]
          : current,
    )
  const shown = (series: Series) => !hidden.includes(series)
  const number = (value: number | null) => (value === null ? '—' : format.number(value))
  const notChecked = stats.correct === null ? t('stats.notChecked') : undefined
  const marker = (series: Series) =>
    points.length <= MARKER_LIMIT
      ? {
          r: 4,
          fill: `var(--color-${series})`,
          // The area's own fill is a faint wash, and markers would inherit it.
          fillOpacity: 1,
          stroke: 'var(--background)',
          strokeWidth: 2,
        }
      : false

  return (
    <Card>
      <CardContent className="grid gap-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label={t('stats.total')} value={number(stats.total)} />
          <Tile
            label={t('stats.correct')}
            value={number(stats.correct)}
            hint={notChecked}
            series="correct"
            pressed={shown('correct')}
            onToggle={() => toggle('correct')}
            toggleLabel={t('chart.toggle')}
          />
          <Tile
            label={t('stats.issues')}
            value={number(stats.issues)}
            hint={notChecked}
            series="issues"
            pressed={shown('issues')}
            onToggle={() => toggle('issues')}
            toggleLabel={t('chart.toggle')}
          />
        </div>

        {points.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            {t('chart.empty')}
          </p>
        ) : (
          <>
            <ChartContainer config={config} className="aspect-auto h-64 w-full">
              <AreaChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="at"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(at: number) =>
                    format.dateTime(at, { month: 'short', day: 'numeric' })
                  }
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
                {(['correct', 'issues'] as const).map(
                  (series) =>
                    shown(series) && (
                      <Area
                        key={series}
                        dataKey={series}
                        name={t(series === 'correct' ? 'stats.correct' : 'stats.issues')}
                        type="monotone"
                        stroke={`var(--color-${series})`}
                        strokeWidth={2}
                        fill={`var(--color-${series})`}
                        fillOpacity={0.1}
                        dot={marker(series)}
                        activeDot={{
                          r: 5,
                          fill: `var(--color-${series})`,
                          fillOpacity: 1,
                          stroke: 'var(--background)',
                          strokeWidth: 2,
                        }}
                        isAnimationActive={false}
                      />
                    ),
                )}
              </AreaChart>
            </ChartContainer>
            <table className="sr-only">
              <caption>{t('chart.ariaLabel')}</caption>
              <thead>
                <tr>
                  <th>{t('chart.date')}</th>
                  <th>{t('stats.correct')}</th>
                  <th>{t('stats.issues')}</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr key={point.at}>
                    <td>
                      {format.dateTime(point.at, { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td>{format.number(point.correct)}</td>
                    <td>{format.number(point.issues)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  )
}
