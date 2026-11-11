'use client'
import { useTranslations } from 'next-intl'
import {
  saveGoogleKeyAction,
  testGoogleKeyAction,
} from '@/app/(protected)/system/integrations/actions'
import { useFormActionState } from '@/hooks/use-form-action-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function IntegrationsForm({
  configured,
  unreadable,
}: {
  configured: boolean
  unreadable: boolean
}) {
  const t = useTranslations('Vitals')
  const [state, submit, pending] = useFormActionState(saveGoogleKeyAction, {})
  const [test, run, testing] = useFormActionState(testGoogleKeyAction, {})
  return (
    <div className="grid gap-6">
      <p>{t('privacy')}</p>
      <p>{t(unreadable ? 'unreadable' : configured ? 'configured' : 'no-key')}</p>
      <form onSubmit={submit} className="grid gap-3">
        <Label htmlFor="google-key">{t('key')}</Label>
        <Input
          id="google-key"
          name="key"
          type="password"
          autoComplete="new-password"
          maxLength={500}
        />
        <p className="text-sm text-muted-foreground">{t('keep')}</p>
        <Label>
          <input name="remove" type="checkbox" />
          {t('remove')}
        </Label>
        <Button disabled={pending}>{t('save')}</Button>
        {state.result && <p role="status">{t(`results.${state.result}`)}</p>}
      </form>
      <form onSubmit={run} className="grid gap-3">
        <Button disabled={testing || !configured} variant="outline">
          {t('test')}
        </Button>
        <p className="text-sm text-muted-foreground">{t('testHint')}</p>
        {test.result && <p role="status">{t(`results.${test.result}`)}</p>}
      </form>
    </div>
  )
}
