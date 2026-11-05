import {
  UPDATE_GUIDE_URL,
  buildKind,
  evaluateUpdate,
  loadUpdateConfig,
  loadUpdateState,
  releaseNotesUrl,
  RELEASES_URL,
  type UpdateFailure,
  type UpdateStatus,
} from '@seotools/core'
import {
  ArrowUpCircleIcon,
  CheckCircle2Icon,
  CircleHelpIcon,
  FlaskConicalIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'
import { CheckNowButton } from '@/components/updates/check-now-button'
import { PeriodicChecksForm } from '@/components/updates/periodic-checks-form'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getBuildInfo } from '@/lib/build-info'
import { requireAdmin } from '@/lib/session'
import { getSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { checkForUpdatesAction } from './actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('Updates')
  return { title: t('metaTitle') }
}

const ICONS: Record<UpdateStatus['kind'], LucideIcon> = {
  'up-to-date': CheckCircle2Icon,
  'update-available': ArrowUpCircleIcon,
  'check-failed': TriangleAlertIcon,
  'not-checked': CircleHelpIcon,
  development: FlaskConicalIcon,
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // `cn` merges the classes: without it `border-transparent` wins over the variant's border.
      className={cn(buttonVariants({ variant: 'outline' }))}
    >
      {children}
    </a>
  )
}

/**
 * What is installed and what is the newest release. Looking is up to the administrator (a button)
 * or to the worker (if asked to): this page only shows what was stored, so visiting it never
 * contacts anyone and never waits for anyone.
 */
export default async function UpdatesPage() {
  await requireAdmin()
  const [t, format, settings] = await Promise.all([
    getTranslations('Updates'),
    getFormatter(),
    getSettings(),
  ])
  const [config, state] = await Promise.all([loadUpdateConfig(settings), loadUpdateState(settings)])
  const build = getBuildInfo()
  const status = evaluateUpdate(build, state)
  const kind = buildKind(build)
  const Icon = ICONS[status.kind]

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' })
  const reason = (failure: UpdateFailure) => t(`failures.${failure}`)
  const latest = status.latest

  const banner = (): { title: string; description: string; detail?: string } => {
    switch (status.kind) {
      case 'up-to-date':
        return {
          title: t('status.upToDate.title'),
          description: latest
            ? t(status.ahead ? 'status.upToDate.ahead' : 'status.upToDate.description', {
                installed: build.version,
                latest: latest.version,
                when: when(latest.checkedAt),
              })
            : '',
        }
      case 'update-available':
        return {
          title: t('status.updateAvailable.title', { latest: latest?.version ?? '' }),
          description: t('status.updateAvailable.description', { installed: build.version }),
          detail: t(
            status.change === 'prerelease'
              ? 'status.updateAvailable.candidate'
              : status.mayBreak
                ? 'status.updateAvailable.mayBreak'
                : 'status.updateAvailable.compatible',
          ),
        }
      case 'check-failed':
        return {
          title: t('status.checkFailed.title'),
          description: t('status.checkFailed.description', {
            reason: status.failure ? reason(status.failure) : '',
          }),
          detail: latest
            ? t('status.checkFailed.known', {
                latest: latest.version,
                when: when(latest.checkedAt),
              })
            : undefined,
        }
      case 'not-checked':
        return {
          title: t('status.notChecked.title'),
          description: t('status.notChecked.description'),
        }
      case 'development':
        return {
          title: t('status.development.title'),
          description: t('status.development.description', { version: build.version }),
        }
    }
  }
  const message = banner()

  const attempt = state.attempt
  const trigger = (value: 'manual' | 'periodic') => t(`details.triggers.${value}`)
  const lastCheck = !attempt
    ? t('details.never')
    : t(attempt.failure ? 'details.lastCheckFailed' : 'details.lastCheckValue', {
        when: when(attempt.at),
        trigger: trigger(attempt.trigger),
      })

  const rows: { label: string; value: string }[] = [
    { label: t('details.installed'), value: build.version },
    { label: t('details.build'), value: t(`details.builds.${kind}`) },
    ...(build.commit ? [{ label: t('details.commit'), value: build.commit.slice(0, 7) }] : []),
    {
      label: t('details.latest'),
      value: latest
        ? latest.publishedAt
          ? t('details.latestValue', { version: latest.version, when: when(latest.publishedAt) })
          : latest.version
        : t('details.latestUnknown'),
    },
    { label: t('details.lastCheck'), value: lastCheck },
    // A failed attempt did not erase the last good one: say when that was.
    ...(attempt?.failure && latest
      ? [{ label: t('details.lastSuccess'), value: when(latest.checkedAt) }]
      : []),
  ]

  return (
    <main className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <Alert
        role="status"
        variant={status.kind === 'check-failed' ? 'destructive' : 'default'}
        data-status={status.kind}
      >
        <Icon />
        <AlertTitle>{message.title}</AlertTitle>
        <AlertDescription>
          <p>{message.description}</p>
          {message.detail && <p>{message.detail}</p>}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t('details.title')}
            <Badge variant={kind === 'development' ? 'secondary' : 'outline'}>
              {t(`details.builds.${kind}`)}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[14rem_minmax(0,1fr)]">
            {rows.map(({ label, value }) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono break-words">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <form action={checkForUpdatesAction}>
              <CheckNowButton />
            </form>
            <ExternalLink href={latest ? releaseNotesUrl(latest.version) : RELEASES_URL}>
              {latest ? t('releaseNotes') : t('allReleases')}
            </ExternalLink>
            <ExternalLink href={UPDATE_GUIDE_URL}>{t('updateGuide')}</ExternalLink>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('periodic.title')}</CardTitle>
          <CardDescription>{t('periodic.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <PeriodicChecksForm enabled={config.periodicChecks} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('installing.title')}</CardTitle>
          <CardDescription>{t('installing.description')}</CardDescription>
        </CardHeader>
      </Card>
    </main>
  )
}
