import { ISSUE_CATALOG_VERSION } from '@seotools/core/crawl/issues'
import type { Crawl } from '@seotools/db'
import { useFormatter, useTranslations } from 'next-intl'
import { rulesStateOf, type RulesState } from '@/lib/rules-state'
import { CrawlStatusBadge } from '@/components/crawl/crawl-status-badge'
import { Badge } from '@/components/ui/badge'

/** When a crawl happened: when it ended, or when it started if it never did. */
export const crawlMoment = (crawl: Pick<Crawl, 'finishedAt' | 'createdAt'>) =>
  crawl.finishedAt ?? crawl.createdAt

/** The configuration number a crawl was analysed with (internal), or `null` if it was not analysed. */
export const crawlConfigVersion = (crawl: Pick<Crawl, 'pagesByWorstIssue' | 'auditVersion'>) =>
  crawl.pagesByWorstIssue === null ? null : (crawl.auditVersion ?? 0)

/** The moment of a crawl, as the interface writes it. */
export function useCrawlMoment() {
  const format = useFormatter()
  return (crawl: Pick<Crawl, 'finishedAt' | 'createdAt'>) =>
    format.dateTime(crawlMoment(crawl), { dateStyle: 'medium', timeStyle: 'short' })
}

/** Which rules a crawl was analysed with, in words: the current ones, ones that changed, or none yet. */
export function useRulesLabel() {
  const t = useTranslations('CrawlHistory.stamp')
  return (state: RulesState) =>
    state === 'notAnalysed'
      ? t('notAnalysed')
      : state === 'current'
        ? t('rulesCurrent')
        : t('rulesChanged')
}

/**
 * What identifies a crawl wherever it is shown: its date, how it ended, whether its results are
 * still stored (`retained`) or only its totals remain (`pruned`), and the rules it was analysed
 * with and the issue catalog its findings come from. A crawl is never shown without these.
 */
export function CrawlStamp({ crawl, currentVersion }: { crawl: Crawl; currentVersion: number }) {
  const t = useTranslations('CrawlHistory.stamp')
  const basis = useTranslations('AuditBasis')
  const when = useCrawlMoment()
  const rulesLabel = useRulesLabel()
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
      <span className="text-muted-foreground">
        {rulesLabel(rulesStateOf(crawlConfigVersion(crawl), currentVersion))}
      </span>
      {crawl.pagesByWorstIssue !== null && (
        <span className="text-muted-foreground">
          {basis(crawl.auditSnapshot?.documentBasis ? 'rendered' : 'html')}
        </span>
      )}
      {crawl.auditSnapshot?.documentCoverage && (
        <span className="text-muted-foreground">
          {basis('coverage', crawl.auditSnapshot.documentCoverage)}
        </span>
      )}
      {olderCatalog && (
        <Badge variant="secondary" title={t('catalogOlderHint')}>
          {t('catalogOlder')}
        </Badge>
      )}
    </div>
  )
}
