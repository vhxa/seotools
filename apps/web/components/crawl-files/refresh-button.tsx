'use client'

import { useCanEdit } from '@/components/domain-access'
import { RefreshCwIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { refreshCrawlFilesAction, type ActionState } from '@/app/(protected)/domains/[host]/actions'
import { Button } from '@/components/ui/button'

export function RefreshCrawlFilesButton({
  host,
  disabled,
  pending,
}: {
  host: string
  /** A full crawl is requesting these files already. */
  disabled: boolean
  /** A refresh is already on its way. */
  pending: boolean
}) {
  const canEdit = useCanEdit()
  const t = useTranslations('CrawlFiles.refresh')
  const [state, formAction, submitting] = useActionState<ActionState, FormData>(
    refreshCrawlFilesAction.bind(null, host),
    {},
  )
  const busy = pending || submitting
  if (!canEdit) return null
  return (
    <form action={formAction} className="grid shrink-0 justify-items-end gap-1">
      <Button
        type="submit"
        variant="outline"
        disabled={disabled || busy}
        title={disabled ? t('crawlRunning') : undefined}
      >
        <RefreshCwIcon className={busy ? 'animate-spin' : undefined} />
        {t(busy ? 'pending' : 'action')}
      </Button>
      {state.error && (
        <p role="alert" className="max-w-64 text-right text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  )
}
