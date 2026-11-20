import { Incidents } from '@/components/incidents'
import { FindingStateActions } from '@/components/audit/finding-state-actions'
import { FindingStatesList } from '@/components/audit/finding-states-list'
import { issuePairReasons } from '@seotools/core/crawl/compare'
import { auditResultsState } from '@seotools/core/crawl/audit'
import { ANY_ACCEPTED } from '@seotools/core/crawl/acceptance'
import {
  isPageIssueId,
  ISSUE_GROUPS,
  ISSUE_IMPORTANCES,
  PAGE_ISSUES,
} from '@seotools/core/crawl/issues'
import { compareWithPrevious } from '@seotools/db'
import { SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { AuditResultsNotice } from '@/components/audit/audit-notice'
import { InfoHelp } from '@/components/help'
import { IssueRows } from '@/components/pages/issue-rows'
import { Stat } from '@/components/stat'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { siteFindings } from '@/lib/crawl-files'
import { compareHref, parseCompareQuery } from '@/lib/compare-query'
import { getDb } from '@/lib/db'
import { rankIssueCounts } from '@/lib/pages-issues'
import { detailHref, parseDetailQuery } from '@/lib/pages-query'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('Issues')
  return { title: t('metaTitle', { host }) }
}

/** A plain `<select>`, so the filters work as a GET form without script, styled like `Input`. */
const NATIVE_SELECT =
  'h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

