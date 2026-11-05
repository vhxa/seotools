'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { changePasswordAction } from '@/app/(protected)/account/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MIN_PASSWORD_LENGTH } from '@/lib/password'

export function PasswordForm() {
  const t = useTranslations('Account')
  const [state, action, pending] = useActionState(changePasswordAction, {})
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="current-password">{t('current')}</Label>
        <Input
          id="current-password"
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="next-password">{t('next')}</Label>
        <Input
          id="next-password"
          name="next"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
        <p className="text-xs text-muted-foreground">{t('othersSignedOut')}</p>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.done && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('changed')}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t('submitting') : t('submit')}
        </Button>
      </div>
    </form>
  )
}
