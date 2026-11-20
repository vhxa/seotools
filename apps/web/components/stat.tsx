import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'

/** One figure in a card: the label, the value, and optionally a change and a note below it. */
export function Stat({
  label,
  value,
  change,
  hint,
}: {
  label: string
  value: ReactNode
  change?: ReactNode
  hint?: string | null
}) {
  return (
    <Card className="min-w-0 bg-linear-to-t from-sidebar to-background">
      <CardContent>
        <dl className="grid content-start gap-1">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="text-3xl font-bold tabular-nums">{value}</dd>
          {change && <div className="mt-4">{change}</div>}
          {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
        </dl>
      </CardContent>
    </Card>
  )
}
