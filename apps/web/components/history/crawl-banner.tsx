import type { Crawl } from '@seotools/db'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { crawlConfigVersion, useCrawlMoment } from '@/components/history/crawl-stamp'
import { rulesStateOf } from '@/lib/rules-state'

/**
 * Identifies the selected crawl and warns when it is historical, incomplete or analysed with an
 * older audit configuration. Historical results keep their configuration; only the latest crawl
 * follows the current rules.
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
  const version = crawlConfigVersion(crawl)
  const behind = historical && rulesStateOf(version, currentVersion) === 'changed'
  if (!picker && !historical && crawl.status === 'completed') return null
  return (
    <div className="grid gap-2 text-sm">
      {picker && <div className="flex flex-wrap items-center gap-2">{picker}</div>}
      {(historical || crawl.status !== 'completed' || behind) && (
        <div
          role="status"
          className="grid gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
        >
          {historical && <p>{t('viewing', { when: when(crawl) })}</p>}
          {crawl.status !== 'completed' && <p>{t('incomplete')}</p>}
          {behind && <p>{t('rulesBehind')}</p>}
          {historical && latestHref && (
            <Link href={latestHref} className="w-fit underline underline-offset-4">
              {t('backToLatest')}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
