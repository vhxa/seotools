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
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { AuditResultsNotice } from '@/components/audit/audit-notice'
import { InfoHelp } from '@/components/help'
import { IssueRows } from '@/components/pages/issue-rows'
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
  const [t, tCatalog] = await Promise.all([
    getTranslations('Issues'),
    getTranslations('IssueCatalog'),
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
  const progress = new Map<string, number>()
  if (latest && checked)
    for (const row of counts)
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
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <Incidents
        open={incidents.filter((i) => !i.resolvedAt)}
        history={incidents.filter((i) => i.resolvedAt !== null)}
      />
      <section className="grid gap-2" aria-labelledby="site-findings">
        <h2 id="site-findings" className="text-lg font-medium">
          {t('site.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('site.description')}</p>
        {site.length === 0 && <p className="text-sm text-muted-foreground">{t('site.none')}</p>}
        <ul className="divide-y">
          {site.map((row) => (
            <li key={`${row.file}-${row.finding}`} className="py-2 text-sm">
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
      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="grid gap-1 text-sm">
          {t('filters.type')}
          <select
            aria-label={t('filters.type')}
            className={NATIVE_SELECT}
            name="type"
            defaultValue={type}
          >
            <option value="">{t('filters.all')}</option>
            {(['issue', 'warning', 'opportunity'] as const).map((value) => (
              <option key={value} value={value}>
                {tCatalog(`types.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          {t('filters.group')}
          <select
            aria-label={t('filters.group')}
            className={NATIVE_SELECT}
            name="group"
            defaultValue={group?.id ?? ''}
          >
            <option value="">{t('filters.all')}</option>
            {ISSUE_GROUPS.map((value) => (
              <option key={value.id} value={value.id}>
                {tCatalog(`groups.${value.id}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          {t('filters.search')}
          <Input
            aria-label={t('filters.search')}
            name="q"
            defaultValue={search}
            maxLength={200}
            className="w-56"
          />
        </label>
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
              <section key={importance} aria-labelledby={`importance-${importance}`}>
                <h2
                  id={`importance-${importance}`}
                  className="mb-2 flex items-center text-lg font-medium"
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
                        <span className="text-xs">
                          {decisions('counts', {
                            pending: pages,
                            progress: progress.get(issue) ?? 0,
                            dismissed: dismissedCounts.find((r) => r.issue === issue)?.pages ?? 0,
                          })}
                        </span>
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
              <h2 className="text-lg font-medium">{decisions('dismissed')}</h2>
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
          />
          {accepted.length > 0 && (
            <section aria-labelledby="accepted">
              <h2 id="accepted" className="mb-2 flex items-center text-lg font-medium">
                {t('accepted.title')}
                <InfoHelp label={t('accepted.title')}>{t('accepted.help')}</InfoHelp>
              </h2>
              <IssueRows
                rows={accepted}
                hrefOf={(issue) => detailHref(domain.host, query, { accepted: issue })}
                countLabel={(pages) => t('urls', { count: pages })}
              />
              <Link
                href={detailHref(domain.host, query, { accepted: ANY_ACCEPTED })}
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
