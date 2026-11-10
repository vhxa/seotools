import { CRAWL_TYPES } from '@seotools/core'
import Link from 'next/link'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { ScheduleForm } from '@/components/crawl/schedule-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { scheduleFormValues } from '@/lib/crawl-schedule'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('Schedules')
  return { title: t('metaTitle', { host }) }
}

/** When each type of crawl runs by itself. Running one now is on the Crawls page. */
export default async function SchedulesSettingsPage({
  params,
}: {
  params: Promise<{ host: string }>
}) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  const [t, tCrawl, format, locale] = await Promise.all([
    getTranslations('Schedules'),
    getTranslations('Crawl'),
    getFormatter(),
    getLocale(),
  ])
  const schedules = await (await getDb()).crawlSchedules.list(domain.id)

  return (
    <>
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('description')}{' '}
          <Link href={`/domains/${domain.host}/crawls`} className="underline">
            {t('toCrawls')}
          </Link>
        </p>
      </div>
      {CRAWL_TYPES.map((type) => {
        const schedule = schedules.find((s) => s.type === type)
        return (
          <Card key={type}>
            <CardHeader>
              <CardTitle>{tCrawl(`type.${type}`)}</CardTitle>
              <CardDescription>{t(`typeDescriptions.${type}`)}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <ScheduleForm
                host={domain.host}
                type={type}
                locale={locale}
                values={scheduleFormValues(type, schedule)}
              />
              {schedule && (
                <p className="text-sm text-muted-foreground">
                  {schedule.enabled &&
                    t('form.nextRun', {
                      when: format.dateTime(schedule.nextRunAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: schedule.timeZone,
                      }),
                    })}{' '}
                  {schedule.lastRunAt &&
                    schedule.lastOutcome &&
                    t(`form.lastOutcome.${schedule.lastOutcome}`, {
                      when: format.relativeTime(schedule.lastRunAt),
                    })}
                </p>
              )}
            </CardContent>
          </Card>
        )
      })}
    </>
  )
}
