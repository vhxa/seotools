'use client'

import { useTranslations } from 'next-intl'
import { startListCrawlAction, type ActionState } from '@/app/(protected)/domains/[host]/actions'
import { useCanEdit } from '@/components/domain-access'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useFormActionState } from '@/hooks/use-form-action-state'

export function ListCrawlForm({ host }: { host: string }) {
  const t = useTranslations('Jobs.list')
  const canEdit = useCanEdit()
  const [state, onSubmit, pending] = useFormActionState<ActionState>(
    startListCrawlAction.bind(null, host),
    {},
  )
  if (!canEdit) return null
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <Label htmlFor="list-urls">{t('label')}</Label>
      <Textarea id="list-urls" name="urls" required maxLength={2_048_000} />
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.saved && <p role="status">{t('started')}</p>}
      <Button type="submit" disabled={pending}>
        {t('start')}
      </Button>
    </form>
  )
}
