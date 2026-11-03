import type { Crawl } from '@seotools/db'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import {
  CrawlStamp,
  crawlConfigVersion,
  useConfigLabel,
  useCrawlMoment,
} from '@/components/history/crawl-stamp'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Says which crawl the page is showing, always: its date, coverage and audit configuration. For a
 * crawl that is not the latest it says so plainly, and says how its configuration compares with the
 * one in force now, because its results are never recalculated (only the latest crawl follows the
 * current rules).
 */
export function CrawlBanner({
  crawl,
  historical,
  currentVersion,
  latestHref,
  picker,
}: {
  crawl: Crawl
  historical: boolean
  /** The version of the audit configuration in force now. */
  currentVersion: number
  /** Where the latest crawl is shown. */
  latestHref: string | null
  /** The control that chooses another crawl. */
  picker: ReactNode
}) {
  const t = useTranslations('CrawlHistory.banner')
  const when = useCrawlMoment()
  const configLabel = useConfigLabel()
  const version = crawlConfigVersion(crawl)
  const behind = historical && version !== null && version !== currentVersion
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3',
        historical && 'border-amber-500/40 bg-amber-500/5',
      )}
    >
      <div className="grid min-w-0 gap-1.5">
        {historical && <p className="text-sm font-medium">{t('viewing', { when: when(crawl) })}</p>}
        <CrawlStamp crawl={crawl} />
        {behind && (
          <p className="text-xs text-muted-foreground">
            {t('configBehind', {
              config: configLabel(version),
              current: configLabel(currentVersion),
            })}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {historical && latestHref && (
          <Link href={latestHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('backToLatest')}
          </Link>
        )}
        {picker}
      </div>
    </div>
  )
}
