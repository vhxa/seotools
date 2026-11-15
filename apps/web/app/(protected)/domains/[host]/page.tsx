import { Incidents } from '@/components/incidents'
import { auditResultsState } from '@seotools/core/crawl/audit'
import { compareWithPrevious } from '@seotools/db'
import { TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { AuditResultsNotice } from '@/components/audit/audit-notice'
import { ActiveCrawl } from '@/components/crawl/active-crawl'
import { CrawlStatusBadge } from '@/components/crawl/crawl-status-badge'
import { StartCrawlButton } from '@/components/crawl/start-crawl-button'
import { FavouriteDomainButton } from '@/components/favourite-domain-button'
import { InfoHelp } from '@/components/help'
import { DomainVitals } from '@/components/pages/domain-vitals'
import { RenderingSummary } from '@/components/pages/rendering-summary'
import { renderBrowserStatus } from '@/lib/render-browser'
import { isRenderedCrawl } from '@/lib/rendering'
import { IssueLabel, IssueMark } from '@/components/pages/issue-mark'
import { TrendChart } from '@/components/pages/trend-chart'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { compareHref, parseCompareQuery } from '@/lib/compare-query'
import { dashboardDifference, trendFigures, trendPoints } from '@/lib/dashboard'
import { getDb } from '@/lib/db'
import { homePriorities } from '@/lib/domain-home'
import { detailHref, parseDetailQuery } from '@/lib/pages-query'
import { requireViewer } from '@/lib/session'
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
  const viewer = await requireViewer()
  const favouriteDomainId = await db.userPreferences.favouriteDomainId(viewer.session.user.id)
  const [active, latest, crawls, config] = await Promise.all([
    db.crawls.active(domain.id),
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
  const compareText = await getTranslations('CrawlCompare')
  const delta = (
    key: 'crawled' | 'indexable' | 'issues' | 'warnings' | 'opportunities',
    value: number | null,
  ) => {
    const before = key === 'crawled' ? comparison?.base?.pagesCount : previousFigures?.[key]
    return dashboardDifference(before, value)
  }
  const state = auditResultsState(latest, config)
  const lastAttempt = crawls[0]
  const unsuccessful =
    lastAttempt && (lastAttempt.status === 'failed' || lastAttempt.status === 'cancelled')
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
  const query = parseDetailQuery({})
  const base = `/domains/${domain.host}`
  const number = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : format.number(value)
  const audited = latest?.pagesAudit?.audited ?? null

  const tiles = [
    { key: 'crawled', value: latest ? latest.pagesCount : null, base: null },
    { key: 'indexable', value: figures?.indexable ?? null, base: latest?.pagesCount ?? null },
    { key: 'issues', value: figures?.issues ?? null, base: audited },
    { key: 'warnings', value: figures?.warnings ?? null, base: audited },
    { key: 'opportunities', value: figures?.opportunities ?? null, base: audited },
  ] as const

  return (
    <main className="grid gap-8">
      <Incidents open={incidents} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold break-words">{domain.host}</h1>
            <FavouriteDomainButton host={domain.host} favourite={domain.id === favouriteDomainId} />
          </div>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {latest ? (
              <>
                <CrawlStatusBadge status={latest.status} />
                {t('lastCrawl', {
                  when: format.relativeTime(latest.finishedAt ?? latest.createdAt),
                })}
              </>
            ) : (
              t('neverCrawled')
            )}
          </p>
          {unsuccessful && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {t('lastAttempt')}
              <CrawlStatusBadge status={lastAttempt.status} />
              <Link href={`${base}/crawls`} className="underline">
                {t('jobs')}
              </Link>
            </p>
          )}
        </div>
        <StartCrawlButton
          host={domain.host}
          type="full"
          disabled={active !== null || domain.archivedAt !== null}
        />
      </div>

      {!latest && crawls.length === 0 && !active && (
        <section
          aria-labelledby="first-crawl"
          className="grid justify-items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center"
        >
          <h2 id="first-crawl" className="text-lg font-medium">
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

      {active && <ActiveCrawl host={domain.host} crawl={active} />}

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

      <section aria-labelledby="figures" className="grid gap-3">
        <h2 id="figures" className="flex items-center text-lg font-medium">
          {t('figures')}
          <InfoHelp label={t('figures')}>{t('figuresHelp')}</InfoHelp>
        </h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map(({ key, value, base: of }) => (
            <div key={key} className="grid min-w-0 content-start gap-0.5">
              <dt className="text-sm text-muted-foreground">{t(`tiles.${key}`)}</dt>
              <dd className="text-3xl font-semibold tabular-nums">{number(value)}</dd>
              {delta(key, value) !== null && (
                <dd
                  className={`text-xs tabular-nums ${key === 'crawled' || key === 'indexable' ? 'text-muted-foreground' : delta(key, value)! < 0 ? 'text-green-700 dark:text-green-400' : delta(key, value)! > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
                >
                  {format.number(delta(key, value)!, { signDisplay: 'exceptZero' })}
                </dd>
              )}
              <dd className="text-xs text-muted-foreground">
                {latest && !figures && key !== 'crawled'
                  ? t('notChecked')
                  : value === null && key !== 'crawled'
                    ? t('notAvailable')
                    : of === null
                      ? null
                      : t(key === 'indexable' ? 'ofCrawled' : 'ofAudited', { count: of })}
              </dd>
            </div>
          ))}
        </dl>
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

      {comparison?.base && latest && (
        <section className="grid gap-2">
          <h2 className="text-lg font-medium">{t('changesTitle')}</h2>
          {comparison.notes.some((note) => note === 'catalog' || note === 'audit') && (
            <p
              className="text-xs text-muted-foreground"
              title={comparison.notes
                .filter((note) => note === 'catalog' || note === 'audit')
                .map((note) => compareText(`notes.${note}.description`))
                .join(' ')}
            >
              {t('configurationChanged')}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{compareText('totals.description')}</p>
          <div className="flex flex-wrap gap-4 text-sm">
            {(['added', 'missing', 'gained', 'lost'] as const).map((change) => (
              <Link
                key={change}
                className="underline"
                href={compareHref(domain.host, parseCompareQuery({}), {
                  from: comparison.base!.id,
                  to: latest.id,
                  change,
                })}
              >
                {compareText(`changes.${change}`)}:{' '}
                {number(
                  change === 'added'
                    ? comparison.urls.added
                    : change === 'missing'
                      ? comparison.urls.missing
                      : comparison.urls[change],
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      <DomainVitals crawls={crawls} domainId={domain.id} />

      {latest && figures && (
        <section aria-labelledby="trend" className="grid gap-4">
          <h2 id="trend" className="text-lg font-medium">
            {t('trend')}
          </h2>
          <div className="grid gap-2">
            <h3 className="flex items-center text-sm font-medium">
              {t('trendFindings')}
              <InfoHelp label={t('trendFindings')}>{t('trendFindingsHelp')}</InfoHelp>
            </h3>
            <TrendChart series={['issues', 'warnings', 'opportunities']} points={points} />
          </div>
          {points.some((point) => point.indexable !== null) && (
            <div className="grid gap-2">
              <h3 className="flex items-center text-sm font-medium">
                {t('trendIndexable')}
                <InfoHelp label={t('trendIndexable')}>{t('trendIndexableHelp')}</InfoHelp>
              </h3>
              <TrendChart series={['indexable']} points={points} compact />
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="priorities" className="grid gap-2">
        <h2 id="priorities" className="text-lg font-medium">
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
          <ul className="grid divide-y">
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
