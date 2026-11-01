'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import {
  addPriorityUrlAction,
  type AddPriorityUrlState,
} from '@/app/(protected)/domains/[host]/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function AddPriorityUrlForm({ host }: { host: string }) {
  const t = useTranslations('PrioritySettings')
  const [state, formAction, pending] = useActionState<AddPriorityUrlState, FormData>(
    addPriorityUrlAction.bind(null, host),
    {},
  )
  return (
    <form action={formAction} className="grid gap-2">
      <Label htmlFor="priority-url">{t('addLabel')}</Label>
      <div className="flex gap-2">
        <Input
          id="priority-url"
          name="url"
          placeholder={t('addPlaceholder', { host })}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={state.value}
          required
        />
        <Button type="submit" disabled={pending}>
          {t('add')}
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  )
}
