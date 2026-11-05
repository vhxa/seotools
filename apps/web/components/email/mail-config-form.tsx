'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { saveMailConfigAction, type EmailActionState } from '@/app/(protected)/system/email/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useFormActionState } from '@/hooks/use-form-action-state'
import type { MailConfigView } from '@/lib/mail-config'

type Provider = 'smtp' | 'resend'

/** The provider and its settings. Secrets are never here: only whether one is saved. */
export function MailConfigForm({ view }: { view: MailConfigView | null }) {
  const t = useTranslations('Email.provider')
  const [state, onSubmit, pending] = useFormActionState<EmailActionState>(saveMailConfigAction, {})
  const [provider, setProvider] = useState<Provider>(view?.provider ?? 'smtp')
  const smtp = view?.provider === 'smtp' ? view : null
  const resend = view?.provider === 'resend' ? view : null
  const [secure, setSecure] = useState(smtp?.secure ?? false)
  const providers = [
    { value: 'smtp', label: t('smtp') },
    { value: 'resend', label: t('resend') },
  ]

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <div className="grid gap-2">
        <Label htmlFor="provider">{t('label')}</Label>
        <Select
          name="provider"
          items={providers}
          value={provider}
          onValueChange={(value) => value && setProvider(value as Provider)}
        >
          <SelectTrigger id="provider" className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {providers.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {provider === 'smtp' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="grid gap-2">
              <Label htmlFor="host">{t('host')}</Label>
              <Input
                id="host"
                name="host"
                defaultValue={smtp?.host ?? ''}
                placeholder="smtp.example.com"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="port">{t('port')}</Label>
              <Input
                id="port"
                name="port"
                type="number"
                min={1}
                max={65535}
                defaultValue={smtp?.port ?? 587}
                required
              />
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Switch id="secure" name="secure" checked={secure} onCheckedChange={setSecure} />
            <div className="grid gap-1">
              <Label htmlFor="secure">{t('secure')}</Label>
              <p className="text-xs text-muted-foreground">{t('secureHint')}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label htmlFor="user">{t('user')}</Label>
              <Input
                id="user"
                name="user"
                defaultValue={smtp?.user ?? ''}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">{t('userHint')}</p>
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor="pass">{t('pass')}</Label>
              <Input id="pass" name="pass" type="password" autoComplete="new-password" />
              <p className="text-xs text-muted-foreground">
                {smtp?.hasPassword ? t('secretSaved') : t('secretNone')}
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor="apiKey">{t('apiKey')}</Label>
          <Input
            id="apiKey"
            name="apiKey"
            type="password"
            autoComplete="new-password"
            required={!resend?.hasApiKey}
          />
          <p className="text-xs text-muted-foreground">
            {resend?.hasApiKey ? t('secretSaved') : t('secretNone')}
          </p>
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="from">{t('from')}</Label>
        <Input
          id="from"
          name="from"
          defaultValue={view?.from ?? ''}
          placeholder="seotools <seo@example.com>"
          required
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">{t('fromHint')}</p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t('saving') : t('save')}
        </Button>
        {state.error && !pending && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        {state.saved && !pending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('saved')}
          </p>
        )}
      </div>
    </form>
  )
}
