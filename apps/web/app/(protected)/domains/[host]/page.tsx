import { auditResultsState } from '@seotools/core/crawl/audit'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { AuditResultsNotice } from '@/components/audit/audit-notice'
import { ActiveCrawl } from '@/components/crawl/active-crawl'
import { CrawlStatusBadge } from '@/components/crawl/crawl-status-badge'
import { StartCrawlButton } from '@/components/crawl/start-crawl-button'
import { IssueLabel, IssueMark } from '@/components/pages/issue-mark'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import { homePriorities } from '@/lib/domain-home'
import { detailHref, parseDetailQuery } from '@/lib/pages-query'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('DomainHome')
  return { title: t('metaTitle', { host }) }
}

export default async function DomainPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain, company } = await requireDomain(host)
  const [t, format] = await Promise.all([getTranslations('DomainHome'), getFormatter()])
  const db = await getDb()
  const [active, latest, attempts, config] = await Promise.all([
    db.crawls.active(domain.id),
    db.crawls.latestWithResults(domain.id, 'full'),
    db.crawls.list(domain.id, { type: 'full', limit: 1 }),
    db.audit.config(domain.id),
  ])
  const state = auditResultsState(latest, config)
  const counts =
    latest?.pagesWithType && state.kind === 'current' ? await db.crawls.issueCounts(latest.id) : []
  const priorities = homePriorities(latest, state, counts)
  const lastAttempt = attempts[0]
  const unsuccessful =
    lastAttempt && (lastAttempt.status === 'failed' || lastAttempt.status === 'cancelled')
  const base = `/domains/${domain.host}`

  return (
    <main className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold">{domain.host}</h1>
          <p className="text-sm text-muted-foreground">{t('company', { company: company.name })}</p>
        </div>
        <StartCrawlButton
          host={domain.host}
          type="full"
          disabled={active !== null || domain.archivedAt !== null}
        />
      </div>

      {active && <ActiveCrawl host={domain.host} crawl={active} />}
      <AuditResultsNotice host={domain.host} state={state} />

      <Card>
        <CardHeader>
          <CardTitle>{t('crawlTitle')}</CardTitle>
          <CardDescription>
            {latest
              ? t('lastCrawl', {
                  when: format.dateTime(latest.finishedAt ?? latest.createdAt, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                })
              : t('noCrawl')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {latest && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <CrawlStatusBadge status={latest.status} />
                <p className="text-sm">
                  {t('coverage', {
                    done: latest.urlsDoneCount,
                    total: latest.urlsCount,
                    pages: latest.pagesCount,
                  })}
                </p>
              </div>
              {latest.pagesAudit && (
                <p className="text-sm text-muted-foreground">
                  {t('auditCoverage', {
                    audited: latest.pagesAudit.audited,
                    excluded: latest.pagesAudit.excluded,
                    unknown: latest.pagesAudit.unknownIndexability,
                  })}
                </p>
              )}
              {latest.status === 'incomplete' && (
                <p className="text-sm text-muted-foreground">
                  {t('incomplete')}{' '}
                  <Link href={`${base}/settings/crawl`} className="underline">
                    {t('crawlSettings')}
                  </Link>
                </p>
              )}
            </>
          )}
          {unsuccessful && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {t('lastAttempt')}
              <CrawlStatusBadge status={lastAttempt.status} />
              <Link href={`${base}/jobs`} className="underline">
                {t('jobs')}
              </Link>
            </p>
          )}
          <nav aria-label={t('linksLabel')} className="flex flex-wrap gap-2">
            <Link href={`${base}/pages`} className={buttonVariants({ variant: 'outline' })}>
              {t('overview')}
            </Link>
            <Link href={`${base}/pages/history`} className={buttonVariants({ variant: 'ghost' })}>
              {t('history')}
            </Link>
          </nav>
        </CardContent>
      </Card>

      {latest && (
        <Card>
          <CardHeader>
            <CardTitle>{t('prioritiesTitle')}</CardTitle>
            <CardDescription>{t('prioritiesDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {priorities === null ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  latest.pruned
                    ? 'pruned'
                    : state.kind === 'pending' || state.kind === 'failed'
                      ? 'stale'
                      : 'notChecked',
                )}
              </p>
            ) : priorities.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noPriorities')}</p>
            ) : (
              <ul className="divide-y">
                {priorities.map(({ issue, pages }) => (
                  <li key={issue}>
                    <Link
                      href={detailHref(domain.host, parseDetailQuery({}), { issue })}
                      className="flex flex-wrap items-center gap-2 rounded-md py-3 text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <IssueLabel issue={issue} />
                      <IssueMark issue={issue} />
                      <span className="ml-auto text-muted-foreground">
                        {t('affectedUrls', { count: pages })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href={`${base}/pages`} className="text-sm underline">
              {t('allFindings')}
            </Link>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
