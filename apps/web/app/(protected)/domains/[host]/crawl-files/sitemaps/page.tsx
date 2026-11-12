import { getFormatter, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { CrawlFilesHeader } from '@/components/crawl-files/page-header'
import { FileLink, FileSize, FileStateBadge, Finding } from '@/components/crawl-files/parts'
import { Stat } from '@/components/stat'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SEVERE_FINDINGS, sitemapsView } from '@/lib/crawl-files'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100
export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('CrawlFiles.sitemaps')
  return { title: t('metaTitle', { host }) }
}

export default async function SitemapsPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { host } = await params
  const { page: pageParam } = await searchParams
  const { domain } = await requireDomain(host)
  const [t, format] = await Promise.all([getTranslations('CrawlFiles.sitemaps'), getFormatter()])
  const db = await getDb()
  const [sitemaps, robots, check, active] = await Promise.all([
    db.crawlFiles.list(domain.id, ['sitemap']),
    db.crawlFiles.list(domain.id, ['robots']),
    db.crawlFiles.getCheck(domain.id),
    db.crawls.active(domain.id),
  ])
  const files = [...robots, ...sitemaps]
  const view = sitemapsView(sitemaps, robots, domain.host)

  const pageCount = Math.max(1, Math.ceil(view.rows.length / PAGE_SIZE))
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number(pageParam)) || 1))
  const shown = view.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const href = (target: number) =>
    `/domains/${domain.host}/crawl-files/sitemaps${target > 1 ? `?page=${target}` : ''}`
  const date = (iso: string | null | undefined) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium' }) : '—'

  return (
    <main className="grid gap-6">
      <CrawlFilesHeader
        host={domain.host}
        title={t('title')}
        description={t('description')}
        files={files}
        check={check}
        active={active}
      />

      {files.length > 0 &&
        view.findings.map((finding) => (
          <Finding
            key={finding}
            severe={SEVERE_FINDINGS.sitemaps.has(finding)}
            title={t(`findings.${finding}.title`)}
            description={t(`findings.${finding}.description`)}
          />
        ))}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t('stats.files')} value={format.number(view.fileCount)} />
        <Stat
          label={t('stats.urls')}
          value={format.number(view.urlCount)}
          hint={t('stats.urlsHint')}
        />
        <Stat label={t('stats.lastModified')} value={date(view.lastModified)} />
      </div>

      {view.rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('table.title')}</CardTitle>
            {view.triedCount > 0 && (
              <CardDescription>{t('table.tried', { count: view.triedCount })}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="grid gap-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('table.url')}</TableHead>
                  <TableHead>{t('table.origin')}</TableHead>
                  <TableHead>{t('table.status')}</TableHead>
                  <TableHead>{t('table.format')}</TableHead>
                  <TableHead className="text-right">{t('table.entries')}</TableHead>
                  <TableHead>{t('table.lastModified')}</TableHead>
                  <TableHead>{t('table.size')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => {
                  const summary = row.file?.data?.sitemap
                  return (
                    <TableRow key={row.url}>
                      <TableCell>
                        <FileLink url={row.url} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{t(`origins.${row.origin}`)}</Badge>
                      </TableCell>
                      <TableCell>
                        {row.state ? (
                          <FileStateBadge
                            state={row.state}
                            statusCode={row.file?.statusCode ?? null}
                          />
                        ) : (
                          <span className="text-muted-foreground">
                            {t(row.external ? 'table.external' : 'table.notRequested')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {summary?.format ? t(`formats.${summary.format}`) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {summary?.format ? format.number(summary.entries) : '—'}
                      </TableCell>
                      <TableCell>{date(summary?.lastModified)}</TableCell>
                      <TableCell className="tabular-nums">
                        {row.file && row.state === 'ok' ? <FileSize file={row.file} /> : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  {t('table.pagination', { page, pages: pageCount })}
                </p>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link
                      href={href(page - 1)}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      {t('table.previous')}
                    </Link>
                  )}
                  {page < pageCount && (
                    <Link
                      href={href(page + 1)}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      {t('table.next')}
                    </Link>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  )
}
