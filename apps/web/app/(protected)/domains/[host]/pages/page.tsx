import { ISSUE_TYPES, PAGE_ISSUES } from '@seotools/core/crawl/issues'
import type { Crawl } from '@seotools/db'
import { ChevronRightIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { ActiveCrawl } from '@/components/crawl/active-crawl'
import { StartCrawlButton } from '@/components/crawl/start-crawl-button'
import { IssueLabel, IssueMark, ISSUE_TYPE_STYLES } from '@/components/pages/issue-mark'
import { PagesChart, type PagesPoint } from '@/components/pages/pages-chart'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  const [t, tIssues, tCatalog, format] = await Promise.all([
    getTranslations('Pages'),
    getTranslations('PageIssues'),
    getTranslations('IssueCatalog'),
    getFormatter(),
  ])
  const db = await getDb()

  const [active, latest, crawls] = await Promise.all([
    db.crawls.active(domain.id),
    db.crawls.latestWithResults(domain.id, 'full'),
    db.crawls.list(domain.id, { type: 'full', limit: HISTORY_CRAWLS }),
  ])

  // Pages with something of each type, from a crawl that was checked for issues. A page with a
  // warning and an opportunity is in both. Indexable pages are the ones without issues, whatever
  // warnings or opportunities they have: those do not stop a page from being crawled or indexed.
  // Counts outlive the per-URL results, so crawls that were pruned still draw their point.
  const split = (crawl: Crawl) =>
    crawl.pagesWithType
      ? {
          indexable: Math.max(0, crawl.pagesCount - crawl.pagesWithType.issue),
          issues: crawl.pagesWithType.issue,
          warnings: crawl.pagesWithType.warning,
          opportunities: crawl.pagesWithType.opportunity,
        }
      : null
  const checked = latest !== null && split(latest) !== null
  const points: PagesPoint[] = crawls.flatMap((crawl) => {
    const figures = split(crawl)
    return (crawl.status === 'completed' || crawl.status === 'incomplete') && figures
      ? [{ at: (crawl.finishedAt ?? crawl.createdAt).getTime(), ...figures }]
      : []
  })
  points.sort((a, b) => a.at - b.at)
  const stats = (latest && split(latest)) || {
    indexable: null,
    issues: null,
    warnings: null,
    opportunities: null,
  }

  const counts = latest && checked ? await db.crawls.issueCounts(latest.id) : []
  const issues = rankIssueCounts(counts)
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
        <div className="flex items-center gap-6">
          <div className="grid justify-items-end">
            <span className="text-3xl leading-none font-semibold tabular-nums">
              {latest ? format.number(latest.pagesCount) : '—'}
            </span>
            <span className="text-xs text-muted-foreground">{t('stats.total')}</span>
          </div>
          <StartCrawlButton host={domain.host} type="full" disabled={active !== null} />
        </div>
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

      <PagesChart stats={stats} points={points} />

      {!latest || !checked ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {!latest ? t('issues.noCrawl') : t('issues.notChecked')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {ISSUE_TYPES.map((type) => {
            const { icon: Icon, text } = ISSUE_TYPE_STYLES[type]
            const found = issues.filter(({ issue }) => PAGE_ISSUES[issue].type === type)
            return (
              <Card key={type}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Icon aria-hidden className={`size-4 shrink-0 ${text}`} />
                    {t(`findings.${type}.title`)}
                  </CardTitle>
                  <CardDescription>{tCatalog(`typeHelp.${type}`)}</CardDescription>
                </CardHeader>
                <CardContent>
                  {found.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('findings.empty')}</p>
                  ) : (
                    <ul className="-mx-2 grid divide-y">
                      {found.map(({ issue, pages }) => (
                        <li key={issue}>
                          <Link
                            href={detailHref(domain.host, defaultQuery, { issue })}
                            className="flex items-center gap-4 rounded-md px-2 py-3 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            <div className="grid min-w-0 flex-1 gap-0.5">
                              <span className="flex items-center gap-2 text-sm font-medium">
                                <IssueLabel issue={issue} />
                                <IssueMark issue={issue} />
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
            )
          })}
          <p className="text-xs text-muted-foreground">{tCatalog('importanceHelp')}</p>
        </>
      )}
    </main>
  )
}
