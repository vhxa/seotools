import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { cancelRecheckAction } from '@/app/(protected)/domains/[host]/verify-actions'
import { AutoRefresh } from '@/components/auto-refresh'
import { StatusCell } from '@/components/crawl/status-cell'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RecheckStatusBadge } from '@/components/verification/status-badge'
import { getDb } from '@/lib/db'
import { viewRecheck } from '@/lib/recheck'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('Verification.results')
  return { title: t('metaTitle', { host }) }
}

/**
 * What a recheck found, URL by URL, next to the full crawl it was picked from. That crawl is not
 * changed by it. Findings that need other pages or links are only counted as waiting for a full
 * crawl: a recheck does not say whether they remain.
 */
export default async function RecheckPage({
  params,
}: {
  params: Promise<{ host: string; id: string }>
}) {
  const { host, id } = await params
  const { domain, canEdit } = await requireDomain(host)
  const db = await getDb()
  const verification = await db.verifications.get(id)
  // The id is in the address: it has to be a recheck of the domain being looked at.
  if (!verification || verification.domainId !== domain.id) notFound()

  const [t, format] = await Promise.all([getTranslations('Verification.results'), getFormatter()])
  const [urls, base, config] = await Promise.all([
    db.verifications.urlsOf(verification.id),
    db.crawls.get(verification.baseCrawlId),
    db.audit.config(domain.id),
  ])
  // The results per URL of a pruned crawl are gone: there is nothing to compare with.
  const comparable = base && !base.pruned ? base : null
  const crawlIssues = comparable
    ? await db.crawls.issuesOf(
        comparable.id,
        urls.map((url) => url.urlHash),
      )
    : []

  const rows = urls.map((url) => {
    const view = viewRecheck({
      verified: url.state === 'done' ? url : null,
      crawl: comparable
        ? { auditVersion: comparable.auditVersion, pagesByWorstIssue: comparable.pagesByWorstIssue }
        : { auditVersion: null, pagesByWorstIssue: null },
      crawledAt: null,
      crawlIssues: crawlIssues.filter((found) => found.urlHash === url.urlHash).map((f) => f.issue),
      configVersion: config.version,
    })
    return { url, view }
  })
  const sum = (pick: (row: (typeof rows)[number]) => number) =>
    rows.reduce((total, row) => total + pick(row), 0)
  const totals = {
    fixed: sum((row) => row.view?.comparison?.fixed.length ?? 0),
    remaining: sum((row) => row.view?.comparison?.remaining.length ?? 0),
    appeared: sum((row) => row.view?.comparison?.appeared.length ?? 0),
    pending: sum((row) => row.view?.comparison?.pendingFullCrawl.length ?? 0),
  }
  const active = verification.status === 'pending' || verification.status === 'running'
  const anyStale = rows.some(({ view }) => view && !view.current)
  const anyNotComparable = rows.some(({ view }) => view?.notComparable)
  const number = (value: number | null | undefined) =>
    value === null || value === undefined ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <span className="tabular-nums">{format.number(value)}</span>
    )

  return (
    <main className="grid gap-6">
      {active && <AutoRefresh intervalMs={2000} />}
      <div className="grid justify-items-start gap-3">
        <Link
          href={`/domains/${domain.host}/crawls/rechecks`}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          <ArrowLeftIcon />
          {t('back')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {t('title', { count: verification.urlsCount })}
          </h1>
          <RecheckStatusBadge status={verification.status} />
          {active && canEdit && (
            <form action={cancelRecheckAction.bind(null, domain.host, verification.id)}>
              <Button type="submit" variant="outline" size="sm">
                {t('cancel')}
              </Button>
            </form>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {t('summary', {
            done: verification.urlsDoneCount,
            total: verification.urlsCount,
            when: format.dateTime(verification.createdAt, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })}
        </p>
      </div>

      {verification.status === 'failed' && (
        <Alert variant="destructive">
          <AlertTitle>{t('failed.title')}</AlertTitle>
          <AlertDescription>
            {t('failed.description', { error: verification.error ?? '—' })}
          </AlertDescription>
        </Alert>
      )}
      {verification.status === 'pending' && (
        <Alert>
          <AlertTitle>{t('waiting.title')}</AlertTitle>
          <AlertDescription>{t('waiting.description')}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('totals.title')}</CardTitle>
          <CardDescription>{t('scope')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(['fixed', 'remaining', 'appeared', 'pending'] as const).map((key) => (
              <div key={key} className="grid gap-0.5">
                <dt className="text-sm text-muted-foreground">{t(`totals.${key}`)}</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {format.number(totals[key])}
                </dd>
              </div>
            ))}
          </dl>
          {anyNotComparable && (
            <p className="text-sm text-muted-foreground">{t('notComparable')}</p>
          )}
          {anyStale && <p className="text-sm text-muted-foreground">{t('stale')}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.url')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
                <TableHead className="text-right">{t('columns.found')}</TableHead>
                <TableHead className="text-right">{t('columns.fixed')}</TableHead>
                <TableHead className="text-right">{t('columns.remaining')}</TableHead>
                <TableHead className="text-right">{t('columns.appeared')}</TableHead>
                <TableHead className="text-right">{t('columns.pending')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ url, view }) => {
                const excluded = url.outcome?.audit.participation === 'excluded'
                return (
                  <TableRow key={url.urlHash}>
                    <TableCell className="max-w-md">
                      <Link
                        href={`/domains/${domain.host}/urls/${url.urlHash}`}
                        title={url.url}
                        className="block truncate font-mono text-xs hover:underline"
                      >
                        {url.url}
                      </Link>
                      {excluded && (
                        <span className="text-xs text-muted-foreground">{t('excluded')}</span>
                      )}
                      {view && !view.current && (
                        <span className="block text-xs text-muted-foreground">
                          {t('rulesChanged')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {url.state === 'done' ? (
                        <StatusCell row={url} />
                      ) : (
                        <span className="text-muted-foreground">{t('queued')}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {number(url.outcome ? url.outcome.findings.length : null)}
                    </TableCell>
                    <TableCell className="text-right">
                      {number(view?.comparison?.fixed.length)}
                    </TableCell>
                    <TableCell className="text-right">
                      {number(view?.comparison?.remaining.length)}
                    </TableCell>
                    <TableCell className="text-right">
                      {number(view?.comparison?.appeared.length)}
                    </TableCell>
                    <TableCell className="text-right">
                      {number(excluded ? null : view?.comparison?.pendingFullCrawl.length)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  )
}
