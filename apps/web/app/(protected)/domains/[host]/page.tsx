import { Incidents } from '@/components/incidents'
import { auditResultsState } from '@seotools/core/crawl/audit'
import { compareWithPrevious } from '@seotools/db'
import { TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { AuditResultsNotice } from '@/components/audit/audit-notice'
import { ActiveCrawl } from '@/components/crawl/active-crawl'
import { StartCrawlButton } from '@/components/crawl/start-crawl-button'
import { Stat } from '@/components/stat'
import { DomainVitals } from '@/components/pages/domain-vitals'
import { RenderingSummary } from '@/components/pages/rendering-summary'
import { renderBrowserStatus } from '@/lib/render-browser'
import { isRenderedCrawl } from '@/lib/rendering'
import { IssueLabel, IssueMark } from '@/components/pages/issue-mark'
import { TrendCard } from '@/components/pages/trend-card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { dashboardDifference, trendFigures, trendNow, trendPoints } from '@/lib/dashboard'
import { crawlActivity } from '@/lib/crawl-activity'
import { getDb } from '@/lib/db'
import { homePriorities } from '@/lib/domain-home'
import { detailHref, parseDetailQuery } from '@/lib/pages-query'
import { cn } from '@/lib/utils'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

/** Full crawls the history goes back to. */
const HISTORY_CRAWLS = 100

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('Dashboard')
  return { title: t('metaTitle', { host }) }
}

