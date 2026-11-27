'use client'

import {
  capacityLimits,
  type Capacity,
  type CapacityHardware,
  type CrawlCapacityMetrics,
} from '@seotools/core/capacity'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { saveCapacityAction } from '@/app/(protected)/system/capacity/actions'
import { MemoryEstimate } from '@/components/capacity-estimate'
import { NumericSlider } from '@/components/numeric-slider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useFormActionState } from '@/hooks/use-form-action-state'

export function CapacityForm({
  capacity,
  hardware,
  recommended,
  metrics,
}: {
  capacity: Capacity | null
  hardware: CapacityHardware | null
  recommended: Capacity | null
  metrics: CrawlCapacityMetrics | null
}) {
  const t = useTranslations('Capacity')
  const [values, setValues] = useState(capacity)
  const [state, submit, pending] = useFormActionState(saveCapacityAction, {})
  if (!values) return <p className="text-sm text-muted-foreground">{t('waiting')}</p>

  return (
    <Card>
      <CardContent>
        <form onSubmit={submit} className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {(['renders', 'crawls'] as const).map((key) => (
              <NumericSlider
                key={key}
                name={key}
                label={t(key)}
                value={values[key]}
                {...capacityLimits[key]}
                onChange={(value) => setValues({ ...values, [key]: value! })}
              />
            ))}
          </div>
          {recommended && (
            <p className="text-sm text-muted-foreground">{t('recommended', recommended)}</p>
          )}
          <dl className="grid gap-4 rounded-xl border p-4 text-sm sm:grid-cols-2">
            <MemoryEstimate renders={values.renders} hardware={hardware} metrics={metrics} />
          </dl>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>
              {t('save')}
            </Button>
            <p role="status" className="text-sm text-muted-foreground">
              {pending ? t('saving') : state.saved ? t('saved') : null}
            </p>
            {state.error && (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
