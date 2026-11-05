import { ANY_ACCEPTED } from '@seotools/core/crawl/acceptance'
import { MinusIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { InfoHelp } from '@/components/help'
import { IssueCategory } from '@/components/pages/issue-category'
import { IssueMark, ISSUE_TYPE_STYLES } from '@/components/pages/issue-mark'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { summariseIssues, zeroFindingState } from '@/lib/pages-issues'
import { detailHref, type DetailQuery } from '@/lib/pages-query'
import { cn } from '@/lib/utils'

/** The width of what is right of each row, so that names and counts line up across rows. */
const MARK_SLOT = 'flex w-9 shrink-0 items-center justify-end'

const rowClass = (active: boolean) =>
  cn(
    'flex min-w-0 flex-1 items-baseline justify-between gap-2 rounded-md px-2 py-1 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
    active && 'bg-muted font-medium',
  )

/**
 * Every issue there is, in its group and category, to filter the table by one. Each is a link: the
 * filter lives in the address, like the rest of what the table shows. Zero counts indicate no recorded
 * findings, never proof that every URL was checkable or passed. Beside
 * the table on desktop, or in a sheet on smaller screens.
 */
export async function IssuesFilter({
  host,
  query,
  pages,
  counts,
  hasAccepted = false,
  checked,
  className,
}: {
  host: string
  query: DetailQuery
  /** Pages of the crawl, which is what "all pages" counts. */
  pages: number
  counts: { issue: string; pages: number }[]
  /** Whether a rule accepts any finding of the crawl: only then is there a list of them to open. */
  hasAccepted?: boolean
  /** Whether the crawl was checked for issues at all. */
  checked: boolean
  className?: string
}) {
  const [t, tDetails, tIssues, tCatalog, format] = await Promise.all([
    getTranslations('Pages'),
    getTranslations('PagesDetails'),
    getTranslations('PageIssues'),
    getTranslations('IssueCatalog'),
    getFormatter(),
  ])
  const selected = query.issue
  const allSelected = selected === null && query.view === 'pages'

  return (
    <aside aria-label={t('issues.title')} className={cn('flex h-full min-h-0 flex-col', className)}>
      <Card className="min-h-0 flex-1 gap-3 py-4">
        <CardHeader className="shrink-0 px-4">
          <CardTitle className="flex items-center gap-1 text-base">
            {t('issues.title')}
            <InfoHelp label={t('issues.title')}>{tDetails('issueList.units')}</InfoHelp>
          </CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          {!checked ? (
            <p className="text-sm text-muted-foreground">{t('issues.notChecked')}</p>
          ) : (
            <div className="grid gap-4">
              <Link
                href={detailHref(host, query, { view: 'pages', issue: null, page: 1, url: null })}
                scroll={false}
                aria-current={allSelected ? 'true' : undefined}
                className={rowClass(allSelected)}
              >
                <span>{tDetails('issueList.all')}</span>
                <span className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
                  {format.number(pages)}
                </span>
              </Link>

              {hasAccepted && (
                <Link
                  href={detailHref(host, query, { accepted: ANY_ACCEPTED, page: 1, url: null })}
                  scroll={false}
                  aria-current={query.accepted ? 'true' : undefined}
                  title={t('accepted.help')}
                  className={rowClass(query.accepted !== null)}
                >
                  <span>{t('accepted.title')}</span>
                </Link>
              )}

              {summariseIssues(counts).map((group) => (
                <section key={group.id} className="grid gap-1">
                  <h3 className="px-2 text-xs font-medium text-muted-foreground">
                    {tCatalog(`groups.${group.id}`)}
                  </h3>
                  {group.categories.map((category) => (
                    <IssueCategory
                      key={category.id}
                      holdsSelection={category.issues.some(({ issue }) => issue === selected)}
                      header={
                        <>
                          <span className="min-w-0 flex-1">
                            {tCatalog(`categories.${category.id}`)}
                          </span>
                          {category.worst ? (
                            <Badge
                              className={cn(
                                ISSUE_TYPE_STYLES[category.worst].badge,
                                'tabular-nums',
                              )}
                            >
                              {tDetails('issueList.findings', { count: category.total })}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              <MinusIcon aria-hidden />
                              <span className="sr-only">{tCatalog('noFindings')}</span>
                            </Badge>
                          )}
                        </>
                      }
                    >
                      <ul className="mt-0.5 ml-3.5 grid gap-0.5 border-l pl-1.5">
                        {category.issues.map(({ issue, pages: count }) => (
                          <li key={issue} className="flex items-center gap-1">
                            <Link
                              href={detailHref(host, query, {
                                view: 'all',
                                issue,
                                page: 1,
                                url: null,
                              })}
                              scroll={false}
                              aria-current={selected === issue ? 'true' : undefined}
                              title={tIssues(`${issue}.description`)}
                              className={cn(
                                rowClass(selected === issue),
                                count === 0 && 'text-muted-foreground opacity-70',
                              )}
                            >
                              <span className="min-w-0 flex-1">
                                {tIssues(`${issue}.name`)}
                                {count === 0 && zeroFindingState(issue) === 'unavailable' && (
                                  <span className="block text-xs">{tCatalog('unavailable')}</span>
                                )}
                              </span>
                              {count > 0 && (
                                <span className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
                                  {tDetails('issueList.urls', { count })}
                                </span>
                              )}
                            </Link>
                            <span className={MARK_SLOT}>
                              {count > 0 ? (
                                <IssueMark issue={issue} />
                              ) : (
                                <span title={tCatalog(zeroFindingState(issue))}>
                                  <MinusIcon
                                    aria-hidden
                                    className="size-3.5 text-muted-foreground opacity-70"
                                  />
                                  <span className="sr-only">
                                    {tCatalog(zeroFindingState(issue))}
                                  </span>
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </IssueCategory>
                  ))}
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </aside>
  )
}