/** Every finding of the latest full crawl, by importance, each leading to its URLs. */
export default async function IssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  const [t, tCatalog, tDashboard] = await Promise.all([
    getTranslations('Issues'),
    getTranslations('IssueCatalog'),
    getTranslations('Dashboard'),
  ])
  const db = await getDb()
  const incidents = await db.incidents.list(
    domain.id,
    new Date(new Date().getTime() - 30 * 86400000),
  )
  const [latest, config] = await Promise.all([
    db.crawls.latestWithResults(domain.id, 'full'),
    db.audit.config(domain.id),
  ])
  const raw = await searchParams
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)
  const type = first(raw.type) ?? ''
  const group = ISSUE_GROUPS.find((item) => item.id === first(raw.group))
  const search = (first(raw.q) ?? '').trim().slice(0, 200)
  const [names, filesText, compareText, format, files, settings, comparison] = await Promise.all([
    getTranslations('PageIssues'),
    getTranslations('CrawlFiles'),
    getTranslations('CrawlCompare'),
    getFormatter(),
    db.crawlFiles.list(domain.id, ['robots', 'sitemap', 'llms', 'security']),
    db.crawls.settings(domain.id),
    // Capped like the alerts: past the cap the counts are not shown, never shown short.
    latest && !latest.pruned ? compareWithPrevious({ db, target: latest }) : null,
  ])
  const site = siteFindings(
    {
      robots: files.filter((file) => file.kind === 'robots'),
      sitemap: files.filter((file) => file.kind === 'sitemap'),
      llms: files.filter((file) => file.kind === 'llms'),
      security: settings.optionalFiles.includes('security')
        ? files.filter((file) => file.kind === 'security')
        : null,
    },
    domain.host,
    new Date(),
  )
  const matches = (issue: string) =>
    isPageIssueId(issue) &&
    (!type || PAGE_ISSUES[issue].type === type) &&
    (!group || (group.categories as readonly string[]).includes(PAGE_ISSUES[issue].category)) &&
    names(`${issue}.name`).toLocaleLowerCase().includes(search.toLocaleLowerCase())
  const state = auditResultsState(latest, config)
  const checked = latest !== null && latest.pagesWithType !== null && !latest.pruned
  const [counts, acceptedCounts] =
    latest && checked
      ? await Promise.all([
          db.crawls.issueCounts(latest.id),
          db.crawls.acceptedCounts(latest.id, 'rule'),
        ])
      : [[], []]
  const issues = rankIssueCounts(
    counts.filter(
      (row) =>
        matches(row.issue) &&
        (row.pages > 0 || row.secondary > 0 || comparison?.byIssue.has(row.issue)),
    ),
  )
  const accepted = rankIssueCounts(acceptedCounts.filter((row) => matches(row.issue)))
  const dismissedCounts =
    latest && checked ? await db.crawls.acceptedCounts(latest.id, 'dismissal') : []
  const decisions = await getTranslations('FindingStates')
  // Only issues a person labelled: every other count is 0 without asking the database.
  const labelled = new Set(
    config.findingStates.filter((row) => row.state === 'in-progress').map((row) => row.issue),
  )
  const progress = new Map<string, number>()
  if (latest && checked)
    for (const row of counts.filter((r) => labelled.has(r.issue)))
      progress.set(
        row.issue,
        await db.crawls.countListed({
          crawlId: latest.id,
          view: 'all',
          issue: row.issue,
          state: 'in-progress',
        }),
      )
  const query = parseDetailQuery({})

  return (
    <main className="grid gap-8">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {latest && checked && (
        <section aria-labelledby="summary" className="@container grid gap-3">
          <h2 id="summary" className="sr-only">
            {t('summary')}
          </h2>
          <div className="grid gap-4 @xl:grid-cols-3">
            {(['issue', 'warning', 'opportunity'] as const).map((type) => (
              <Stat
                key={type}
                label={tDashboard(
                  `series.${type === 'issue' ? 'issues' : type === 'warning' ? 'warnings' : 'opportunities'}`,
                )}
                value={format.number(
                  counts.filter(
                    (row) =>
                      isPageIssueId(row.issue) &&
                      PAGE_ISSUES[row.issue].type === type &&
                      row.pages > 0,
                  ).length,
                )}
                hint={t('summaryHint', { count: latest.pagesWithType?.[type] ?? 0 })}
              />
            ))}
          </div>
        </section>
      )}

      <Incidents
        open={incidents.filter((i) => !i.resolvedAt)}
        history={incidents.filter((i) => i.resolvedAt !== null)}
      />
      {site.length > 0 && (
        <section className="grid gap-3" aria-labelledby="site-findings">
          <h2 id="site-findings" className="text-base font-medium">
            {t('site.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('site.description')}</p>
          <ul className="divide-y rounded-xl bg-card px-4 shadow-card ring-1 ring-foreground/10">
            {site.map((row) => (
              <li key={`${row.file}-${row.finding}`} className="py-3 text-sm">
                {row.severe && (
                  <Badge variant="destructive" className="mr-2">
                    {t('site.severe')}
                  </Badge>
                )}
                <Link
                  className="font-medium hover:underline"
                  href={`/domains/${domain.host}/crawl-files/${row.file}`}
                >
                  {filesText(
                    `${row.file === 'security' ? 'extra.security' : row.file}.findings.${row.finding}.title` as Parameters<
                      typeof filesText
                    >[0],
                  )}
                </Link>
                <p className="text-muted-foreground">
                  {filesText(
                    `${row.file === 'security' ? 'extra.security' : row.file}.findings.${row.finding}.description` as Parameters<
                      typeof filesText
                    >[0],
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('site.read', {
                    when: row.readAt
                      ? format.dateTime(row.readAt, { dateStyle: 'medium', timeStyle: 'short' })
                      : t('site.never'),
                  })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <form className="flex flex-wrap items-center gap-2" method="get" role="search">
        <div className="relative w-full sm:w-64">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t('filters.search')}
            placeholder={t('filters.search')}
            name="q"
            defaultValue={search}
            maxLength={200}
            className="pl-8"
          />
        </div>
        <select
          aria-label={t('filters.type')}
          className={NATIVE_SELECT}
          name="type"
          defaultValue={type}
        >
          <option value="">{t('filters.allTypes')}</option>
          {(['issue', 'warning', 'opportunity'] as const).map((value) => (
            <option key={value} value={value}>
              {tCatalog(`types.${value}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('filters.group')}
          className={NATIVE_SELECT}
          name="group"
          defaultValue={group?.id ?? ''}
        >
          <option value="">{t('filters.allGroups')}</option>
          {ISSUE_GROUPS.map((value) => (
            <option key={value.id} value={value.id}>
              {tCatalog(`groups.${value.id}`)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          {t('filters.apply')}
        </Button>
      </form>
      <AuditResultsNotice host={domain.host} state={state} />

      {!latest ? (
        <p className="text-sm text-muted-foreground">{t('noCrawl')}</p>
      ) : latest.pruned ? (
        <p className="text-sm text-muted-foreground">{t('pruned')}</p>
      ) : !checked ? (
        <p className="text-sm text-muted-foreground">{t('notChecked')}</p>
      ) : (
        <>
          {ISSUE_IMPORTANCES.map((importance) => {
            // What only non-indexable pages have goes after what is pending, keeping the rank.
            const found = issues
              .filter(({ issue }) => PAGE_ISSUES[issue].importance === importance)
              .sort((a, b) => Number(a.pages === 0) - Number(b.pages === 0))
            return (
              <section
                key={importance}
                aria-labelledby={`importance-${importance}`}
                className="grid gap-3"
              >
                <h2
                  id={`importance-${importance}`}
                  className="flex items-center text-base font-medium"
                >
                  {t(`importance.${importance}`)}
                  {importance === 'high' && (
                    <InfoHelp label={t('importanceLabel')}>
                      {tCatalog('importanceHelp')}{' '}
                      {(['issue', 'warning', 'opportunity'] as const)
                        .map((type) => tCatalog(`typeHelp.${type}`))
                        .join(' ')}
                    </InfoHelp>
                  )}
                </h2>
                {found.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('empty')}</p>
                ) : (
                  <IssueRows
                    extra={(issue, pages) => (
                      <>
                        {(() => {
                          const inProgress = progress.get(issue) ?? 0
                          const dismissed =
                            dismissedCounts.find((r) => r.issue === issue)?.pages ?? 0
                          const shown = [
                            ...(inProgress > 0
                              ? [decisions('inProgressCount', { count: inProgress })]
                              : []),
                            ...(dismissed > 0
                              ? [decisions('dismissedCount', { count: dismissed })]
                              : []),
                          ]
                          return shown.length > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              {shown.join(' · ')}
                            </span>
                          ) : null
                        })()}
                        <FindingStateActions host={host} issue={issue} />
                        {(latest.pagesAudit?.audited ?? 0) >= 20 &&
                          pages >= (latest.pagesAudit?.audited ?? 0) * 0.9 && (
                            <span
                              className="rounded border px-1 text-xs"
                              title={t('template.help')}
                            >
                              {t('template.label')}
                            </span>
                          )}
                        {comparison?.base && (
                          <span className="text-xs tabular-nums">
                            {comparison.cut ? (
                              <span title={t('changes.cut')}>{t('changes.unavailable')}</span>
                            ) : !comparison.findings ||
                              issuePairReasons(comparison.notes, issue).length > 0 ||
                              comparison.byIssue.get(issue)?.unverified ? (
                              <span
                                title={
                                  comparison.byIssue
                                    .get(issue)
                                    ?.reasons.map((reason) => compareText(`reasons.${reason}`))
                                    .join(', ') ||
                                  issuePairReasons(comparison.notes, issue)
                                    .map((reason) => compareText(`reasons.${reason}`))
                                    .join(' ')
                                }
                              >
                                {t('changes.unavailable')}
                              </span>
                            ) : (
                              (['fresh', 'resolved'] as const).map((kind) => (
                                <Link
                                  key={kind}
                                  className="mx-1 underline"
                                  href={compareHref(domain.host, parseCompareQuery({}), {
                                    from: comparison.base!.id,
                                    to: latest.id,
                                    issue,
                                    change: kind === 'fresh' ? 'gained' : 'lost',
                                  })}
                                >
                                  {t(`changes.${kind}`, {
                                    count: comparison.byIssue.get(issue)?.[kind] ?? 0,
                                  })}
                                </Link>
                              ))
                            )}
                          </span>
                        )}
                      </>
                    )}
                    rows={found}
                    hrefOf={(issue) => detailHref(domain.host, query, { issue })}
                    countLabel={(pages) => t('urls', { count: pages })}
                    secondaryLabel={(pages, alone) =>
                      t(alone ? 'secondaryOnly' : 'secondary', { count: pages })
                    }
                  />
                )}
              </section>
            )
          })}
          {dismissedCounts.some((r) => matches(r.issue)) && (
            <section className="grid gap-2">
              <h2 className="text-base font-medium">{decisions('dismissed')}</h2>
              <IssueRows
                rows={rankIssueCounts(dismissedCounts.filter((r) => matches(r.issue)))}
                hrefOf={(issue) => detailHref(host, query, { issue, state: 'dismissed' })}
                countLabel={(pages) => t('urls', { count: pages })}
              />
            </section>
          )}
          <FindingStatesList
            host={host}
            rows={config.findingStates.filter((row) => matches(row.issue))}
            limit={50}
          />
          {accepted.length > 0 && (
            <section aria-labelledby="accepted">
              <h2 id="accepted" className="flex items-center text-base font-medium">
                {t('accepted.title')}
                <InfoHelp label={t('accepted.title')}>{t('accepted.help')}</InfoHelp>
              </h2>
              <IssueRows
                rows={accepted}
                hrefOf={(issue) =>
                  detailHref(domain.host, query, { accepted: issue, acceptanceKind: 'rule' })
                }
                countLabel={(pages) => t('urls', { count: pages })}
              />
              <Link
                href={detailHref(domain.host, query, {
                  accepted: ANY_ACCEPTED,
                  acceptanceKind: 'rule',
                })}
                className="mt-2 inline-block text-sm underline-offset-4 hover:underline"
              >
                {t('accepted.viewAll')}
              </Link>
            </section>
          )}
        </>
      )}
    </main>
  )
}
