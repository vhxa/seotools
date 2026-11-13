import { CRAWL_TYPES } from '@seotools/core'
import type { Crawl, CrawlSchedule } from '@seotools/db'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { cancelCrawlAction } from '@/app/(protected)/domains/[host]/actions'
import { ActiveCrawl } from '@/components/crawl/active-crawl'
import { CrawlStatusBadge } from '@/components/crawl/crawl-status-badge'
import { CrawlsHeader } from '@/components/crawl/crawls-header'
import { ListCrawlDialog } from '@/components/crawl/list-crawl-dialog'
import { StartCrawlButton } from '@/components/crawl/start-crawl-button'
import { rulesStateOf } from '@/lib/rules-state'
import { crawlConfigVersion, crawlMoment } from '@/components/history/crawl-stamp'
import { RecheckBanner } from '@/components/verification/recheck-banner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { getDb } from '@/lib/db'
import { detailHref, parseDetailQuery } from '@/lib/pages-query'
import { requireDomain } from '@/lib/workspace'
import { isBrowsableStatus } from '@seotools/core/crawl/compare'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('Crawls')
  return { title: t('metaTitle', { host }) }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Every crawl of the domain, of any type, newest first, with what each one still has. */
export default async function CrawlsPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain, canEdit } = await requireDomain(host)
  const [t, tCrawl, tStamp, format] = await Promise.all([
    getTranslations('Crawls'),
    getTranslations('Crawl'),
    getTranslations('CrawlHistory.stamp'),
    getFormatter(),
  ])
  const db = await getDb()
  const [active, crawls, latest, config, schedules] = await Promise.all([
    db.crawls.active(domain.id),
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

      {active && <ActiveCrawl host={domain.host} crawl={active} />}
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

      <Card>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.crawl')}</TableHead>
                <TableHead>{t('columns.results')}</TableHead>
                <TableHead>{t('columns.found')}</TableHead>
                <TableHead>{t('columns.rules')}</TableHead>
                <TableHead>{t('columns.findings')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {crawls.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
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
                return (
                  <TableRow key={crawl.id}>
                    <TableCell className="align-top">
                      <div className="grid gap-1">
                        <span className="text-sm font-medium">
                          {tCrawl(`type.${crawl.type}`)} · {when(crawl)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t('started', {
                            when: format.dateTime(crawl.startedAt ?? crawl.createdAt, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }),
                          })}
                          {crawl.finishedAt && (
                            <>
                              {' '}
                              ·{' '}
                              {t('finished', {
                                when: format.dateTime(crawl.finishedAt, {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                }),
                              })}
                            </>
                          )}
                        </span>
                        <span className="flex flex-wrap items-center gap-1">
                          <span
                            title={
                              crawl.error === 'browser-unavailable'
                                ? t('browserUnavailable')
                                : (crawl.error ?? undefined)
                            }
                          >
                            <CrawlStatusBadge status={crawl.status} />
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t(`trigger.${crawl.trigger}`)}
                          </span>
                          {crawl.id === latest?.id && <Badge>{t('latest')}</Badge>}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs">
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
                          {canEdit &&
                            (crawl.status === 'pending' || crawl.status === 'running') && (
                              <form action={cancelCrawlAction.bind(null, domain.host, crawl.id)}>
                                <Button type="submit" variant="ghost" size="xs">
                                  {tCrawl('cancel')}
                                </Button>
                              </form>
                            )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      {!isBrowsable ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : crawl.pruned ? (
                        <Badge variant="secondary" title={tStamp('prunedHint')}>
                          {tStamp('pruned')}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">{tStamp('retained')}</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-sm tabular-nums">
                      {t('found', {
                        pages: format.number(crawl.pagesCount),
                        urls: format.number(crawl.urlsCount),
                        external: format.number(crawl.externalCount),
                      })}
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      {crawl.type === 'full' ? <span>{rulesLabel(version)}</span> : '—'}
                    </TableCell>
                    <TableCell className="align-top text-sm tabular-nums">
                      {crawl.pagesWithType
                        ? t('findings', {
                            issues: format.number(crawl.pagesWithType.issue),
                            warnings: format.number(crawl.pagesWithType.warning),
                            opportunities: format.number(crawl.pagesWithType.opportunity),
                          })
                        : '—'}
                    </TableCell>
                  </TableRow>
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
