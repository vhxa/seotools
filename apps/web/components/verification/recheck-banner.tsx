import type { Verification } from '@seotools/db'
import { CircleAlertIcon, CircleCheckIcon, RefreshCwIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { cancelRecheckAction } from '@/app/(protected)/domains/[host]/verify-actions'
import { AutoRefresh } from '@/components/auto-refresh'
import { EditorsOnly } from '@/components/domain-access'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { loadRecheckAnnouncement } from '@/lib/recheck-notice'

/** Where the URLs of a recheck, and what each one found, are listed. */
export const recheckHref = (host: string, verification: Pick<Verification, 'id'>) =>
  `/domains/${host}/jobs/verifications/${verification.id}`

/**
 * Says how the domain's recheck is going: under way (refreshing itself, with a way to cancel it),
 * or just finished, with where to read what it found, or failed, with why. Nothing when there is
 * nothing to say.
 */
export async function RecheckBanner({ host, domainId }: { host: string; domainId: string }) {
  const announcement = await loadRecheckAnnouncement(domainId)
  if (!announcement) return null
  const t = await getTranslations('Verification.banner')
  const { verification } = announcement

  if (announcement.kind === 'active') {
    const percent =
      verification.urlsCount > 0
        ? Math.round((verification.urlsDoneCount / verification.urlsCount) * 100)
        : 0
    return (
      <Alert>
        <RefreshCwIcon />
        <AutoRefresh intervalMs={2000} />
        <AlertTitle>{t('active.title', { count: verification.urlsCount })}</AlertTitle>
        <AlertDescription>
          <Progress value={percent} aria-label={t('active.progressLabel')} className="my-1.5" />
          <p>
            {verification.status === 'pending'
              ? t('active.waiting')
              : t('active.progress', {
                  done: verification.urlsDoneCount,
                  total: verification.urlsCount,
                })}
          </p>
        </AlertDescription>
        <AlertAction className="flex items-center gap-2">
          <Link
            href={recheckHref(host, verification)}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            {t('viewResults')}
          </Link>
          <EditorsOnly>
            <form action={cancelRecheckAction.bind(null, host, verification.id)}>
              <Button type="submit" variant="outline" size="sm">
                {t('cancel')}
              </Button>
            </form>
          </EditorsOnly>
        </AlertAction>
      </Alert>
    )
  }
  if (announcement.kind === 'failed') {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>{t('failed.title')}</AlertTitle>
        <AlertDescription>
          {t('failed.description', { error: verification.error ?? '—' })}
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert>
      <CircleCheckIcon />
      <AlertTitle>{t('done.title', { count: verification.urlsCount })}</AlertTitle>
      <AlertDescription>{t('done.description')}</AlertDescription>
      <AlertAction>
        <Link
          href={recheckHref(host, verification)}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {t('viewResults')}
        </Link>
      </AlertAction>
    </Alert>
  )
}
