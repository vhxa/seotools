import type { Crawl } from '@seotools/db'
import type { CrawlFile, CrawlFileCheck } from '@seotools/db'
import { getFormatter, getTranslations } from 'next-intl/server'
import { HelpDisclosure } from '@/components/help'
import { AutoRefresh } from '@/components/auto-refresh'
import { RefreshCrawlFilesButton } from '@/components/crawl-files/refresh-button'
import { Finding } from '@/components/crawl-files/parts'
import { isCheckPending, lastFetched } from '@/lib/crawl-files'

/** The top of every crawl file page: when the data is from, and the way to get it fresher. */
export async function CrawlFilesHeader({
  host,
  title,
  description,
  files,
  check,
  active,
}: {
  host: string
  title: string
  description: string
  files: CrawlFile[]
  check: CrawlFileCheck | null
  active: Crawl | null
}) {
  const [t, format] = await Promise.all([getTranslations('CrawlFiles'), getFormatter()])
  const pending = isCheckPending(check, new Date())
  const crawling = active?.type === 'full'
  const newest = lastFetched(files)

  return (
    <>
      {(pending || crawling) && <AutoRefresh />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <HelpDisclosure title={t('aboutFile')}>{description}</HelpDisclosure>
          <p className="text-sm text-muted-foreground">
            {newest
              ? t(newest.via === 'crawl' ? 'fetchedByCrawl' : 'fetchedByRefresh', {
                  when: format.relativeTime(newest.fetchedAt),
                })
              : t('neverFetched')}
          </p>
          {crawling && <p className="text-sm text-muted-foreground">{t('crawlRunning')}</p>}
        </div>
        <RefreshCrawlFilesButton host={host} disabled={crawling} pending={pending} />
      </div>
      {check?.outcome === 'unreachable' && (
        <Finding severe title={t('unreachable.title')} description={t('unreachable.description')} />
      )}
    </>
  )
}
