'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requestPasswordEmailAction } from './actions'

export function ForgotPasswordForm() {
  const t = useTranslations('PasswordRecovery')
  const [state, action, pending] = useActionState(requestPasswordEmailAction, {})
  if (state.sent) {
    return (
      <p role="status" className="text-sm">
        {t('sent')}
      </p>
    )
  }
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="email">{t('email')}</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  )
}
