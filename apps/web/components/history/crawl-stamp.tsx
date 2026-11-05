import { ISSUE_CATALOG_VERSION } from '@seotools/core/crawl/issues'
import type { Crawl } from '@seotools/db'
import { useFormatter, useTranslations } from 'next-intl'
import { CrawlStatusBadge } from '@/components/crawl/crawl-status-badge'
import { Badge } from '@/components/ui/badge'

/** When a crawl happened: when it ended, or when it started if it never did. */
export const crawlMoment = (crawl: Pick<Crawl, 'finishedAt' | 'createdAt'>) =>
  crawl.finishedAt ?? crawl.createdAt

/** The audit configuration a crawl was analysed with: its version, or `null` if it was not analysed. */
export const crawlConfigVersion = (crawl: Pick<Crawl, 'pagesByWorstIssue' | 'auditVersion'>) =>
  crawl.pagesByWorstIssue === null ? null : (crawl.auditVersion ?? 0)

/** The moment of a crawl, as the interface writes it. */
export function useCrawlMoment() {
  const format = useFormatter()
  return (crawl: Pick<Crawl, 'finishedAt' | 'createdAt'>) =>
    format.dateTime(crawlMoment(crawl), { dateStyle: 'medium', timeStyle: 'short' })
}

/** The audit configuration of a crawl in words: `v3`, or that it had no rules, or was not analysed. */
export function useConfigLabel() {
  const t = useTranslations('CrawlHistory.stamp')
  return (version: number | null) =>
    version === null ? t('notAnalysed') : version === 0 ? t('configNone') : t('config', { version })
}

/**
 * What identifies a crawl wherever it is shown: its date, how it ended, whether its results are
 * still stored (`retained`) or only its totals remain (`pruned`), and the audit configuration and
 * issue catalog its findings come from. A crawl is never shown without these.
 */
export function CrawlStamp({ crawl }: { crawl: Crawl }) {
  const t = useTranslations('CrawlHistory.stamp')
  const when = useCrawlMoment()
  const configLabel = useConfigLabel()
  // Pruned crawls have no findings to be out of date.
  const olderCatalog =
    !crawl.pruned && crawl.issueCatalog !== null && crawl.issueCatalog !== ISSUE_CATALOG_VERSION
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{t('at', { when: when(crawl) })}</span>
      <CrawlStatusBadge status={crawl.status} />
      {crawl.pruned ? (
        <Badge variant="secondary" title={t('prunedHint')}>
          {t('pruned')}
        </Badge>
      ) : (
        <span className="text-muted-foreground">{t('retained')}</span>
      )}
      <span className="text-muted-foreground">{configLabel(crawlConfigVersion(crawl))}</span>
      {olderCatalog && (
        <Badge variant="secondary" title={t('catalogOlderHint')}>
          {t('catalogOlder')}
        </Badge>
      )}
    </div>
  )
}
