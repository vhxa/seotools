import { CRAWL_TYPES, buildIdentity, type BuildInfo } from '@seotools/core'
import { PairedNotice } from '@/components/crawl/paired-answers'
import type { Crawl, CrawlSchedule } from '@seotools/db'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { getFormatter, getTranslations } from 'next-intl/server'
import { ActiveCrawl } from '@/components/crawl/active-crawl'
import { CancelCrawlButton } from '@/components/crawl/cancel-crawl-button'
import { CrawlStatusBadge } from '@/components/crawl/crawl-status-badge'
import { CrawlsHeader } from '@/components/crawl/crawls-header'
import { ListCrawlDialog } from '@/components/crawl/list-crawl-dialog'
import { StartCrawlButton } from '@/components/crawl/start-crawl-button'
import { rulesStateOf } from '@/lib/rules-state'
import { crawlConfigVersion, crawlMoment } from '@/components/history/crawl-stamp'
import { RecheckBanner } from '@/components/verification/recheck-banner'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { compareHref, parseCompareQuery } from '@/lib/compare-query'
import { HISTORY_CRAWLS } from '@/lib/crawl-history'
import { crawlActivity } from '@/lib/crawl-activity'
import { getDb } from '@/lib/db'
import { detailHref, parseDetailQuery } from '@/lib/pages-query'
import { requireDomain } from '@/lib/workspace'
import { isBrowsableStatus } from '@seotools/core/crawl/compare'
import { RenderStamp } from '@/components/history/render-stamp'
import { CrawlRow } from '@/components/crawl/crawl-row'
import { isRenderedCrawl } from '@/lib/rendering'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('Crawls')
  return { title: t('metaTitle', { host }) }
}

/** Columns of the table: the short row's six and the actions. */
const COLUMNS = 7

