import { ANY_ACCEPTED } from '@seotools/core/crawl/acceptance'
import { PAGE_ISSUES } from '@seotools/core/crawl/issues'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { InfoHelp } from '@/components/help'
import { IssueCategory } from '@/components/pages/issue-category'
import { IssueMark, ISSUE_TYPE_STYLES } from '@/components/pages/issue-mark'
import { Badge } from '@/components/ui/badge'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import { summariseIssues, zeroFindingState } from '@/lib/pages-issues'
import { detailHref, type DetailQuery } from '@/lib/pages-query'
import { cn } from '@/lib/utils'

/** The same rows as the main sidebar's, so both panels read alike. */
const NAV_BUTTON = 'h-8 gap-2.5 px-2 text-sm font-medium'

/**
 * Every issue there is, in its group and category, to filter the table by one. Each is a link: the
 * filter lives in the address, like the rest of what the table shows. Zero counts indicate no
 * recorded findings, never proof that every URL was checkable or passed. It is the page's own side
 * panel, built like the main sidebar, or a sheet on smaller screens.
 */
export async function IssuesFilter({
  host,
  query,
  pages,
  counts,
  hasAccepted = false,
  checked,
  rendered = true,
  analysis,
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
  /**
   * The crawl rendered its pages. If not, the JavaScript category was never looked for: it says so
   * instead of showing "no findings", which would read as "no problems".
   */
  rendered?: boolean
  /** Which crawl the page shows: it heads the panel. */
  analysis: ReactNode
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
    <aside
      aria-label={t('issues.title')}
      className={cn('flex h-full min-h-0 w-full flex-col gap-2 p-2', className)}
    >
      <div className="flex shrink-0 items-center gap-1 [&_[data-slot=select-trigger]]:h-12! [&_[data-slot=select-trigger]]:w-full [&_[data-slot=select-trigger]]:rounded-lg [&_[data-slot=select-trigger]]:border-transparent [&_[data-slot=select-trigger]]:bg-transparent [&_[data-slot=select-trigger]]:px-2 [&_[data-slot=select-trigger]]:font-medium [&_[data-slot=select-trigger]]:shadow-none [&_[data-slot=select-trigger]]:hover:bg-sidebar-accent">
        {analysis}
        <InfoHelp label={t('issues.title')}>{tDetails('issueList.units')}</InfoHelp>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
        {!checked ? (
          <p className="px-2 text-sm text-muted-foreground">{t('issues.notChecked')}</p>
        ) : (
          <>
            <SidebarGroup className="p-0">
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      className={NAV_BUTTON}
                      isActive={allSelected}
                      render={
                        <Link
                          href={detailHref(host, query, {
                            view: 'pages',
                            issue: null,
                            page: 1,
                            url: null,
                          })}
                          scroll={false}
                          aria-current={allSelected ? 'true' : undefined}
                        />
                      }
                    >
                      <span className="min-w-0 flex-1 truncate">{tDetails('issueList.all')}</span>
                      <span className="shrink-0 font-normal text-muted-foreground tabular-nums">
                        {format.number(pages)}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {hasAccepted && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        className={NAV_BUTTON}
                        isActive={query.accepted !== null}
                        title={t('accepted.help')}
                        render={
                          <Link
                            href={detailHref(host, query, {
                              accepted: ANY_ACCEPTED,
                              page: 1,
                              url: null,
                            })}
                            scroll={false}
                            aria-current={query.accepted ? 'true' : undefined}
                          />
                        }
                      >
                        <span className="min-w-0 flex-1 truncate">{t('accepted.title')}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {summariseIssues(counts).map((group) => (
              <SidebarGroup key={group.id} className="p-0">
                <SidebarGroupLabel className="mb-1 px-2 text-[13px] font-normal">
                  {tCatalog(`groups.${group.id}`)}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.categories.map((category) => (
                      <IssueCategory
                        key={category.id}
                        holdsSelection={category.issues.some(({ issue }) => issue === selected)}
                        header={
                          <>
                            <span className="min-w-0 flex-1 truncate">
                              {tCatalog(`categories.${category.id}`)}
                            </span>
                            {category.id === 'javascript' && !rendered ? (
                              <span className="text-muted-foreground">
                                -<span className="sr-only">{tCatalog('notLookedFor')}</span>
                              </span>
                            ) : category.worst ? (
                              <Badge
                                aria-label={tDetails('issueList.findings', {
                                  count: category.total,
                                })}
                                className={cn(
                                  ISSUE_TYPE_STYLES[category.worst].badge,
                                  'tabular-nums',
                                )}
                              >
                                {format.number(category.total)}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">
                                -<span className="sr-only">{tCatalog('noFindings')}</span>
                              </span>
                            )}
                          </>
                        }
                      >
                        <SidebarMenuSub>
                          {category.id === 'javascript' && !rendered && (
                            <li className="px-2 py-1 text-xs text-muted-foreground">
                              {tCatalog('notLookedFor')}
                            </li>
                          )}
                          {category.issues.map(({ issue, pages: count }) => {
                            const { type } = PAGE_ISSUES[issue]
                            const zeroState =
                              category.id === 'javascript' && !rendered
                                ? ('notLookedFor' as const)
                                : zeroFindingState(issue)
                            return (
                              <SidebarMenuSubItem key={issue}>
                                <SidebarMenuSubButton
                                  isActive={selected === issue}
                                  title={tIssues(`${issue}.description`)}
                                  className={cn(count === 0 && 'text-muted-foreground')}
                                  render={
                                    <Link
                                      href={detailHref(host, query, {
                                        view: 'all',
                                        issue,
                                        page: 1,
                                        url: null,
                                      })}
                                      scroll={false}
                                      aria-current={selected === issue ? 'true' : undefined}
                                    />
                                  }
                                >
                                  {/* What type it is and how important, in a slot of its own so the
                                      names line up; dimmed when the crawl found none. */}
                                  <span
                                    className={cn(
                                      'flex w-9 shrink-0 items-center',
                                      count === 0 && 'opacity-50',
                                    )}
                                  >
                                    <IssueMark issue={issue} />
                                  </span>
                                  <span className="min-w-0 flex-1 truncate">
                                    {tIssues(`${issue}.name`)}
                                  </span>
                                  {count > 0 ? (
                                    <Badge
                                      aria-label={tDetails('issueList.urls', { count })}
                                      className={cn(ISSUE_TYPE_STYLES[type].badge, 'tabular-nums')}
                                    >
                                      {format.number(count)}
                                    </Badge>
                                  ) : (
                                    <span title={tCatalog(zeroState)}>
                                      -<span className="sr-only">{tCatalog(zeroState)}</span>
                                    </span>
                                  )}
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            )
                          })}
                        </SidebarMenuSub>
                      </IssueCategory>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </>
        )}
      </div>
    </aside>
  )
}
