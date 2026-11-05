'use client'

import { ALERT_KINDS, type AlertKind } from '@seotools/core/alerts'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { saveAlertsAction, type AlertsState } from '@/app/(protected)/account/actions'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useFormActionState } from '@/hooks/use-form-action-state'

export interface AlertsDomain {
  id: string
  host: string
  kinds: AlertKind[]
}
export interface AlertsGroup {
  id: string
  name: string
  domains: AlertsDomain[]
}

/** What one wants to be emailed about each domain they can see. Nothing is on until they turn it on. */
export function AlertsForm({ groups }: { groups: AlertsGroup[] }) {
  const t = useTranslations('Account.alerts')
  const [state, onSubmit, pending] = useFormActionState<AlertsState>(saveAlertsAction, {})
  const [chosen, setChosen] = useState(
    () =>
      new Set(groups.flatMap((g) => g.domains.flatMap((d) => d.kinds.map((k) => `${d.id}:${k}`)))),
  )
  const toggle = (key: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  if (groups.length === 0) return <p className="text-sm text-muted-foreground">{t('empty')}</p>
  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      {groups.map((group) => (
        <fieldset key={group.id} className="grid gap-4">
          <legend className="text-sm font-medium">{group.name}</legend>
          {group.domains.map((domain) => (
            <div key={domain.id} className="grid gap-3 rounded-lg border p-3">
              <p className="font-medium break-all">{domain.host}</p>
              {ALERT_KINDS.map((kind) => {
                const key = `${domain.id}:${kind}`
                return (
                  <div key={kind} className="flex items-start gap-3">
                    <Switch
                      id={key}
                      name={key}
                      checked={chosen.has(key)}
                      onCheckedChange={(on) => toggle(key, on)}
                    />
                    <div className="grid gap-1">
                      <Label htmlFor={key}>{t(`kinds.${kind}.label`)}</Label>
                      <p className="text-xs text-muted-foreground">{t(`kinds.${kind}.hint`)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </fieldset>
      ))}
      <p className="text-xs text-muted-foreground">{t('language')}</p>
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
