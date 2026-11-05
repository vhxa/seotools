'use client'

import { useCanEdit } from '@/components/domain-access'
import type { CrawlType } from '@seotools/core'
import { PlayIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { startCrawlAction, type ActionState } from '@/app/(protected)/domains/[host]/actions'
import { Button } from '@/components/ui/button'

export function StartCrawlButton({
  host,
  type,
  disabled,
  variant,
}: {
  host: string
  type: CrawlType
  /** A crawl of this domain is already active. */
  disabled?: boolean
  variant?: 'default' | 'outline'
}) {
  const canEdit = useCanEdit()
  const t = useTranslations('Crawl')
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    startCrawlAction.bind(null, host, type),
    {},
  )
  if (!canEdit) return null
  return (
    <form action={formAction} className="grid shrink-0 justify-items-end gap-1">
      <Button type="submit" variant={variant} disabled={disabled || pending}>
        <PlayIcon />
        {t(`start.${type}`)}
      </Button>
      {state.error && (
        <p role="alert" className="max-w-64 text-right text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  )
}
