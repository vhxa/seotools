import {
  ISSUE_IMPORTANCES,
  PAGE_ISSUES,
  isPageIssueId,
  type IssueImportance,
  type IssueType,
} from '@seotools/core/crawl/issues'
import { CircleXIcon, LightbulbIcon, TriangleAlertIcon, type LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** The icon and colours that say what type an issue is, everywhere one is shown. */
export const ISSUE_TYPE_STYLES: Record<
  IssueType,
  { icon: LucideIcon; text: string; badge: string }
> = {
  issue: {
    icon: CircleXIcon,
    text: 'text-destructive',
    badge: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
  },
  warning: {
    icon: TriangleAlertIcon,
    text: 'text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  },
  opportunity: {
    icon: LightbulbIcon,
    text: 'text-sky-600 dark:text-sky-400',
    badge: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  },
}

/** Three bars, as many filled as the issue is important. */
function ImportanceBars({ importance }: { importance: IssueImportance }) {
  const filled = ISSUE_IMPORTANCES.length - ISSUE_IMPORTANCES.indexOf(importance)
  return (
    <span aria-hidden className="flex h-3 items-end gap-px">
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className={cn(
            'w-0.5 rounded-full',
            bar === 1 ? 'h-1' : bar === 2 ? 'h-2' : 'h-3',
            bar <= filled ? 'bg-current' : 'bg-current opacity-25',
          )}
        />
      ))}
    </span>
  )
}

/** What type an issue is, by its icon and colour, and how important, by its bars. */
export function IssueMark({ issue }: { issue: keyof typeof PAGE_ISSUES }) {
  const t = useTranslations('IssueCatalog')
  const { type, importance } = PAGE_ISSUES[issue]
  const { icon: Icon, text } = ISSUE_TYPE_STYLES[type]
  const label = t('mark', {
    type: t(`types.${type}`),
    importance: t(`importance.${importance}`).toLowerCase(),
  })
  return (
    <span title={label} className={cn('inline-flex shrink-0 items-center gap-1', text)}>
      <Icon aria-hidden className="size-3.5" />
      <ImportanceBars importance={importance} />
      <span className="sr-only">{label}</span>
    </span>
  )
}

/**
 * The name of an issue with its category, for wherever the list around it does not say: "Missing"
 * means nothing without knowing that it is about the title. An id the code no longer defines shows
 * as it is.
 */
export function useIssueLabel() {
  const tCatalog = useTranslations('IssueCatalog')
  const tIssues = useTranslations('PageIssues')
  return (issue: string) =>
    isPageIssueId(issue)
      ? tCatalog('qualified', {
          category: tCatalog(`categories.${PAGE_ISSUES[issue].category}`),
          name: tIssues(`${issue}.name`),
        })
      : issue
}

/** `useIssueLabel` as a component, for server components. */
export function IssueLabel({ issue }: { issue: string }) {
  return useIssueLabel()(issue)
}

/** The name of an issue, coloured by its type. */
export function IssueBadge({ issue }: { issue: string }) {
  const label = useIssueLabel()(issue)
  if (!isPageIssueId(issue)) return <Badge variant="outline">{label}</Badge>
  const { icon: Icon, badge } = ISSUE_TYPE_STYLES[PAGE_ISSUES[issue].type]
  return (
    <Badge className={badge}>
      <Icon aria-hidden />
      {label}
    </Badge>
  )
}

const BLOCKERS = ['noindex', 'canonical', 'robots', 'redirect', 'http-error'] as const

/**
 * What an issue says about a URL, e.g. where a hreflang was declared or what keeps it from being
 * indexable. The names of security headers are what they are in any language.
 */
export function IssueDetails({ details }: { details: readonly string[] }) {
  const t = useTranslations('IssueCatalog.hreflangSources')
  const tBlockers = useTranslations('AuditState.blockers')
  return (
    <div className="flex flex-wrap gap-1">
      {details.map((detail) => (
        <Badge key={detail} variant="outline" className="font-normal">
          {detail === 'html' || detail === 'header' || detail === 'sitemap'
            ? t(detail)
            : (BLOCKERS as readonly string[]).includes(detail)
              ? tBlockers(detail as (typeof BLOCKERS)[number])
              : detail}
        </Badge>
      ))}
    </div>
  )
}
