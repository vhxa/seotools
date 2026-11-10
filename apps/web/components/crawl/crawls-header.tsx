import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { CrawlsNav } from '@/components/crawl/crawls-nav'

/**
 * The top of every page of the Crawls area: its heading, the actions that belong to the page (the
 * run buttons on the list) and the navigation between the pages of the area.
 */
export async function CrawlsHeader({
  host,
  actions,
  description,
}: {
  host: string
  actions?: ReactNode
  description?: ReactNode
}) {
  const t = await getTranslations('CrawlsArea')
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {actions}
      </div>
      <CrawlsNav host={host} />
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}
