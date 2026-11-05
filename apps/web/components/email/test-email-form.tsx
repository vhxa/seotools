'use client'

import { useTranslations } from 'next-intl'
import { sendTestEmailAction, type EmailActionState } from '@/app/(protected)/system/email/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useFormActionState } from '@/hooks/use-form-action-state'

/** Sends a test email and shows, right here, whether it went or what the provider said. */
export function TestEmailForm({
  defaultTo,
  configured,
}: {
  defaultTo: string
  configured: boolean
}) {
  const t = useTranslations('Email.test')
  const [state, onSubmit, pending] = useFormActionState<EmailActionState>(sendTestEmailAction, {})

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <div className="grid gap-2 sm:max-w-sm">
        <Label htmlFor="to">{t('to')}</Label>
        <Input
          id="to"
          name="to"
          type="email"
          defaultValue={defaultTo}
          required
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending || !configured}>
          {pending ? t('sending') : t('send')}
        </Button>
        {!pending && state.sent && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('sent', { address: state.sent })}
          </p>
        )}
        {!pending && state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        {!pending && state.failure && (
          <p role="alert" className="text-sm break-words text-destructive">
            {t('failed', { error: state.failure })}
          </p>
        )}
      </div>
    </form>
  )
}
