import { getFormatter, getTranslations } from 'next-intl/server'
import { AddPriorityUrlForm } from '@/components/crawl/add-priority-url-form'
import { detailOf, PriorityToggle, StatusCell, UrlLink } from '@/components/crawl/url-cells'
import { Pagination } from '@/components/pagination'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('PrioritySettings')
  return { title: t('metaTitle', { host }) }
}

export default async function PrioritySettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { host } = await params
  const { page: pageParam } = await searchParams
  const { domain } = await requireDomain(host)
  const [t, format] = await Promise.all([getTranslations('PrioritySettings'), getFormatter()])
  const db = await getDb()

  const priorityUrls = await db.priorityUrls.list(domain.id)
  const pageCount = Math.max(1, Math.ceil(priorityUrls.length / PAGE_SIZE))
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number(pageParam)) || 1))
  const shown = priorityUrls.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const results = await db.crawls.latestResults(
    domain.id,
    shown.map((p) => p.urlHash),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description', { host: domain.host })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <AddPriorityUrlForm host={domain.host} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.url')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>{t('columns.detail')}</TableHead>
              <TableHead>{t('columns.added')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {t('empty')}
                </TableCell>
              </TableRow>
            )}
            {shown.map(({ url, urlHash, createdAt }) => {
              const result = results.find((r) => r.urlHash === urlHash)
              return (
                <TableRow key={urlHash}>
                  <TableCell>
                    <UrlLink url={url} />
                  </TableCell>
                  <TableCell>
                    <StatusCell row={result} />
                  </TableCell>
                  <TableCell className="max-w-64 truncate" title={detailOf(result)}>
                    {detailOf(result)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format.dateTime(createdAt, { dateStyle: 'medium' })}
                  </TableCell>
                  <TableCell>
                    <PriorityToggle host={domain.host} url={url} marked />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <Pagination
          page={page}
          pageCount={pageCount}
          href={(next) =>
            `/domains/${domain.host}/settings/priority${next > 1 ? `?page=${next}` : ''}`
          }
        />
      </CardContent>
    </Card>
  )
}
