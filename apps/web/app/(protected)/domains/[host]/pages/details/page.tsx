import { auditResultsState } from '@seotools/core/crawl/audit'
import { isPageIssueId } from '@seotools/core/crawl/issues'
import type { CrawlUrl, CrawlUrlAudit, CrawlUrlIssue } from '@seotools/db'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { AuditResultsNotice } from '@/components/audit/audit-notice'
import { CrawlBanner } from '@/components/history/crawl-banner'
import { CrawlSwitcher } from '@/components/history/crawl-switcher'
import { Pagination } from '@/components/pagination'
import { AuditFilters } from '@/components/pages/audit-filters'
import { HelpDisclosure } from '@/components/help'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { IssuesFilter } from '@/components/pages/issues-filter'
import { ListStatus } from '@/components/pages/list-status'
import { PagesTable, type PageRow } from '@/components/pages/pages-table'
import { UrlFilters } from '@/components/pages/url-filters'
import { RecheckBanner } from '@/components/verification/recheck-banner'
import { UrlDetail } from '@/components/pages/url-detail'
import { UrlDrawer } from '@/components/pages/url-drawer'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardDescription, CardHeader } from '@/components/ui/card'
import { ruleRefsOf } from '@/lib/audit-rules'
import { auditTabHref } from '@/lib/audit-tabs'
import { browsableCrawls, selectCrawl } from '@/lib/crawl-history'
import { automaticFileChecks } from '@/lib/automatic-checks'
import { getDb } from '@/lib/db'
import {
  activeFilters,
  DETAIL_VIEWS,
  PAGES_PAGE_SIZE,
  detailHref,
  filterAvailability,
  listingOf,
  parseDetailQuery,
  unappliedFilters,
} from '@/lib/pages-query'
import { loadUrlDetail } from '@/lib/url-detail'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('PagesDetails')
  return { title: t('metaTitle', { host }) }
}

const toRow = (
  url: CrawlUrl,
  issues: CrawlUrlIssue[],
  selectedIssue: string | null,
  priority: boolean,
  audit: CrawlUrlAudit | undefined,
  refOf: ReturnType<typeof ruleRefsOf>,
): PageRow => ({
  automaticCheck: false,
  urlHash: url.urlHash,
  url: url.url,
  title: url.title,
  kind: url.kind,
  statusCode: url.statusCode,
  error: url.error,
  depth: url.depth,
  responseTimeMs: url.responseTimeMs,
  bytes: url.bytes,
  contentType: url.contentType,
  redirectTo: url.redirectTo,
  issues: issues.map(({ issue }) => issue),
  issueDetails: issues.find(({ issue }) => issue === selectedIssue)?.details ?? [],
  priority,
  internal: url.scope === 'internal',
  participation: audit?.participation ?? null,
  participationRule: refOf(audit?.participationRule ?? null),
  intent: audit?.intent ?? null,
  intentRule: refOf(audit?.intentRule ?? null),
  conditions: audit?.conditions ?? {},
  indexability: audit?.indexability ?? null,
  blockers: audit?.blockers ?? [],
})

