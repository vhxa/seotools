import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { CrawlsHeader } from '@/components/crawl/crawls-header'
import { RecheckBanner, recheckHref } from '@/components/verification/recheck-banner'
import { RecheckStatusBadge } from '@/components/verification/status-badge'
import { Card, CardContent } from '@/components/ui/card'
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

const RECHECKS_SHOWN = 50

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('Verification.jobs')
  return { title: t('metaTitle', { host }) }
}

/** The rechecks of the domain: some URLs requested again after a fix, outside any crawl. */
export default async function RechecksPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  const [t, format] = await Promise.all([getTranslations('Verification.jobs'), getFormatter()])
  const rechecks = await (await getDb()).verifications.list(domain.id, { limit: RECHECKS_SHOWN })

  return (
    <main className="grid gap-6">
      <CrawlsHeader host={domain.host} description={t('description')} />
      <RecheckBanner host={domain.host} domainId={domain.id} />
      <Card>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('status')}</TableHead>
                <TableHead>{t('started')}</TableHead>
                <TableHead className="text-right">{t('urls')}</TableHead>
                <TableHead>{t('error')}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rechecks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              )}
              {rechecks.map((recheck) => (
                <TableRow key={recheck.id}>
                  <TableCell>
                    <RecheckStatusBadge status={recheck.status} />
                  </TableCell>
                  <TableCell>
                    {format.relativeTime(recheck.startedAt ?? recheck.createdAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t('urlsDone', { done: recheck.urlsDoneCount, total: recheck.urlsCount })}
                  </TableCell>
                  <TableCell
                    className="max-w-xs truncate text-muted-foreground"
                    title={recheck.error ?? undefined}
                  >
                    {recheck.error ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={recheckHref(domain.host, recheck)}
                      className="text-sm underline-offset-4 hover:underline"
                    >
                      {t('view')}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  )
}
