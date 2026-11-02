'use client'

import { useTranslations } from 'next-intl'
import { useTransition } from 'react'
import { retryAuditRecomputeAction } from '@/app/(protected)/domains/[host]/audit-actions'
import { Button } from '@/components/ui/button'

/** Asks the worker again to analyse the latest crawl, after a recalculation that gave up. */
export function RetryRecomputeButton({ host }: { host: string }) {
  const t = useTranslations('AuditRules.status.failed')
  const [pending, startTransition] = useTransition()
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
