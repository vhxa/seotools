import type { CrawlUrl } from '@seotools/db'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { Pagination } from '@/components/pagination'
import { IssuesFilter } from '@/components/pages/issues-filter'
import { PagesTable, type PageRow } from '@/components/pages/pages-table'
import { UrlDetail } from '@/components/pages/url-detail'
import { UrlDrawer } from '@/components/pages/url-drawer'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import {
  DETAIL_VIEWS,
  PAGES_PAGE_SIZE,
  detailHref,
  parseDetailQuery,
  type DetailQuery,
} from '@/lib/pages-query'
import { loadUrlDetail } from '@/lib/url-detail'
import { cn } from '@/lib/utils'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('PagesDetails')
  return { title: t('metaTitle', { host }) }
}

const toRow = (url: CrawlUrl, issues: string[], priority: boolean): PageRow => ({
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
  issues,
  priority,
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
  const [t, format] = await Promise.all([getTranslations('PagesDetails'), getFormatter()])
  const db = await getDb()

  const latest = await db.crawls.latestWithResults(domain.id, 'full')

  const viewCount = (view: DetailQuery['view']) => {
    if (!latest) return 0
    if (view === 'pages') return latest.pagesCount
    if (view === 'external') return latest.externalCount
    return latest.urlsCount - latest.pagesCount
  }

  let rows: PageRow[] = []
  let issueCounts: { issue: string; pages: number }[] = []
  let total = 0
  let page = 1
  let pageCount = 1
  if (latest) {
    const listing = {
      crawlId: latest.id,
      view: query.view,
      ...(query.search ? { search: query.search } : {}),
      ...(query.issue ? { issue: query.issue } : {}),
    }
    if (latest.pagesWithIssuesCount !== null) issueCounts = await db.crawls.issueCounts(latest.id)
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
    const issues = await db.crawls.issuesOf(
      latest.id,
      urls.map((url) => url.urlHash),
    )
    const issuesByUrl = new Map<string, string[]>()
    for (const { urlHash, issue } of issues) {
      issuesByUrl.set(urlHash, [...(issuesByUrl.get(urlHash) ?? []), issue])
    }
    const priorities = new Set(priorityUrls.map((p) => p.urlHash))
    rows = urls.map((url) =>
      toRow(url, issuesByUrl.get(url.urlHash) ?? [], priorities.has(url.urlHash)),
    )
  }

  // The drawer: the URL in the address, if the crawl has it.
  const open =
    latest && query.url
      ? await loadUrlDetail({
          domainId: domain.id,
          crawl: latest,
          urlHash: query.url,
          linkLimit: 10,
        })
      : null

  return (
    <main data-wide className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {latest ? t('description') : t('neverCrawled')}
        </p>
      </div>

      {latest && (
        <div
          className={cn(
            'grid items-start gap-4',
            query.view === 'pages' && 'xl:grid-cols-[minmax(0,1fr)_16rem]',
          )}
        >
          <Card>
            <CardHeader className="gap-3">
              <nav aria-label={t('viewsLabel')} className="flex flex-wrap gap-1">
                {DETAIL_VIEWS.map((view) => (
                  <Link
                    key={view}
                    href={detailHref(host, query, {
                      view,
                      page: 1,
                      issue: null,
                      sort: null,
                      url: null,
                    })}
                    aria-current={view === query.view ? 'page' : undefined}
                    className={buttonVariants({
                      variant: view === query.view ? 'secondary' : 'ghost',
                      size: 'sm',
                    })}
                  >
                    {t(`views.${view}`)}
                    <span className="text-muted-foreground tabular-nums">
                      {format.number(viewCount(view))}
                    </span>
                  </Link>
                ))}
              </nav>
              <CardDescription>{t(`viewHints.${query.view}`)}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <UrlDrawer
                host={domain.host}
                query={{ ...query, page }}
                current={open ? { hash: open.url.urlHash, url: open.url.url } : null}
                detail={
                  open ? (
                    <UrlDetail
                      host={domain.host}
                      data={open}
                      hrefFor={(urlHash) => detailHref(host, query, { url: urlHash })}
                    />
                  ) : null
                }
              >
                <PagesTable
                  key={[
                    query.view,
                    page,
                    query.sort,
                    query.direction,
                    query.search,
                    query.issue,
                  ].join('|')}
                  host={domain.host}
                  rows={rows}
                  total={total}
                  query={{ ...query, page }}
                />
              </UrlDrawer>
              <Pagination
                page={page}
                pageCount={pageCount}
                href={(next) => detailHref(host, query, { page: next, url: null })}
              />
            </CardContent>
          </Card>
          {query.view === 'pages' && (
            <IssuesFilter
              host={domain.host}
              query={{ ...query, page }}
              pages={latest.pagesCount}
              counts={issueCounts}
              checked={latest.pagesWithIssuesCount !== null}
              className="max-xl:order-first xl:sticky xl:top-16"
            />
          )}
        </div>
      )}
    </main>
  )
}
