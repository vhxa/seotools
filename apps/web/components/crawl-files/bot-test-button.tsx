'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { startBotTestAction } from '@/app/(protected)/domains/[host]/bot-actions'
import { useCanEdit } from '@/components/domain-access'
import { Button } from '@/components/ui/button'

export function BotTestButton({
  host,
  busy,
  archived,
}: {
  host: string
  busy: boolean
  archived: boolean
}) {
  const canEdit = useCanEdit()
  const t = useTranslations('BotTest')
  const [state, action, pending] = useActionState(startBotTestAction.bind(null, host), {})
  if (!canEdit) return null
  return (
    <form action={action} className="grid gap-2">
      <Button type="submit" variant="outline" disabled={busy || pending || archived}>
        {t(busy || pending ? 'pending' : 'start')}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  )
}
