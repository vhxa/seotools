import { auditResultsState } from '@seotools/core/crawl/audit'
import { ANY_ACCEPTED } from '@seotools/core/crawl/acceptance'
import { ISSUE_IMPORTANCES, PAGE_ISSUES } from '@seotools/core/crawl/issues'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuditResultsNotice } from '@/components/audit/audit-notice'
import { InfoHelp } from '@/components/help'
import { IssueRows } from '@/components/pages/issue-rows'
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

/** Every finding of the latest full crawl, by importance, each leading to its URLs. */
export default async function IssuesPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  const [t, tCatalog] = await Promise.all([
    getTranslations('Issues'),
    getTranslations('IssueCatalog'),
  ])
  const db = await getDb()
  const [latest, config] = await Promise.all([
    db.crawls.latestWithResults(domain.id, 'full'),
    db.audit.config(domain.id),
  ])
  const state = auditResultsState(latest, config)
  const checked = latest !== null && latest.pagesWithType !== null && !latest.pruned
  const [counts, acceptedCounts] =
    latest && checked
      ? await Promise.all([db.crawls.issueCounts(latest.id), db.crawls.acceptedCounts(latest.id)])
      : [[], []]
  const issues = rankIssueCounts(counts.filter((row) => row.pages > 0 || row.secondary > 0))
  const accepted = rankIssueCounts(acceptedCounts)
  const query = parseDetailQuery({})

  return (
    <main className="grid gap-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

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
