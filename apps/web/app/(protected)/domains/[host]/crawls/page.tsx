import { CRAWL_TYPES } from '@seotools/core'
import { crawlBuildLine } from '@/lib/crawl-build'
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
import { InfoHelp } from '@/components/help'
import { RenderStamp } from '@/components/history/render-stamp'
import { CrawlRow } from '@/components/crawl/crawl-row'
import { isRenderedCrawl } from '@/lib/rendering'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('Crawls')
  return { title: t('metaTitle', { host }) }
}

/** Columns of the table: the six figures of a crawl and its actions. */
const COLUMNS = 7

/** A labelled group of the details of a crawl. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 border-b pb-4 last:border-b-0 last:pb-0">
      <h3 className="text-sm font-medium">{title}</h3>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">{children}</dl>
    </section>
  )
}

/** One label and its value in a section; a value the crawl does not have is not drawn at all. */
function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Every crawl of the domain, of any type, newest first, with what each one still has. */
export default async function CrawlsPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain, canEdit } = await requireDomain(host)
  const pairedTitle = (await getTranslations('PairedAnswers'))('title')
  const [t, tCrawl, tStamp, tRetry, format] = await Promise.all([
    getTranslations('Crawls'),
    getTranslations('Crawl'),
    getTranslations('CrawlHistory.stamp'),
    getTranslations('CrawlRetry'),
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
  const buildLine = (crawl: Crawl) =>
    crawlBuildLine(crawl, (key, values) => t(`build.${key}`, values))
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

      <Card className="gap-0 border py-0">
        <CardContent className="px-0 [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t('columns.date')}</TableHead>
                <TableHead>{t('columns.started')}</TableHead>
                <TableHead>{t('columns.mode')}</TableHead>
                <TableHead>{t('columns.state')}</TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center justify-end gap-0.5">
                    {t('columns.pages')}
                    <InfoHelp label={t('columns.pages')} compact>
                      {t('columns.pagesHelp')}
                    </InfoHelp>
                  </span>
                </TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center justify-end gap-0.5">
                    {t('columns.findings')}
                    <InfoHelp label={t('columns.findings')} compact>
                      {t('columns.findingsHelp')}
                    </InfoHelp>
                  </span>
                </TableHead>
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
                const error = crawlError(crawl)
                const opportunities = crawl.pagesWithType?.opportunity
                const retry = crawl.secondPass
                return (
                  <CrawlRow
                    key={crawl.id}
                    title={when(crawl)}
                    description={
                      <>
                        <span>{tCrawl(`type.${crawl.type}`)}</span>
                        <CrawlStatusBadge status={crawl.status} />
                      </>
                    }
                    cells={
                      <>
                        <TableCell>
                          <span className="grid gap-0.5">
                            <span className="flex items-center gap-2 text-sm font-medium">
                              {when(crawl)}
                              {crawl.id === latest?.id && <Badge>{t('latest')}</Badge>}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {tCrawl(`type.${crawl.type}`)}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {t(`trigger.${crawl.trigger}`)}
                        </TableCell>
                        <TableCell>
                          <RenderStamp crawl={crawl} detailed={false} />
                        </TableCell>
                        <TableCell>
                          <span title={error}>
                            <CrawlStatusBadge status={crawl.status} />
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {format.number(crawl.pagesCount)}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {crawl.pagesWithType ? (
                            `${format.number(crawl.pagesWithType.issue)} · ${format.number(crawl.pagesWithType.warning)}`
                          ) : (
                            <span
                              className="text-muted-foreground"
                              title={cancelled ? t('cancelledNotAnalysed') : undefined}
                            >
                              —
                            </span>
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
                      <div className="grid gap-4">
                        {cancelled && (
                          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                            {t('cancelledNotAnalysed')}
                          </p>
                        )}
                        {error && (
                          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                            {error}
                          </p>
                        )}
                        <Section title={t('sections.run')}>
                          <Item label={t('details.started')}>
                            {date(crawl.startedAt ?? crawl.createdAt)}
                          </Item>
                          {crawl.finishedAt && (
                            <Item label={t('details.finished')}>{date(crawl.finishedAt)}</Item>
                          )}
                          <Item label={t('details.version')}>{buildLine(crawl)}</Item>
                        </Section>
                        <Section title={t('sections.found')}>
                          <Item label={t('details.urls')}>{format.number(crawl.urlsCount)}</Item>
                          <Item label={t('details.external')}>
                            {format.number(crawl.externalCount)}
                          </Item>
                          {opportunities !== undefined && (
                            <Item label={t('details.opportunities')}>
                              {format.number(opportunities)}
                            </Item>
                          )}
                          {isBrowsable && (
                            <Item label={t('details.results')}>
                              {crawl.pruned ? (
                                <span title={tStamp('prunedHint')}>{tStamp('pruned')}</span>
                              ) : (
                                tStamp('retained')
                              )}
                            </Item>
                          )}
                        </Section>
                        {retry && retry.state !== 'pending' && (
                          <Section title={tRetry('title')}>
                            {retry.state === 'skipped' && (
                              <Item label={tRetry('status')}>
                                {retry.reason === 'limit'
                                  ? tRetry('skippedLimit', { limit: retry.limit })
                                  : tRetry('skippedRetryAfter')}
                              </Item>
                            )}
                            {(retry.state === 'done' ||
                              (retry.reason === 'retry-after' &&
                                retry.answered + retry.failed + retry.unconfirmed > 0)) && (
                              <>
                                <Item label={tRetry('requested')}>
                                  {format.number(retry.answered + retry.failed)}
                                </Item>
                                <Item label={tRetry('answered')}>
                                  {format.number(retry.answered)}
                                </Item>
                                <Item label={tRetry('failed')}>
                                  {format.number(retry.failed)}
                                  {retry.failed > 0 && isBrowsable && !crawl.pruned && (
                                    <>
                                      {' '}
                                      <Link
                                        href={detailHref(domain.host, detail, {
                                          crawl: crawl.id,
                                          view: 'errors',
                                        })}
                                        className="underline"
                                      >
                                        {tRetry('errors')}
                                      </Link>
                                    </>
                                  )}
                                </Item>
                                {retry.unconfirmed > 0 && (
                                  <Item label={tRetry('unconfirmed')}>
                                    {format.number(retry.unconfirmed)}
                                  </Item>
                                )}
                              </>
                            )}
                          </Section>
                        )}
                        {!cancelled && crawl.type === 'full' && (
                          <Section title={t('sections.analysis')}>
                            <Item label={t('details.rules')}>{rulesLabel(version)}</Item>
                            {isRenderedCrawl(crawl) && (
                              <Item label={t('details.rendering')}>
                                <RenderStamp crawl={crawl} showMode={false} />
                              </Item>
                            )}
                          </Section>
                        )}
                        {!cancelled && crawl.type !== 'full' && isRenderedCrawl(crawl) && (
                          <Section title={t('sections.analysis')}>
                            <Item label={t('details.rendering')}>
                              <RenderStamp crawl={crawl} showMode={false} />
                            </Item>
                          </Section>
                        )}
                        {crawl.type === 'full' && crawl.status === 'completed' && (
                          <section className="grid gap-2 text-sm">
                            <h3 className="text-sm font-medium">{pairedTitle}</h3>
                            <PairedNotice host={domain.host} crawl={crawl} lazyExamples />
                          </section>
                        )}
                      </div>
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
