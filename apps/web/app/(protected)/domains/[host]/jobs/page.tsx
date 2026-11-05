import { CRAWL_TYPES, type CrawlType } from '@seotools/core'
import type { CrawlSchedule } from '@seotools/db'
import Link from 'next/link'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { cancelCrawlAction } from '@/app/(protected)/domains/[host]/actions'
import { ActiveCrawl } from '@/components/crawl/active-crawl'
import { CrawlStatusBadge } from '@/components/crawl/crawl-status-badge'
import { ScheduleForm, type ScheduleFormValues } from '@/components/crawl/schedule-form'
import { StartCrawlButton } from '@/components/crawl/start-crawl-button'
import { RecheckBanner, recheckHref } from '@/components/verification/recheck-banner'
import { RecheckStatusBadge } from '@/components/verification/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

const HISTORY_SIZE = 20

/** What the form starts with before a schedule exists: priority pages get checked more often. */
const DEFAULT_SCHEDULES: Record<CrawlType, ScheduleFormValues> = {
  full: {
    enabled: false,
    frequency: 'weekly',
    time: '03:00',
    dayOfWeek: 1,
    dayOfMonth: 1,
    timeZone: null,
  },
  priority: {
    enabled: false,
    frequency: 'daily',
    time: '06:00',
    dayOfWeek: 1,
    dayOfMonth: 1,
    timeZone: null,
  },
}

const pad = (value: number) => String(value).padStart(2, '0')

function formValues(type: CrawlType, schedule: CrawlSchedule | undefined): ScheduleFormValues {
  if (!schedule) return DEFAULT_SCHEDULES[type]
  return {
    enabled: schedule.enabled,
    frequency: schedule.frequency,
    time: `${pad(schedule.hour)}:${pad(schedule.minute)}`,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    timeZone: schedule.timeZone,
  }
}

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('Jobs')
  return { title: t('metaTitle', { host }) }
}

export default async function JobsPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  const [t, tCrawl, tRecheck, format, locale] = await Promise.all([
    getTranslations('Jobs'),
    getTranslations('Crawl'),
    getTranslations('Verification.jobs'),
    getFormatter(),
    getLocale(),
  ])
  const db = await getDb()
  const [active, schedules, history, rechecks] = await Promise.all([
    db.crawls.active(domain.id),
    db.crawlSchedules.list(domain.id),
    db.crawls.list(domain.id, { limit: HISTORY_SIZE }),
    db.verifications.list(domain.id, { limit: HISTORY_SIZE }),
  ])

  return (
    <main className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
      </div>

      {active && <ActiveCrawl host={domain.host} crawl={active} />}
      <RecheckBanner host={domain.host} domainId={domain.id} />

      {CRAWL_TYPES.map((type) => {
        const schedule = schedules.find((s) => s.type === type)
        return (
          <Card key={type}>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="grid min-w-0 flex-1 gap-1">
                <CardTitle>{tCrawl(`type.${type}`)}</CardTitle>
                <CardDescription>{t(`typeDescriptions.${type}`)}</CardDescription>
              </div>
              <StartCrawlButton
                host={domain.host}
                type={type}
                variant="outline"
                disabled={active !== null || domain.archivedAt !== null}
              />
            </CardHeader>
            {/* Inert while archived: nothing runs on a schedule, and it cannot be changed. */}
            <CardContent className="grid gap-3" inert={domain.archivedAt !== null}>
              <ScheduleForm
                host={domain.host}
                type={type}
                locale={locale}
                values={formValues(type, schedule)}
              />
              {schedule && (
                <p className="text-sm text-muted-foreground">
                  {schedule.enabled &&
                    t('schedule.nextRun', {
                      when: format.dateTime(schedule.nextRunAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: schedule.timeZone,
                      }),
                    })}{' '}
                  {schedule.lastRunAt &&
                    schedule.lastOutcome &&
                    t(`schedule.lastOutcome.${schedule.lastOutcome}`, {
                      when: format.relativeTime(schedule.lastRunAt),
                    })}
                </p>
              )}
            </CardContent>
          </Card>
        )
      })}

      <Card>
        <CardHeader>
          <CardTitle>{t('history.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('history.type')}</TableHead>
                <TableHead>{t('history.status')}</TableHead>
                <TableHead>{t('history.trigger')}</TableHead>
                <TableHead>{t('history.started')}</TableHead>
                <TableHead className="text-right">{t('history.pages')}</TableHead>
                <TableHead className="text-right">{t('history.urls')}</TableHead>
                <TableHead className="text-right">{t('history.external')}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    {t('history.empty')}
                  </TableCell>
                </TableRow>
              )}
              {history.map((crawl) => (
                <TableRow key={crawl.id}>
                  <TableCell>{tCrawl(`type.${crawl.type}`)}</TableCell>
                  <TableCell title={crawl.error ?? undefined}>
                    <CrawlStatusBadge status={crawl.status} />
                  </TableCell>
                  <TableCell>{t(`history.triggers.${crawl.trigger}`)}</TableCell>
                  <TableCell>{format.relativeTime(crawl.startedAt ?? crawl.createdAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {format.number(crawl.pagesCount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {format.number(crawl.urlsCount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {format.number(crawl.externalCount)}
                  </TableCell>
                  <TableCell>
                    {(crawl.status === 'pending' || crawl.status === 'running') && (
                      <form action={cancelCrawlAction.bind(null, domain.host, crawl.id)}>
                        <Button type="submit" variant="ghost" size="sm">
                          {tCrawl('cancel')}
                        </Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{tRecheck('title')}</CardTitle>
          <CardDescription>{tRecheck('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tRecheck('status')}</TableHead>
                <TableHead>{tRecheck('started')}</TableHead>
                <TableHead className="text-right">{tRecheck('urls')}</TableHead>
                <TableHead>{tRecheck('error')}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rechecks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {tRecheck('empty')}
                  </TableCell>
                </TableRow>
              )}
              {rechecks.map((recheck) => (
                <TableRow key={recheck.id}>
                  <TableCell>
                    <RecheckStatusBadge status={recheck.status} />
                  </TableCell>
                  <TableCell>
                    {format.relativeTime(recheck.startedAt ?? recheck.createdAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {tRecheck('urlsDone', {
                      done: recheck.urlsDoneCount,
                      total: recheck.urlsCount,
                    })}
                  </TableCell>
                  <TableCell
                    className="max-w-xs truncate text-muted-foreground"
                    title={recheck.error ?? undefined}
                  >
                    {recheck.error ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={recheckHref(domain.host, recheck)}
                      className="text-sm underline-offset-4 hover:underline"
                    >
                      {tRecheck('view')}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  )
}