/** The one dashboard of a domain: its last crawl, the figures, how they moved and what to fix. */
export default async function DomainDashboardPage({
  params,
}: {
  params: Promise<{ host: string }>
}) {
  const { host } = await params
  const { domain, canEdit } = await requireDomain(host)
  const [t, format] = await Promise.all([getTranslations('Dashboard'), getFormatter()])
  const db = await getDb()
  const incidents = await db.incidents.list(domain.id)
  const [active, activity, latest, crawls, config] = await Promise.all([
    db.crawls.active(domain.id),
    crawlActivity(db, domain.id),
    db.crawls.latestWithResults(domain.id, 'full'),
    db.crawls.list(domain.id, { type: 'full', limit: HISTORY_CRAWLS }),
    db.audit.config(domain.id),
  ])
  // Only the URL totals: the tiles' differences come from the crawls' own figures.
  const comparison =
    latest && !latest.pruned
      ? await compareWithPrevious({ db, target: latest, findings: false })
      : null
  const previousFigures = comparison?.base ? trendFigures(comparison.base) : null
  const delta = (
    key: 'crawled' | 'indexable' | 'issues' | 'warnings' | 'opportunities',
    value: number | null,
  ) => {
    const before = key === 'crawled' ? comparison?.base?.pagesCount : previousFigures?.[key]
    return dashboardDifference(before, value)
  }
  const state = auditResultsState(latest, config)
  const figures = latest ? trendFigures(latest) : null
  const points = trendPoints(crawls)
  const counts =
    latest && figures && state.kind === 'current' ? await db.crawls.issueCounts(latest.id) : []
  const priorities = homePriorities(latest, state, counts)
  const rendered = latest !== null && isRenderedCrawl(latest)
  const renderCounts =
    rendered && !latest.pruned
      ? (await db.crawls.renderCounts([latest.id])).get(latest.id)
      : undefined
  // A quiet hint, never a change: this domain reads served HTML while a browser could render it.
  const renderingAvailable =
    (await db.crawls.settings(domain.id)).renderingMode === 'http' &&
    (await renderBrowserStatus())?.state === 'ready'
  const now = trendNow()
  const query = parseDetailQuery({})
  const base = `/domains/${domain.host}`
  const number = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : format.number(value)

  const tiles = [
    { key: 'crawled', value: latest ? latest.pagesCount : null },
    { key: 'indexable', value: figures?.indexable ?? null },
    { key: 'issues', value: figures?.issues ?? null },
    { key: 'warnings', value: figures?.warnings ?? null },
    { key: 'opportunities', value: figures?.opportunities ?? null },
  ] as const

  return (
    <main className="grid gap-8">
      <Incidents open={incidents} />
      <h1 className="sr-only">{domain.host}</h1>

      {!latest && crawls.length === 0 && activity.state.kind === 'idle' && (
        <section
          aria-labelledby="first-crawl"
          className="grid justify-items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center"
        >
          <h2 id="first-crawl" className="text-base font-medium">
            {t('firstCrawl.title')}
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t(
              canEdit && !domain.archivedAt
                ? 'firstCrawl.description'
                : 'firstCrawl.viewerDescription',
            )}
          </p>
          {!domain.archivedAt && <StartCrawlButton host={domain.host} type="full" />}
        </section>
      )}

      {activity.state.kind !== 'idle' && (
        <ActiveCrawl host={domain.host} crawl={active} activity={activity.state} />
      )}

      {latest?.status === 'incomplete' && (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>{t('incomplete.title')}</AlertTitle>
          <AlertDescription>
            <p>
              {t('incomplete.description', { urls: latest.urlsCount })}{' '}
              <Link href={`${base}/settings/crawl`} className="underline">
                {t('incomplete.settings')}
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      )}

      <AuditResultsNotice host={domain.host} state={state} />

      <section aria-labelledby="figures" className="@container grid gap-3">
        <h2 id="figures" className="sr-only">
          {t('figures')}
        </h2>
        <div className="grid grid-cols-2 gap-4 @2xl:grid-cols-3 @4xl:grid-cols-5">
          {tiles.map(({ key, value }) => {
            const change = delta(key, value)
            return (
              <Stat
                key={key}
                label={t(`tiles.${key}`)}
                value={number(value)}
                change={
                  change !== null && (
                    <dd
                      className={cn(
                        'text-sm tabular-nums',
                        key === 'crawled' || key === 'indexable' || change === 0
                          ? 'text-muted-foreground'
                          : change < 0
                            ? 'text-green-700 dark:text-green-400'
                            : 'text-destructive',
                      )}
                    >
                      {format.number(change, { signDisplay: 'exceptZero' })}
                    </dd>
                  )
                }
                hint={
                  latest && !figures && key !== 'crawled'
                    ? t('notChecked')
                    : value === null && key !== 'crawled'
                      ? t('notAvailable')
                      : null
                }
              />
            )
          })}
        </div>
        {latest?.pagesAudit && latest.pagesAudit.unknownIndexability > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('unknownIndexability', { count: latest.pagesAudit.unknownIndexability })}
          </p>
        )}
      </section>

      {rendered && latest && !latest.pruned && (
        <RenderingSummary
          host={domain.host}
          crawl={latest}
          counts={renderCounts ?? undefined}
          issueCounts={counts}
          analysed={figures !== null && state.kind === 'current'}
        />
      )}

      {renderingAvailable && (
        <p className="text-sm text-muted-foreground">
          {t('renderingAvailable')}{' '}
          <Link href={`${base}/settings/crawl`} className="underline">
            {t('renderingAvailableLink')}
          </Link>
        </p>
      )}

      <DomainVitals crawls={crawls} domainId={domain.id} />

      {latest && figures && (
        <>
          {points.some((point) => point.indexable !== null) && (
            <TrendCard kind="indexable" series={['indexable']} points={points} now={now} compact />
          )}
          <TrendCard
            kind="findings"
            series={['issues', 'warnings', 'opportunities']}
            points={points}
            now={now}
          />
        </>
      )}

      <section aria-labelledby="priorities" className="grid gap-3">
        <h2 id="priorities" className="text-base font-medium">
          {t('prioritiesTitle')}
        </h2>
        {!latest ? (
          <p className="text-sm text-muted-foreground">{t('noCrawl')}</p>
        ) : priorities === null ? (
          <p className="text-sm text-muted-foreground">
            {t(
              latest.pruned
                ? 'pruned'
                : state.kind === 'pending' || state.kind === 'failed'
                  ? 'stale'
                  : 'notCheckedFindings',
            )}
          </p>
        ) : priorities.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noPriorities')}</p>
        ) : (
          <ul className="grid divide-y rounded-xl bg-card px-4 shadow-card ring-1 ring-foreground/10">
            {priorities.map(({ issue, pages }) => (
              <li key={issue}>
                <Link
                  href={detailHref(domain.host, query, { issue })}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md py-3 text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <IssueMark issue={issue} />
                  <IssueLabel issue={issue} />
                  <span className="ml-auto text-muted-foreground">
                    {t('affectedUrls', { count: pages })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {latest && (
          <Link href={`${base}/issues`} className="text-sm underline underline-offset-4">
            {t('allIssues')}
          </Link>
        )}
      </section>
    </main>
  )
}
