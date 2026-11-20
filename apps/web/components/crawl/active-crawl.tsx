import type { Crawl } from '@seotools/db'
import { LoaderCircleIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { AutoRefresh } from '@/components/auto-refresh'
import { CancelCrawlButton } from '@/components/crawl/cancel-crawl-button'
import { CrawlStatusBadge } from '@/components/crawl/crawl-status-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { CrawlState } from '@/lib/crawl-activity'

/**
 * The crawl a domain is running now, refreshing itself until it ends. Once every page was requested
 * it stops showing a bar stuck at 100% and says it is processing: `crawl` is `null` when the crawl
 * has ended and only its analysis is left.
 */
export async function ActiveCrawl({
  host,
  crawl,
  activity,
}: {
  host: string
  crawl: Crawl | null
  activity: CrawlState
}) {
  const t = await getTranslations('Crawl')
  const processing = activity.kind === 'processing'
  const percent =
    crawl && crawl.urlsCount > 0 ? Math.round((crawl.urlsDoneCount / crawl.urlsCount) * 100) : 0
  return (
    <Card>
      <AutoRefresh />
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          {t(`type.${crawl?.type ?? 'full'}`)}
          {processing ? (
            <Badge variant="secondary">
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              {t('processing.label')}
            </Badge>
          ) : (
            crawl && <CrawlStatusBadge status={crawl.status} />
          )}
        </CardTitle>
        {crawl && (
          <CancelCrawlButton host={host} crawlId={crawl.id}>
            {t('cancel')}
          </CancelCrawlButton>
        )}
      </CardHeader>
      <CardContent className="grid gap-2">
        {processing || !crawl ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('processing.hint')}
          </p>
        ) : (
          <>
            <Progress value={percent} aria-label={t('progressLabel')} />
            <p className="text-sm text-muted-foreground">
              {t('progress', {
                done: crawl.urlsDoneCount,
                total: crawl.urlsCount,
                pages: crawl.pagesCount,
                external: crawl.externalCount,
              })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
