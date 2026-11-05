import { byAge } from '@seotools/core/crawl/compare'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { CrawlStatusBadge } from '@/components/crawl/crawl-status-badge'
import { PairPicker } from '@/components/history/pair-picker'
import { crawlConfigVersion, crawlMoment } from '@/components/history/crawl-stamp'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { compareHref, parseCompareQuery } from '@/lib/compare-query'
import { HISTORY_CRAWLS, browsableCrawls } from '@/lib/crawl-history'
import { getDb } from '@/lib/db'
import { detailHref, parseDetailQuery } from '@/lib/pages-query'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('CrawlHistory.list')
  return { title: t('metaTitle', { host }) }
}

/** Every full crawl of the domain with results, newest first, with what each one still has. */
export default async function CrawlHistoryPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  const [t, tStatus, tStamp, tPicker, format] = await Promise.all([
    getTranslations('CrawlHistory.list'),
    getTranslations('Crawl.status'),
    getTranslations('CrawlHistory.stamp'),
    getTranslations('CrawlHistory.picker'),
    getFormatter(),
  ])
  const db = await getDb()
  const [crawls, latest, config] = await Promise.all([
    browsableCrawls(db.crawls, domain.id),
    db.crawls.latestWithResults(domain.id, 'full'),
    db.audit.config(domain.id),
  ])

  const detail = parseDetailQuery({})
  const compare = parseCompareQuery({})
  const configLabel = (version: number | null) =>
    version === null
      ? tStamp('notAnalysed')
      : version === 0
        ? tStamp('configNone')
        : tStamp('config', { version })
  const when = (crawl: Parameters<typeof crawlMoment>[0]) =>
    format.dateTime(crawlMoment(crawl), { dateStyle: 'medium', timeStyle: 'short' })

  // The pair to start from: the newest crawl against the retained one before it.
  const retained = crawls.filter((crawl) => !crawl.pruned)
  const newest = retained[0]
  const before = newest ? retained.find((crawl) => byAge(crawl, newest) < 0) : undefined
  const options = crawls.map((crawl) => ({
    value: crawl.id,
    label: tPicker('option', {
      when: when(crawl),
      status: tStatus(crawl.status),
      coverage: crawl.pruned ? 'pruned' : 'retained',
      latest: crawl.id === latest?.id ? 'yes' : 'no',
    }),
  }))

  return (
    <main className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
      </div>

      {crawls.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {newest && before && (
            <Card>
              <CardHeader>
                <CardTitle>{t('compare.title')}</CardTitle>
                <CardDescription>{t('compare.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <PairPicker
                  host={domain.host}
                  query={compare}
                  options={options}
                  from={before.id}
                  to={newest.id}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.crawled')}</TableHead>
                    <TableHead>{t('columns.results')}</TableHead>
                    <TableHead>{t('columns.found')}</TableHead>
                    <TableHead>{t('columns.config')}</TableHead>
                    <TableHead>{t('columns.findings')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {crawls.map((crawl, position) => {
                    const previous = crawls
                      .slice(position + 1)
                      .find((candidate) => !candidate.pruned)
                    const version = crawlConfigVersion(crawl)
                    return (
                      <TableRow key={crawl.id}>
                        <TableCell className="align-top">
                          <div className="grid gap-1">
                            <span className="text-sm font-medium">{when(crawl)}</span>
                            <span className="flex flex-wrap gap-1">
                              <CrawlStatusBadge status={crawl.status} />
                              <span className="text-xs text-muted-foreground">
                                {t(`trigger.${crawl.trigger}`)}
                              </span>
                              {crawl.id === latest?.id && <Badge>{t('latest')}</Badge>}
                            </span>
                            <span className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs">
                              {!crawl.pruned && (
                                <Link
                                  href={detailHref(domain.host, detail, {
                                    crawl: crawl.id === latest?.id ? null : crawl.id,
                                  })}
                                  className="font-medium underline-offset-2 hover:underline"
                                >
                                  {t('view')}
                                </Link>
                              )}
                              {!crawl.pruned && previous && (
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
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          {crawl.pruned ? (
                            <Badge variant="secondary" title={tStamp('prunedHint')}>
                              {tStamp('pruned')}
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {tStamp('retained')}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-sm tabular-nums">
                          {t('found', {
                            pages: format.number(crawl.pagesCount),
                            urls: format.number(crawl.urlsCount),
                          })}
                        </TableCell>
                        <TableCell className="align-top text-sm">
                          <div className="grid gap-0.5">
                            <span>{configLabel(version)}</span>
                            {version !== null && version !== config.version && (
                              <span className="text-xs text-muted-foreground">
                                {t('configDiffers', { current: configLabel(config.version) })}
                              </span>
                            )}
                          </div>
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
        </>
      )}
    </main>
  )
}
