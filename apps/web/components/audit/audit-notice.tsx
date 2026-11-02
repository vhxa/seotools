import type { AuditResultsState } from '@seotools/core/crawl/audit'
import { CircleAlertIcon, RefreshCwIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { RetryRecomputeButton } from '@/components/audit/retry-button'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AutoRefresh } from '@/components/auto-refresh'

/**
 * Says when what is shown does not reflect the audit configuration yet: the worker has not
 * analysed the last crawl again, or it gave up. Results from an older configuration are never
 * shown as if they were current. While it waits, the page checks again by itself.
 */
export async function AuditResultsNotice({
  host,
  state,
}: {
  host: string
  state: AuditResultsState
}) {
  if (state.kind !== 'pending' && state.kind !== 'failed') return null
  const t = await getTranslations('AuditRules.status')
  if (state.kind === 'pending') {
    return (
      <Alert>
        <RefreshCwIcon />
        <AutoRefresh intervalMs={4000} />
        <AlertTitle>{t('pending.title')}</AlertTitle>
        <AlertDescription>{t('pending.description')}</AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>{t('failed.title')}</AlertTitle>
      <AlertDescription>{t('failed.description', { error: state.message })}</AlertDescription>
      <AlertAction>
        <RetryRecomputeButton host={host} />
      </AlertAction>
    </Alert>
  )
}
