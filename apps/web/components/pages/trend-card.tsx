'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { InfoHelp } from '@/components/help'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { TrendPoint } from '@/lib/dashboard'
import { TrendChart, type TrendSeries } from './trend-chart'

const DAY = 24 * 60 * 60 * 1000

const RANGES = [
  { id: 'week', days: 7 },
  { id: 'month', days: 30 },
  { id: 'quarter', days: 90 },
] as const

type RangeId = (typeof RANGES)[number]['id']

/** The narrowest period with a line to draw (two points), else the widest. */
function defaultRange(points: TrendPoint[], now: number): RangeId {
  const found = RANGES.find(
    ({ days }) => points.filter((point) => point.at >= now - days * DAY).length >= 2,
  )
  return found?.id ?? 'quarter'
}

/**
 * A card with one trend chart and a period switch. `now` comes from the server so the first render
 * on the server and in the browser draw the same points.
 */
export function TrendCard({
  kind,
  series,
  points,
  now,
  compact = false,
}: {
  kind: 'findings' | 'indexable'
  series: readonly TrendSeries[]
  points: TrendPoint[]
  now: number
  compact?: boolean
}) {
  const t = useTranslations('Dashboard')
  const [chosen, setChosen] = useState<RangeId | null>(null)
  const range = chosen ?? defaultRange(points, now)
  const days = RANGES.find((entry) => entry.id === range)?.days ?? 90
  const visible = points.filter((point) => point.at >= now - days * DAY)
  const title = t(kind === 'findings' ? 'trendFindings' : 'trendIndexable')
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          {title}
          <InfoHelp label={title}>
            {t(kind === 'findings' ? 'trendFindingsHelp' : 'trendIndexableHelp')}
          </InfoHelp>
        </CardTitle>
        <CardDescription>{t(`rangeDescription.${range}`)}</CardDescription>
        <CardAction>
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            aria-label={t('range.label')}
            value={[range]}
            onValueChange={(value) => {
              const next = RANGES.find((entry) => entry.id === value[0])
              if (next) setChosen(next.id)
            }}
          >
            {RANGES.map(({ id }) => (
              <ToggleGroupItem key={id} value={id}>
                {t(`range.${id}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {points.length > 0 && visible.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {t('rangeEmpty')}
          </p>
        ) : (
          <TrendChart series={series} points={visible} compact={compact} />
        )}
      </CardContent>
    </Card>
  )
}
