import { PAGE_ISSUES, type PageIssueId } from '@seotools/core/crawl/issues'
import { ChevronRightIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { InfoHelp } from '@/components/help'
import { IssueMark } from '@/components/pages/issue-mark'
import type { IssueCount } from '@/lib/pages-issues'

/**
 * Findings with how many URLs have each, each row leading to those URLs: the mark of its type, its
 * name, its category and, muted, what the same finding has on URLs that cannot be indexed (it is
 * listed, never counted as pending).
 */
export function IssueRows({
  rows,
  hrefOf,
  countLabel,
  secondaryLabel,
}: {
  rows: IssueCount[]
  hrefOf: (issue: PageIssueId) => string
  countLabel: (pages: number) => string
  secondaryLabel?: (pages: number) => string
}) {
  const tIssues = useTranslations('PageIssues')
  const tCatalog = useTranslations('IssueCatalog')
  return (
    <ul className="grid divide-y">
      {rows.map(({ issue, pages, secondary }) => (
        <li key={issue} className="flex items-center gap-1">
          <Link
            href={hrefOf(issue)}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-md py-2 text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <IssueMark issue={issue} />
            <span className="min-w-0 font-medium">{tIssues(`${issue}.name`)}</span>
            <span className="text-muted-foreground">
              {tCatalog(`categories.${PAGE_ISSUES[issue].category}`)}
            </span>
            <span className="ml-auto flex flex-col items-end tabular-nums">
              <span>{countLabel(pages)}</span>
              {secondary && secondaryLabel ? (
                <span className="text-xs text-muted-foreground">{secondaryLabel(secondary)}</span>
              ) : null}
            </span>
            <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </Link>
          <InfoHelp label={tIssues(`${issue}.name`)}>{tIssues(`${issue}.description`)}</InfoHelp>
        </li>
      ))}
    </ul>
  )
}
