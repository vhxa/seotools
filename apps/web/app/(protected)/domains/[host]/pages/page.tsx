import { crawlUrlHash } from '@seotools/core'
import type { Crawl, CrawlUrl, CrawlUrlView } from '@seotools/db'
import { TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { ActiveCrawl } from '@/components/crawl/active-crawl'
import { StartCrawlButton } from '@/components/crawl/start-crawl-button'
import { detailOf, PriorityToggle, StatusCell, UrlLink } from '@/components/crawl/url-cells'
import { Pagination } from '@/components/pagination'
import { Stat } from '@/components/stat'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50
const VIEWS = ['pages', 'other', 'external'] as const
type View = (typeof VIEWS)[number]

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('Pages')
  return { title: t('metaTitle', { host }) }
}

async function UrlTable({
  host,
  rows,
  priorities,
  showPriority,
}: {
  host: string
  rows: { url: string; result?: CrawlUrl }[]
  priorities: Set<string>
  showPriority: boolean
}) {
  const t = await getTranslations('Pages')
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('columns.url')}</TableHead>
          <TableHead>{t('columns.status')}</TableHead>
          <TableHead>{t('columns.detail')}</TableHead>
          {showPriority && <TableHead className="w-10" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-muted-foreground">
              {t('emptyView')}
            </TableCell>
          </TableRow>
        )}
        {rows.map(({ url, result }) => (
          <TableRow key={url}>
            <TableCell>
              <UrlLink url={url} />
            </TableCell>
            <TableCell>
              <StatusCell row={result} />
            </TableCell>
            <TableCell className="max-w-64 truncate" title={detailOf(result)}>
              {detailOf(result)}
            </TableCell>
            {showPriority && (
              <TableCell>
                <PriorityToggle host={host} url={url} marked={priorities.has(crawlUrlHash(url))} />
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function countOf(view: View, crawl: Crawl | null): number {
  if (!crawl) return 0
  if (view === 'pages') return crawl.pagesCount
  if (view === 'external') return crawl.externalCount
  return crawl.urlsCount - crawl.pagesCount
}

export default async function PagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>
  searchParams: Promise<{ view?: string; page?: string }>
}) {
  const { host } = await params
  const { view: viewParam, page: pageParam } = await searchParams
  const { domain } = await requireDomain(host)
  const [t, format] = await Promise.all([getTranslations('Pages'), getFormatter()])
  const db = await getDb()

  const view: View = VIEWS.find((v) => v === viewParam) ?? 'pages'
  const page = Math.max(1, Math.floor(Number(pageParam)) || 1)

  const [active, latest, priorityUrls] = await Promise.all([
    db.crawls.active(domain.id),
    db.crawls.latestWithResults(domain.id, 'full'),
    db.priorityUrls.list(domain.id),
  ])
  const priorities = new Set(priorityUrls.map((p) => p.urlHash))
  const total = countOf(view, latest)
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const offset = (page - 1) * PAGE_SIZE

  let rows: { url: string; result?: CrawlUrl }[] = []
  if (latest) {
    const urls = await db.crawls.listUrls({
      crawlId: latest.id,
      view: view satisfies CrawlUrlView,
      limit: PAGE_SIZE,
      offset,
    })
    rows = urls.map((result) => ({ url: result.url, result }))
  }

  const number = (value: number) => format.number(value)
  const href = (next: { view?: View; page?: number }) => {
    const query = new URLSearchParams({ view: next.view ?? view })
    if (next.page && next.page > 1) query.set('page', String(next.page))
    return `/domains/${domain.host}/pages?${query}`
  }

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

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t('stats.total')} value={latest ? number(latest.pagesCount) : '—'} />
        {/* Not known until the features that detect issues exist. */}
        <Stat label={t('stats.correct')} value="—" hint={t('stats.soon')} />
        <Stat label={t('stats.issues')} value="—" hint={t('stats.soon')} />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <nav aria-label={t('viewsLabel')} className="flex flex-wrap gap-1">
            {VIEWS.map((option) => (
              <Link
                key={option}
                href={href({ view: option })}
                aria-current={option === view ? 'page' : undefined}
                className={buttonVariants({
                  variant: option === view ? 'secondary' : 'ghost',
                  size: 'sm',
                })}
              >
                {t(`views.${option}`)}
                <span className="text-muted-foreground tabular-nums">
                  {number(countOf(option, latest))}
                </span>
              </Link>
            ))}
          </nav>
          <CardDescription>{t(`viewHints.${view}`)}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <UrlTable
            host={domain.host}
            rows={rows}
            priorities={priorities}
            showPriority={view === 'pages'}
          />
          <Pagination page={page} pageCount={pageCount} href={(next) => href({ page: next })} />
        </CardContent>
      </Card>
    </main>
  )
}
