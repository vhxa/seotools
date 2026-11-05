import { auditResultsState } from '@seotools/core/crawl/audit'
import { ANY_ACCEPTED } from '@seotools/core/crawl/acceptance'
import {
  ISSUE_IMPORTANCES,
  ISSUE_TYPES,
  PAGE_ISSUES,
  type PageIssueId,
} from '@seotools/core/crawl/issues'
import type { Crawl } from '@seotools/db'
import { ChevronRightIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { AuditResultsNotice } from '@/components/audit/audit-notice'
import { ActiveCrawl } from '@/components/crawl/active-crawl'
import { StartCrawlButton } from '@/components/crawl/start-crawl-button'
import { HelpDisclosure, InfoHelp } from '@/components/help'
import { IssueLabel, IssueMark } from '@/components/pages/issue-mark'
import { PagesChart, type PagesPoint } from '@/components/pages/pages-chart'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import { rankIssueCounts, type IssueCount } from '@/lib/pages-issues'
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

/** Findings with how many URLs have each, each row leading to those URLs. */
function IssueRows({
  rows,
  hrefOf,
  describe,
  documentation,
  count,
}: {
  rows: IssueCount[]
  hrefOf: (issue: PageIssueId) => string
  describe: (issue: PageIssueId) => string
  documentation: string
  count: (pages: number) => string
}) {
  return (
    <ul className="-mx-2 grid divide-y">
      {rows.map(({ issue, pages }) => (
        <li key={issue}>
          <div className="flex flex-wrap items-center gap-x-4 px-2 py-2">
            <Link
              href={hrefOf(issue)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              <IssueLabel issue={issue} />
              <IssueMark issue={issue} />
              <span className="ml-auto font-normal whitespace-nowrap tabular-nums">
                {count(pages)}
              </span>
              <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </Link>
            <HelpDisclosure title={documentation}>{describe(issue)}</HelpDisclosure>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default async function PagesOverviewPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  const [t, tIssues, tCatalog, format, tHelp] = await Promise.all([
    getTranslations('Pages'),
    getTranslations('PageIssues'),
    getTranslations('IssueCatalog'),
    getFormatter(),
    getTranslations('Help'),
  ])
  const db = await getDb()

  const [active, latest, crawls, config] = await Promise.all([
    db.crawls.active(domain.id),
    db.crawls.latestWithResults(domain.id, 'full'),
    db.crawls.list(domain.id, { type: 'full', limit: HISTORY_CRAWLS }),
    db.audit.config(domain.id),
  ])
  const results = auditResultsState(latest, config)

  // What a crawl found, apart. Indexable pages are the ones the crawl saw nothing in the way of, among
  // every page it crawled: they do not depend on the audit, and not having findings does not make a
  // page indexable (an excluded page has none). Issues, warnings and opportunities are the pages
  // that have something of each type among the audited ones; a page can be in several. Counts outlive
  // the per-URL results, so crawls that were pruned still draw their point. A crawl analysed before
  // indexability was kept has no figure for it, and none is made up.
  const split = (crawl: Crawl) =>
    crawl.pagesWithType
      ? {
          indexable: crawl.pagesAudit?.indexable ?? null,
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

  const [counts, acceptedCounts] =
    latest && checked
      ? await Promise.all([db.crawls.issueCounts(latest.id), db.crawls.acceptedCounts(latest.id)])
      : [[], []]
  const accepted = rankIssueCounts(acceptedCounts)
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
        <div className="flex flex-wrap items-center gap-6">
          {(
            [
              ['total', latest ? latest.pagesCount : null],
              ['audited', latest?.pagesAudit?.audited ?? null],
              ['excluded', latest?.pagesAudit?.excluded ?? null],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="grid justify-items-end">
              <span className="text-3xl leading-none font-semibold tabular-nums">
                {value === null ? '—' : format.number(value)}
              </span>
              <span className="text-xs text-muted-foreground">{t(`stats.${key}`)}</span>
            </div>
          ))}
          <StartCrawlButton
            host={domain.host}
            type="full"
            disabled={active !== null || domain.archivedAt !== null}
          />
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

      <AuditResultsNotice host={domain.host} state={results} />

      <PagesChart
        stats={stats}
        points={points}
        crawled={latest ? latest.pagesCount : null}
        audited={latest?.pagesAudit?.audited ?? null}
      />
      {latest?.pagesAudit && latest.pagesAudit.unknownIndexability > 0 && (
        <p className="-mt-3 text-xs text-muted-foreground">
          {t('stats.unknownIndexability', { count: latest.pagesAudit.unknownIndexability })}
        </p>
      )}

      {!latest || !checked ? (
        <p className="text-sm text-muted-foreground">
          {!latest ? t('issues.noCrawl') : t('issues.notChecked')}
        </p>
      ) : (
        <>
          {ISSUE_IMPORTANCES.map((importance) => {
            const found = issues.filter(({ issue }) => PAGE_ISSUES[issue].importance === importance)
            return (
              <Card key={importance}>
                <CardHeader>
                  <CardTitle>{t(`findings.${importance}`)}</CardTitle>
                </CardHeader>
                <CardContent>
                  {found.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('findings.empty')}</p>
                  ) : (
                    <IssueRows
                      rows={found}
                      hrefOf={(issue) => detailHref(domain.host, defaultQuery, { issue })}
                      describe={(issue) => tIssues(`${issue}.description`)}
                      documentation={tHelp('documentation')}
                      count={(pages) => t('issues.pages', { count: pages })}
                    />
                  )}
                </CardContent>
              </Card>
            )
          })}
          {accepted.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1">
                  {t('accepted.title')}
                  <InfoHelp label={t('accepted.title')}>{t('accepted.help')}</InfoHelp>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <IssueRows
                  rows={accepted}
                  hrefOf={(issue) => detailHref(domain.host, defaultQuery, { accepted: issue })}
                  describe={(issue) => tIssues(`${issue}.description`)}
                  documentation={tHelp('documentation')}
                  count={(pages) => t('issues.pages', { count: pages })}
                />
                <Link
                  href={detailHref(domain.host, defaultQuery, { accepted: ANY_ACCEPTED })}
                  className="text-sm underline-offset-4 hover:underline"
                >
                  {t('accepted.viewAll')}
                </Link>
              </CardContent>
            </Card>
          )}
          <HelpDisclosure title={tHelp('documentation')}>
            {tCatalog('importanceHelp')}{' '}
            {ISSUE_TYPES.map((type) => tCatalog(`typeHelp.${type}`)).join(' ')}
          </HelpDisclosure>
        </>
      )}
    </main>
  )
}
