'use client'

import { useCanEdit } from '@/components/domain-access'
import { useTranslations } from 'next-intl'
import { useTransition } from 'react'
import { retryAuditRecomputeAction } from '@/app/(protected)/domains/[host]/audit-actions'
import { Button } from '@/components/ui/button'

/** Asks the worker again to analyse the latest crawl, after a recalculation that gave up. */
export function RetryRecomputeButton({ host }: { host: string }) {
  const canEdit = useCanEdit()
  const t = useTranslations('AuditRules.status.failed')
  const [pending, startTransition] = useTransition()
  if (!canEdit) return null
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => retryAuditRecomputeAction(host))}
    >
      {pending ? t('retrying') : t('retry')}
    </Button>
  )
}
