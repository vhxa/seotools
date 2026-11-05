'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import {
  setPeriodicChecksAction,
  type UpdatesActionState,
} from '@/app/(protected)/system/updates/actions'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useFormActionState } from '@/hooks/use-form-action-state'

export function PeriodicChecksForm({ enabled: initial }: { enabled: boolean }) {
  const t = useTranslations('Updates.periodic')
  const [state, onSubmit, pending] = useFormActionState<UpdatesActionState>(
    setPeriodicChecksAction,
    {},
  )
  const [enabled, setEnabled] = useState(initial)

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <div className="flex items-center gap-2">
        <Switch id="periodic" name="periodic" checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor="periodic">{t('label')}</Label>
      </div>
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          {t('save')}
        </Button>
        {state.saved && !pending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('saved')}
          </p>
        )}
      </div>
    </form>
  )
}