function Detail({
  label,
  wide = false,
  children,
}: {
  label: string
  /** Takes the whole row of the details. */
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className={wide ? 'grid gap-0.5 sm:col-span-2 xl:col-span-3' : 'grid gap-0.5'}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Every crawl of the domain, of any type, newest first, with what each one still has. */
export default async function CrawlsPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain, canEdit } = await requireDomain(host)
  const pairedTitle = (await getTranslations('PairedAnswers'))('title')
  const [t, tCrawl, tStamp, format] = await Promise.all([
    getTranslations('Crawls'),
    getTranslations('Crawl'),
    getTranslations('CrawlHistory.stamp'),
    getFormatter(),
  ])
  const db = await getDb()
  const [active, activity, crawls, latest, config, schedules] = await Promise.all([
    db.crawls.active(domain.id),
    crawlActivity(db, domain.id),
    db.crawls.list(domain.id, { limit: HISTORY_CRAWLS }),
    db.crawls.latestWithResults(domain.id, 'full'),
    db.audit.config(domain.id),
    db.crawlSchedules.list(domain.id),
  ])

  const detail = parseDetailQuery({})
  const compare = parseCompareQuery({})
  const rulesLabel = (version: number | null) => {
    const state = rulesStateOf(version, config.version)
    return state === 'notAnalysed'
      ? tStamp('notAnalysed')
      : state === 'current'
        ? tStamp('rulesCurrent')
        : tStamp('rulesChanged')
  }
  const when = (crawl: Pick<Crawl, 'finishedAt' | 'createdAt'>) =>
    format.dateTime(crawlMoment(crawl), { dateStyle: 'medium', timeStyle: 'short' })
  const buildLabel = (build: BuildInfo | null | undefined) =>
    build?.channel === 'development'
      ? t('build.development')
      : (build?.version ?? t('build.unrecorded'))
  const buildLine = (crawl: Crawl) => {
    const run = crawl.runBuilds?.builds ?? []
    const analysis = crawl.analysisBuild
    const ranOnMultiple = run.length > 1 || crawl.runBuilds?.overflow
    const first = run[0]
    const label = ranOnMultiple ? t('build.multiple') : buildLabel(first)
    const version = crawl.runBuilds?.earlierRunUnrecorded
      ? t('build.withUnrecordedRun', { version: label })
      : label
    if (
      !analysis ||
      (first && !ranOnMultiple && buildIdentity(analysis) === buildIdentity(first))
    ) {
      return t('build.version', { version })
    }
    const different =
      first &&
      !crawl.runBuilds?.overflow &&
      !crawl.runBuilds?.earlierRunUnrecorded &&
      run.every((build) => buildIdentity(analysis) !== buildIdentity(build))
    return t(different ? 'build.withDifferentAnalysis' : 'build.withAnalysis', {
      version,
      analysis: buildLabel(analysis),
    })
  }
  function crawlError(crawl: Crawl) {
    switch (crawl.error) {
      case 'browser-unavailable':
        return t('browserUnavailable')
      case 'request-credentials-unavailable':
        return t('requestCredentialsUnavailable')
      default:
        return crawl.error ?? undefined
    }
  }
  // The ones the history can browse and compare: full crawls that finished with results.
  const browsable = (crawl: Crawl) => crawl.type === 'full' && isBrowsableStatus(crawl.status)

  const weekday = (day: number) =>
    format.dateTime(new Date(Date.UTC(2026, 0, 4 + day)), { weekday: 'long', timeZone: 'UTC' })
  const describe = (schedule: CrawlSchedule | undefined) =>
    schedule?.enabled
      ? t(`schedules.when.${schedule.frequency}`, {
          weekday: weekday(schedule.dayOfWeek),
          day: schedule.dayOfMonth,
          time: `${pad(schedule.hour)}:${pad(schedule.minute)}`,
          minute: pad(schedule.minute),
        })
      : t('schedules.none')
  const anySchedule = schedules.some((schedule) => schedule.enabled)
  const busy = active !== null || domain.archivedAt !== null

  return (
    <main className="grid gap-6">
      <CrawlsHeader
        host={domain.host}
        description={t('description')}
        actions={
          <div className="flex flex-wrap items-start gap-2">
            <StartCrawlButton host={domain.host} type="full" disabled={busy} />
            <StartCrawlButton
              host={domain.host}
              type="priority"
              variant="outline"
              disabled={busy}
            />
            <ListCrawlDialog host={domain.host} disabled={busy} />
          </div>
        }
      />

      {activity.state.kind !== 'idle' && (
        <ActiveCrawl host={domain.host} crawl={active} activity={activity.state} />
      )}
      <RecheckBanner host={domain.host} domainId={domain.id} />

      <p className="text-sm text-muted-foreground">
        {CRAWL_TYPES.map((type) => (
          <span key={type} className="mr-3 inline-block">
            {tCrawl(`type.${type}`)}: {describe(schedules.find((s) => s.type === type))}
          </span>
        ))}
        <Link
          href={`/domains/${domain.host}/settings/schedules`}
          className="font-medium text-foreground underline"
        >
          {anySchedule ? t('schedules.change') : t('schedules.set')}
        </Link>
      </p>

      <Card className="gap-0 py-0">
        <CardContent className="overflow-x-auto px-0 [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t('columns.crawl')}</TableHead>
                <TableHead>{t('columns.started')}</TableHead>
                <TableHead>{t('columns.mode')}</TableHead>
                <TableHead>{t('columns.state')}</TableHead>
                <TableHead>{t('columns.found')}</TableHead>
                <TableHead>{t('columns.findings')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {crawls.length === 0 && (
                <TableRow>
                  <TableCell colSpan={COLUMNS} className="text-center text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              )}
              {crawls.map((crawl, position) => {
                const isBrowsable = browsable(crawl)
                const previous = crawls
                  .slice(position + 1)
                  .find((candidate) => browsable(candidate) && !candidate.pruned)
                const version = crawl.type === 'full' ? crawlConfigVersion(crawl) : null
                const cancelled = crawl.status === 'cancelled'
                const date = (value: Date) =>
                  format.dateTime(value, { dateStyle: 'medium', timeStyle: 'short' })
                return (
                  <CrawlRow
                    key={crawl.id}
                    columns={COLUMNS}
                    cells={
                      <>
                        <TableCell className="align-top">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                            <span className="font-medium">{when(crawl)}</span>
                            <span className="text-muted-foreground">
                              {tCrawl(`type.${crawl.type}`)}
                            </span>
                            {crawl.id === latest?.id && <Badge>{t('latest')}</Badge>}
                          </span>
                        </TableCell>
                        <TableCell className="align-top text-sm text-muted-foreground">
                          {t(`trigger.${crawl.trigger}`)}
                        </TableCell>
                        <TableCell className="align-top">
                          <RenderStamp crawl={crawl} detailed={false} />
                        </TableCell>
                        <TableCell className="align-top">
                          <span
                            title={crawlError(crawl)}
                          >
                            <CrawlStatusBadge status={crawl.status} />
                          </span>
                        </TableCell>
                        <TableCell className="align-top text-sm tabular-nums">
                          {t('found', {
                            pages: format.number(crawl.pagesCount),
                            urls: format.number(crawl.urlsCount),
                          })}
                        </TableCell>
                        <TableCell className="align-top text-sm tabular-nums">
                          {crawl.pagesWithType ? (
                            t('findings', {
                              issues: format.number(crawl.pagesWithType.issue),
                              warnings: format.number(crawl.pagesWithType.warning),
                            })
                          ) : cancelled ? (
                            <span className="text-muted-foreground">
                              {t('cancelledNotAnalysed')}
                            </span>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                      </>
                    }
                    actions={
                      <>
                        {isBrowsable && !crawl.pruned && (
                          <Link
                            href={detailHref(domain.host, detail, {
                              crawl: crawl.id === latest?.id ? null : crawl.id,
                            })}
                            className="font-medium underline-offset-2 hover:underline"
                          >
                            {t('view')}
                          </Link>
                        )}
                        {isBrowsable && !crawl.pruned && previous && (
                          <Link
                            href={compareHref(domain.host, compare, {
                              from: previous.id,
                              to: crawl.id,
                            })}
                            className="text-muted-foreground underline-offset-2 hover:underline"
                          >
                            {t('compareWithPrevious')}
                          </Link>
                        )}
                        {canEdit && (crawl.status === 'pending' || crawl.status === 'running') && (
                          <CancelCrawlButton
                            host={domain.host}
                            crawlId={crawl.id}
                            variant="ghost"
                            size="xs"
                          >
                            {tCrawl('cancel')}
                          </CancelCrawlButton>
                        )}
                      </>
                    }
                    details={
                      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                        <Detail label={t('details.started')}>
                          {date(crawl.startedAt ?? crawl.createdAt)}
                        </Detail>
                        <Detail label={t('details.finished')}>
                          {crawl.finishedAt ? date(crawl.finishedAt) : '—'}
                        </Detail>
                        <Detail label={t('details.found')}>
                          {t('foundMore', {
                            pages: format.number(crawl.pagesCount),
                            urls: format.number(crawl.urlsCount),
                            external: format.number(crawl.externalCount),
                          })}
                        </Detail>
                        <Detail label={t('details.findings')}>
                          {crawl.pagesWithType
                            ? t('findingsAll', {
                                issues: format.number(crawl.pagesWithType.issue),
                                warnings: format.number(crawl.pagesWithType.warning),
                                opportunities: format.number(crawl.pagesWithType.opportunity),
                              })
                            : cancelled
                              ? t('cancelledNotAnalysed')
                              : '—'}
                        </Detail>
                        <Detail label={t('details.rules')}>
                          {cancelled
                            ? t('cancelledNotAnalysed')
                            : crawl.type === 'full'
                              ? rulesLabel(version)
                              : '—'}
                        </Detail>
                        <Detail label={t('details.results')}>
                          {!isBrowsable ? (
                            '—'
                          ) : crawl.pruned ? (
                            <Badge variant="secondary" title={tStamp('prunedHint')}>
                              {tStamp('pruned')}
                            </Badge>
                          ) : (
                            tStamp('retained')
                          )}
                        </Detail>
                        {isRenderedCrawl(crawl) && (
                          <Detail label={t('details.rendering')} wide>
                            <RenderStamp crawl={crawl} showMode={false} />
                          </Detail>
                        )}
                        {crawl.error && (
                          <Detail label={t('details.error')} wide>
                            {crawlError(crawl)}
                          </Detail>
                        )}
                        <div className="sm:col-span-2 xl:col-span-3">{buildLine(crawl)}</div>
                        {crawl.type === 'full' && crawl.status === 'completed' && (
                          <Detail label={pairedTitle} wide>
                            <PairedNotice host={domain.host} crawl={crawl} />
                          </Detail>
                        )}
                      </dl>
                    }
                  />
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="grid gap-1 text-xs text-muted-foreground">
        <p>
          {t('retention')}{' '}
          <Link href={`/domains/${domain.host}/settings/crawl`} className="underline">
            {t('settings')}
          </Link>
        </p>
        {crawls.length >= HISTORY_CRAWLS && <p>{t('capped', { count: HISTORY_CRAWLS })}</p>}
      </div>
    </main>
  )
}
