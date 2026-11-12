import type { FindingChange, FindingChangeKind, UnknownReason } from '@seotools/core/crawl/compare'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const STYLES: Record<FindingChangeKind, string> = {
  new: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
  reappeared: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
  resolved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  dismissed: 'text-muted-foreground',
  accepted: 'bg-muted text-muted-foreground',
  excluded: 'bg-muted text-muted-foreground',
  audited: 'bg-muted text-muted-foreground',
  unverified: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  persistent: 'bg-muted text-muted-foreground',
}

/** What the reasons a change is not attributed to the site say, in words. */
export function useReasonText() {
  const t = useTranslations('CrawlCompare.reasons')
  return (reasons: readonly UnknownReason[]) => reasons.map((reason) => t(reason)).join('; ')
}

/**
 * How a finding changed, in the words the evidence supports. `unverified` carries the reasons it is
 * not called new or resolved, in its tooltip.
 */
export function FindingChangeBadge({
  change,
  className,
}: {
  change: Pick<FindingChange, 'kind' | 'reasons' | 'reportedBy'>
  className?: string
}) {
  const t = useTranslations('CrawlCompare.findingKinds')
  const reasonText = useReasonText()
  const hint =
    change.kind === 'unverified'
      ? t('unverifiedHint', { reasons: reasonText(change.reasons) })
      : t(`${change.kind}Hint`)
  return (
    <Badge title={hint} className={cn('font-normal', STYLES[change.kind], className)}>
      {change.kind === 'unverified' ? t(`unverified.${change.reportedBy}`) : t(change.kind)}
    </Badge>
  )
}
