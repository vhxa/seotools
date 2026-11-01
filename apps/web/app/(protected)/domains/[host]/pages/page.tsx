import { PAGE_ISSUES } from '@seotools/core/crawl/issues'
import { ChevronRightIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { ActiveCrawl } from '@/components/crawl/active-crawl'
import { StartCrawlButton } from '@/components/crawl/start-crawl-button'
import { PagesChart, type PagesPoint } from '@/components/pages/pages-chart'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import { rankIssueCounts } from '@/lib/pages-issues'
import { detailHref, parseDetailQuery } from '@/lib/pages-query'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

/** Full crawls the history goes back to. */
const HISTORY_CRAWLS = 100

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('Pages')
  return { title: t('metaTitle', { host }) }
}

export default async function PagesOverviewPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  const [t, tIssues, format] = await Promise.all([
    getTranslations('Pages'),
    getTranslations('PageIssues'),
    getFormatter(),
  ])
  const db = await getDb()

  const [active, latest, crawls] = await Promise.all([
    db.crawls.active(domain.id),
    db.crawls.latestWithResults(domain.id, 'full'),
    db.crawls.list(domain.id, { type: 'full', limit: HISTORY_CRAWLS }),
  ])

  // The pages of a crawl that was checked for issues. Counts outlive the per-URL results, so
  // crawls that were pruned still draw their point.
  const checked = (latest?.pagesWithIssuesCount ?? null) !== null
  const withIssues = latest?.pagesWithIssuesCount ?? 0
  const points: PagesPoint[] = crawls
    .filter(
      (crawl) =>
        (crawl.status === 'completed' || crawl.status === 'incomplete') &&
        crawl.pagesWithIssuesCount !== null,
    )
    .map((crawl) => ({
      at: (crawl.finishedAt ?? crawl.createdAt).getTime(),
      correct: Math.max(0, crawl.pagesCount - (crawl.pagesWithIssuesCount ?? 0)),
      issues: crawl.pagesWithIssuesCount ?? 0,
    }))
    .sort((a, b) => a.at - b.at)

  const counts = latest && checked ? await db.crawls.issueCounts(latest.id) : []
  const issues = rankIssueCounts(counts)
  const tSeverity = await getTranslations('Pages.issues.severity')
  const defaultQuery = parseDetailQuery({})

  return (
    <main className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {latest?.finishedAt
              ? t('lastCrawl', { when: format.relativeTime(latest.finishedAt) })
              : t('neverCrawled')}
          </p>
        </div>
        <StartCrawlButton host={domain.host} type="full" disabled={active !== null} />
      </div>

      {active && <ActiveCrawl host={domain.host} crawl={active} />}

      {latest?.status === 'incomplete' && (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>{t('incomplete.title')}</AlertTitle>
          <AlertDescription>
            <p>
              {t('incomplete.description', { urls: latest.urlsCount })}{' '}
              <Link href={`/domains/${domain.host}/settings/crawl`} className="underline">
                {t('incomplete.settings')}
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      )}

      <PagesChart
        stats={{
          total: latest ? latest.pagesCount : null,
          correct: latest && checked ? Math.max(0, latest.pagesCount - withIssues) : null,
          issues: latest && checked ? withIssues : null,
        }}
        points={points}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('issues.title')}</CardTitle>
          <CardDescription>{t('issues.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {!latest ? (
            <p className="text-sm text-muted-foreground">{t('issues.noCrawl')}</p>
          ) : !checked ? (
            <p className="text-sm text-muted-foreground">{t('issues.notChecked')}</p>
          ) : issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('issues.empty')}</p>
          ) : (
            <ul className="-mx-2 grid divide-y">
              {issues.map(({ issue, pages }) => (
                <li key={issue}>
                  <Link
                    href={detailHref(domain.host, defaultQuery, { issue })}
                    className="flex items-center gap-4 rounded-md px-2 py-3 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {tIssues(`${issue}.name`)}
                        <Badge
                          variant={
                            PAGE_ISSUES[issue].severity === 'error' ? 'destructive' : 'secondary'
                          }
                        >
                          {tSeverity(PAGE_ISSUES[issue].severity)}
                        </Badge>
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {tIssues(`${issue}.description`)}
                      </span>
                    </div>
                    <span className="text-sm whitespace-nowrap tabular-nums">
                      {t('issues.pages', { count: pages })}
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
