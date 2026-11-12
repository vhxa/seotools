import { XIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { isPageIssueId } from '@seotools/core/crawl/issues'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  activeFilters,
  detailHref,
  withoutFilter,
  type DetailQuery,
  type FilterKey,
  type NotApplied,
} from '@/lib/pages-query'
import { cn } from '@/lib/utils'

/**
 * How many URLs the filters leave, against what the view holds and what the crawl recorded, and
 * which filters are set, each one with the link that removes it. The line is always there, with
 * room for the filters beside it, so that setting one never pushes the table down.
 */
export async function ListStatus({
  host,
  query,
  unapplied,
  matching,
  inView,
  inCrawl,
  compact = false,
}: {
  compact?: boolean
  host: string
  query: DetailQuery
  /** The filters in the address that do not apply to the list, and why. */
  unapplied: Partial<Record<FilterKey, NotApplied>>
  /** URLs the list holds, over every page. */
  matching: number
  /** URLs the view starts from, with no filter. */
  inView: number
  /** URLs the crawl recorded. */
  inCrawl: number
}) {
  const [t, tFilters, tIssues, tState] = await Promise.all([
    getTranslations('PagesDetails'),
    getTranslations('PagesDetails.filters'),
    getTranslations('PageIssues'),
    getTranslations('AuditState'),
  ])
  const filters = activeFilters(query)
  // A filter that does not apply leaves the list as it was: the line says so only for the others.
  const narrowed = filters.some((key) => !unapplied[key])
  const internalOnly =
    query.view === 'all' &&
    filters.some(
      (key) =>
        !unapplied[key] &&
        (key === 'type' ||
          key === 'indexability' ||
          key === 'participation' ||
          key === 'intent' ||
          key === 'rule'),
    )
  const scope = t(`results.scopes.${query.view}`)

  const value = (key: FilterKey): string => {
    switch (key) {
      case 'state':
        return query.state
          ? t(('activeFilters.states.' + query.state) as Parameters<typeof t>[0])
          : ''
      case 'search':
        return query.search
      case 'issue':
        return query.issue && isPageIssueId(query.issue) ? tIssues(`${query.issue}.name`) : ''
      case 'accepted':
        return query.accepted && isPageIssueId(query.accepted)
          ? tIssues(`${query.accepted}.name`)
          : t('activeFilters.anyFinding')
      case 'status':
        return tFilters(`status.${query.status!}`)
      case 'type':
        return tFilters(`type.${query.type!}`)
      case 'indexability':
        return tState(`indexability.${query.indexability!}`)
      case 'participation':
        return tFilters(`audit.${query.participation!}`)
      case 'intent':
        return tFilters(`intent.${query.intent!}`)
      case 'rule':
        return ''
    }
  }

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1.5">
      <p aria-live="polite" className="text-sm tabular-nums">
        <span className="font-medium">
          {narrowed
            ? t('results.filtered', { matching, total: inView, scope })
            : t('results.unfiltered', { total: inView, scope })}
        </span>
        {query.view !== 'all' && (
          <span className="text-muted-foreground"> · {t('results.crawl', { total: inCrawl })}</span>
        )}
      </p>
      {internalOnly && !compact && (
        <span className="text-xs text-muted-foreground">{t('results.internalOnly')}</span>
      )}
      {filters.length > 0 && !compact && (
        <ul aria-label={t('activeFilters.label')} className="flex flex-wrap items-center gap-1.5">
          {filters.map((key) => {
            const reason = unapplied[key]
            const text = t(`activeFilters.chip.${key}`, { value: value(key) })
            return (
              <li key={key}>
                <Badge
                  variant="outline"
                  title={reason ? tFilters(`unavailable.${reason}`) : undefined}
                  className={cn(
                    'h-6 max-w-64 gap-1 pr-0.5',
                    reason && 'border-dashed text-muted-foreground',
                  )}
                >
                  <span className="truncate">{text}</span>
                  {reason && (
                    <span className="shrink-0 text-xs">({t('activeFilters.notApplied')})</span>
                  )}
                  <Link
                    href={detailHref(host, query, withoutFilter(key))}
                    scroll={false}
                    aria-label={t('activeFilters.remove', { filter: text })}
                    className="rounded-full p-0.5 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <XIcon aria-hidden className="size-3" />
                  </Link>
                </Badge>
              </li>
            )
          })}
        </ul>
      )}
      {filters.length > 0 && !compact && (
        <Link
          href={detailHref(host, query, withoutFilter('all'))}
          scroll={false}
          className={buttonVariants({ variant: 'ghost', size: 'xs' })}
        >
          {t('activeFilters.clearAll')}
        </Link>
      )}
    </div>
  )
}