export default async function PagesDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { host } = await params
  const query = parseDetailQuery(await searchParams)
  const { domain } = await requireDomain(host)
  const [t, tIssues, tHistory, format] = await Promise.all([
    getTranslations('PagesDetails'),
    getTranslations('PageIssues'),
    getTranslations('CrawlHistory.details'),
    getFormatter(),
  ])
  const db = await getDb()

  // The crawl in the address, if it is one of this domain's; the latest one otherwise.
  const [selection, config, history] = await Promise.all([
    selectCrawl(db.crawls, domain.id, query.crawl),
    db.audit.config(domain.id),
    browsableCrawls(db.crawls, domain.id),
  ])
  if (selection.kind === 'missing') notFound()
  const selected = selection.kind === 'selected' ? selection.crawl : null
  const historical = selection.kind === 'selected' && selection.historical
  // A crawl whose results were pruned has its totals and no URLs to list.
  const browsable = selected !== null && !selected.pruned ? selected : null
  // An earlier crawl is not behind the rules: it keeps the ones it was analysed with.
  const results = historical ? ({ kind: 'current' } as const) : auditResultsState(selected, config)
  const ruleOfList = query.rule ? config.rules.find((rule) => rule.id === query.rule) : undefined

  // The audit has no state for a crawl analysed before it was kept: a filter on it would only list
  // nothing, which is not the same as there being no such URLs.
  const context = { auditData: browsable?.pagesAudit != null }
  const unapplied = unappliedFilters(query, context)
  const available = filterAvailability(query.view, context)

  let rows: PageRow[] = []
  let issueCounts: { issue: string; pages: number }[] = []
  let viewCounts: Awaited<ReturnType<typeof db.crawls.viewCounts>> | null = null
  let total = 0
  let page = 1
  let pageCount = 1
  if (browsable) {
    const listing = { crawlId: browsable.id, ...listingOf(query, unapplied) }
    if (browsable.pagesByWorstIssue !== null)
      issueCounts = await db.crawls.issueCounts(browsable.id)
    viewCounts = await db.crawls.viewCounts(browsable.id)
    total = await db.crawls.countListed(listing)
    pageCount = Math.max(1, Math.ceil(total / PAGES_PAGE_SIZE))
    page = Math.min(query.page, pageCount)
    const [urls, priorityUrls] = await Promise.all([
      db.crawls.listUrls({
        ...listing,
        limit: PAGES_PAGE_SIZE,
        offset: (page - 1) * PAGES_PAGE_SIZE,
        ...(query.sort ? { sort: query.sort, direction: query.direction } : {}),
      }),
      db.priorityUrls.list(domain.id),
    ])
    const hashes = urls.map((url) => url.urlHash)
    const [issues, audits, automaticChecks] = await Promise.all([
      db.crawls.issuesOf(browsable.id, hashes),
      db.crawls.auditOf(browsable.id, hashes),
      automaticFileChecks(db.crawls, browsable.id, urls),
    ])
    const auditByUrl = new Map(audits.map((audit) => [audit.urlHash, audit]))
    const refOf = ruleRefsOf(browsable.auditSnapshot)
    const issuesByUrl = new Map<string, CrawlUrlIssue[]>()
    for (const issue of issues) {
      issuesByUrl.set(issue.urlHash, [...(issuesByUrl.get(issue.urlHash) ?? []), issue])
    }
    const priorities = new Set(priorityUrls.map((p) => p.urlHash))
    rows = urls.map((url) => ({
      ...toRow(
        url,
        issuesByUrl.get(url.urlHash) ?? [],
        query.issue,
        priorities.has(url.urlHash),
        auditByUrl.get(url.urlHash),
        refOf,
      ),
      automaticCheck: automaticChecks.has(url.urlHash),
    }))
  }

  // The drawer: the URL in the address, if the crawl has it.
  const open =
    browsable && query.url
      ? await loadUrlDetail({
          domainId: domain.id,
          host: domain.host,
          crawl: browsable,
          urlHash: query.url,
          historical,
        })
      : null
  const latestId = selection.kind === 'selected' ? (selection.latest?.id ?? null) : null
  // The latest crawl is what an address without a crawl shows, so it needs none.
  const hrefForCrawl = (id: string) =>
    detailHref(host, query, { crawl: id === latestId ? null : id, page: 1, url: null })

  return (
    <main
      data-wide
      className={
        browsable
          ? 'flex h-[calc(100svh-5rem)] min-h-0 flex-col gap-4 md:h-[calc(100svh-7rem)]'
          : 'grid gap-6'
      }
    >
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          {!selected && <p className="text-sm text-muted-foreground">{t('neverCrawled')}</p>}
        </div>
      </div>
      {selected && (
        <>
          <CrawlBanner
            crawl={selected}
            historical={historical}
            currentVersion={config.version}
            latestHref={
              historical ? detailHref(host, query, { crawl: null, page: 1, url: null }) : null
            }
            picker={
              browsable ? null : (
                <CrawlSwitcher
                  crawls={history}
                  selected={selected}
                  latestId={latestId}
                  hrefFor={(crawl) => hrefForCrawl(crawl.id)}
                />
              )
            }
          />
        </>
      )}

      <AuditResultsNotice host={domain.host} state={results} />
      <RecheckBanner host={domain.host} domainId={domain.id} />

      {selected?.pruned && (
        <Card>
          <CardHeader>
            <CardDescription className="text-foreground">
              {tHistory('prunedBody', {
                pages: format.number(selected.pagesCount),
                urls: format.number(selected.urlsCount),
              })}{' '}
              <Link href={`/domains/${domain.host}/settings/crawl`} className="underline">
                {tHistory('prunedSettings')}
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {browsable && (
        <>
          <TooltipProvider delay={1200} timeout={800}>
            <nav aria-label={t('viewsLabel')} className="flex shrink-0 flex-wrap gap-1">
              {/* Addresses made when "other" was a view of its own still open it, and it shows. */}
              {[...DETAIL_VIEWS, ...(query.view === 'other' ? (['other'] as const) : [])].map(
                (view) => (
                  <Tooltip key={view}>
                    <TooltipTrigger
                      render={
                        <Link
                          href={detailHref(host, query, { view, page: 1, url: null })}
                          scroll={false}
                          aria-current={view === query.view ? 'page' : undefined}
                          className={buttonVariants({
                            variant: view === query.view ? 'secondary' : 'ghost',
                            size: 'sm',
                          })}
                        />
                      }
                    >
                      {t(`views.${view}`)}
                      <span className="text-muted-foreground tabular-nums">
                        {format.number(viewCounts?.[view] ?? 0)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t(`viewHints.${view}`)}</TooltipContent>
                  </Tooltip>
                ),
              )}
            </nav>
          </TooltipProvider>
          <UrlDrawer
            host={domain.host}
            query={{ ...query, page }}
            current={open ? { hash: open.url.urlHash, url: open.url.url } : null}
            detail={
              open ? (
                <UrlDetail
                  host={domain.host}
                  data={open}
                  context={
                    <CrawlBanner
                      crawl={browsable}
                      historical={historical}
                      currentVersion={config.version}
                      latestHref={
                        historical ? detailHref(host, query, { crawl: null, page: 1 }) : null
                      }
                      picker={
                        <CrawlSwitcher
                          crawls={history}
                          selected={browsable}
                          latestId={latestId}
                          hrefFor={(crawl) =>
                            detailHref(host, query, {
                              crawl: crawl.id === latestId ? null : crawl.id,
                              page: 1,
                            })
                          }
                        />
                      }
                    />
                  }
                  hrefFor={(urlHash) => detailHref(host, query, { url: urlHash })}
                />
              ) : null
            }
          >
            <PagesTable
              key={[
                browsable.id,
                query.view,
                page,
                query.sort,
                query.direction,
                query.search,
                query.issue,
                query.status,
                query.type,
                query.indexability,
                query.participation,
                query.intent,
                query.rule,
              ].join('|')}
              host={domain.host}
              rows={rows}
              query={{ ...query, page }}
              analysed={browsable.pagesByWorstIssue !== null}
              analysis={
                <CrawlSwitcher
                  crawls={history}
                  selected={browsable}
                  latestId={latestId}
                  hrefFor={(crawl) => hrefForCrawl(crawl.id)}
                />
              }
              filters={
                <>
                  <UrlFilters
                    stacked
                    host={domain.host}
                    query={{ ...query, page: 1 }}
                    typeUnavailable={available.type ?? undefined}
                  />
                  <AuditFilters
                    stacked
                    host={domain.host}
                    query={{ ...query, page: 1 }}
                    unavailable={available.audit ?? undefined}
                    {...(ruleOfList ? { rulesHref: auditTabHref(domain.host, 'rules') } : {})}
                  />
                  {query.issue && isPageIssueId(query.issue) && (
                    <HelpDisclosure title={tIssues(`${query.issue}.name`)}>
                      {tIssues(`${query.issue}.description`)} {t('issueScope')}
                    </HelpDisclosure>
                  )}
                </>
              }
              status={
                activeFilters(query).length > 0 ? (
                  <ListStatus
                    host={domain.host}
                    query={{ ...query, page: 1 }}
                    unapplied={unapplied}
                    matching={total}
                    inView={viewCounts?.[query.view] ?? 0}
                    inCrawl={viewCounts?.all ?? 0}
                  />
                ) : null
              }
              issues={
                <IssuesFilter
                  host={domain.host}
                  query={{ ...query, page }}
                  pages={browsable.pagesCount}
                  counts={issueCounts}
                  checked={browsable.pagesByWorstIssue !== null}
                />
              }
              footer={
                <Pagination
                  page={page}
                  pageCount={pageCount}
                  href={(next) => detailHref(host, query, { page: next, url: null })}
                  details={<span>{t('rowsShown', { shown: rows.length, matching: total })}</span>}
                />
              }
            />
          </UrlDrawer>
        </>
      )}
    </main>
  )
}
