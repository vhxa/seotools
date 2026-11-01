import { PAGE_ISSUES } from '@seotools/core/crawl/issues'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { rankIssueCounts } from '@/lib/pages-issues'
import { detailHref, type DetailQuery } from '@/lib/pages-query'
import { cn } from '@/lib/utils'

/**
 * The issues of the last crawl, to filter the table by one. Each is a link: the filter lives in the
 * address, like the rest of what the table shows. Beside the table on a wide screen, above it on a
 * narrow one.
 */
export async function IssuesFilter({
  host,
  query,
  pages,
  counts,
  checked,
  className,
}: {
  host: string
  query: DetailQuery
  /** Pages of the crawl, which is what "all pages" counts. */
  pages: number
  counts: { issue: string; pages: number }[]
  /** Whether the crawl was checked for issues at all. */
  checked: boolean
  className?: string
}) {
  const [t, tDetails, tIssues, tSeverity, format] = await Promise.all([
    getTranslations('Pages'),
    getTranslations('PagesDetails'),
    getTranslations('PageIssues'),
    getTranslations('Pages.issues.severity'),
    getFormatter(),
  ])
  const issues = rankIssueCounts(counts)
  // A filter from the address stays visible even when no page has the issue.
  const selected = query.issue
  if (selected && !issues.some((row) => row.issue === selected)) {
    const known = rankIssueCounts([{ issue: selected, pages: 0 }])
    issues.push(...known)
  }

  const item = (active: boolean) =>
    cn(
      'flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
      active && 'bg-muted font-medium',
    )

  return (
    <aside aria-label={t('issues.title')} className={className}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('issues.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!checked ? (
            <p className="text-sm text-muted-foreground">{t('issues.notChecked')}</p>
          ) : (
            <ul className="flex flex-wrap gap-1 xl:grid">
              <li>
                <Link
                  href={detailHref(host, query, { issue: null, page: 1, url: null })}
                  scroll={false}
                  aria-current={selected === null ? 'true' : undefined}
                  className={item(selected === null)}
                >
                  <span>{tDetails('issueList.all')}</span>
                  <span className="text-muted-foreground tabular-nums">{format.number(pages)}</span>
                </Link>
              </li>
              {issues.map(({ issue, pages: count }) => (
                <li key={issue}>
                  <Link
                    href={detailHref(host, query, { issue, page: 1, url: null })}
                    scroll={false}
                    aria-current={selected === issue ? 'true' : undefined}
                    title={tIssues(`${issue}.description`)}
                    className={item(selected === issue)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          'size-2 shrink-0 rounded-full',
                          PAGE_ISSUES[issue].severity === 'error' ? 'bg-destructive' : 'bg-chart-4',
                        )}
                      />
                      <span className="sr-only">{tSeverity(PAGE_ISSUES[issue].severity)}: </span>
                      <span className="truncate">{tIssues(`${issue}.name`)}</span>
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {format.number(count)}
                    </span>
                  </Link>
                </li>
              ))}
              {issues.length === 0 && (
                <li className="px-2.5 py-1.5 text-sm text-muted-foreground">{t('issues.empty')}</li>
              )}
            </ul>
          )}
        </CardContent>
      </Card>
    </aside>
  )
}
