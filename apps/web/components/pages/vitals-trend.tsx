'use client'
import { useTranslations } from 'next-intl'
import { Line, LineChart, XAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { VitalsPoint } from '@/lib/vitals'
export function VitalsTrend({ points }: { points: VitalsPoint[] }) {
  const t = useTranslations('Vitals')
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {(['lcp', 'inp', 'cls'] as const).map((metric) => (
        <div key={metric}>
          <p>{t(`metrics.${metric}`)}</p>
          <ChartContainer
            className="h-24 w-full"
            config={{ [metric]: { label: t(`metrics.${metric}`), color: 'var(--chart-1)' } }}
          >
            <LineChart data={points}>
              <XAxis dataKey="at" hide />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                type="linear"
                dataKey={metric}
                stroke="var(--chart-1)"
                connectNulls={false}
                dot
              />
            </LineChart>
          </ChartContainer>
        </div>
      ))}
    </div>
  )
}
