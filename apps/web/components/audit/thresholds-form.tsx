'use client'

import {
  AUDIT_THRESHOLDS,
  THRESHOLD_KEYS,
  type ThresholdOverrides,
} from '@seotools/core/crawl/thresholds'
import { useTranslations } from 'next-intl'
import {
  saveAuditThresholdsAction,
  type ThresholdsFormState,
} from '@/app/(protected)/domains/[host]/audit-actions'
import { useCanEdit } from '@/components/domain-access'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useFormActionState } from '@/hooks/use-form-action-state'

/** One field per figure: empty is the recommended one, which is shown as the placeholder. */
export function ThresholdsForm({
  host,
  thresholds,
}: {
  host: string
  thresholds: ThresholdOverrides
}) {
  const t = useTranslations('AuditRules.thresholds')
  const canEdit = useCanEdit()
  const [state, onSubmit, saving] = useFormActionState<ThresholdsFormState>(
    saveAuditThresholdsAction.bind(null, host),
    {},
  )
  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {THRESHOLD_KEYS.map((key) => {
          const { default: recommended, min, max } = AUDIT_THRESHOLDS[key]
          const id = `threshold-${key}`
          return (
            <div key={key} className="grid content-start gap-2">
              <Label htmlFor={id}>{t(`fields.${key}.label`)}</Label>
              <Input
                id={id}
                name={key}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                step={1}
                defaultValue={thresholds[key] ?? ''}
                placeholder={String(recommended)}
                disabled={!canEdit}
                aria-describedby={`${id}-help`}
                className="max-w-40"
              />
              <p id={`${id}-help`} className="text-xs text-muted-foreground">
                {t(`fields.${key}.unit`)} · {t('recommended', { value: recommended })}
              </p>
            </div>
          )
        })}
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('saved')}
        </p>
      )}
      {canEdit && (
        <div>
          <Button type="submit" disabled={saving}>
            {t('save')}
          </Button>
        </div>
      )}
    </form>
  )
}
