import { CheckIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { IssueCategory } from '@/components/pages/issue-category'
import { IssueMark, ISSUE_TYPE_STYLES } from '@/components/pages/issue-mark'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { summariseIssues } from '@/lib/pages-issues'
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
 * filter lives in the address, like the rest of what the table shows. An issue nothing has stays
 * there, dimmed and with a check, because knowing it was looked at is worth something too. Beside
 * the table on a wide screen, above it on a narrow one.
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
    <aside aria-label={t('issues.title')} className={className}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('issues.title')}</CardTitle>
        </CardHeader>
        <CardContent>
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
                <span className="text-muted-foreground tabular-nums">{format.number(pages)}</span>
              </Link>

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
                              {format.number(category.total)}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              <CheckIcon aria-hidden />
                              <span className="sr-only">{tCatalog('noneFound')}</span>
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
                                view: 'pages',
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
                              <span>{tIssues(`${issue}.name`)}</span>
                              {count > 0 && (
                                <span className="text-muted-foreground tabular-nums">
                                  {format.number(count)}
                                </span>
                              )}
                            </Link>
                            <span className={MARK_SLOT}>
                              {count > 0 ? (
                                <IssueMark issue={issue} />
                              ) : (
                                <span title={tCatalog('noneFound')}>
                                  <CheckIcon
                                    aria-hidden
                                    className="size-3.5 text-muted-foreground opacity-70"
                                  />
                                  <span className="sr-only">{tCatalog('noneFound')}</span>
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
