import type { Crawl } from '@seotools/db'
import { getTranslations } from 'next-intl/server'
import { cancelCrawlAction } from '@/app/(protected)/domains/[host]/actions'
import { AutoRefresh } from '@/components/auto-refresh'
import { CrawlStatusBadge } from '@/components/crawl/crawl-status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

/** The crawl a domain is running now, if any, refreshing itself until it ends. */
export async function ActiveCrawl({ host, crawl }: { host: string; crawl: Crawl }) {
  const t = await getTranslations('Crawl')
  const percent =
    crawl.urlsCount > 0 ? Math.round((crawl.urlsDoneCount / crawl.urlsCount) * 100) : 0
  return (
    <Card>
      <AutoRefresh />
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          {t(`type.${crawl.type}`)}
          <CrawlStatusBadge status={crawl.status} />
        </CardTitle>
        <form action={cancelCrawlAction.bind(null, host, crawl.id)}>
          <Button type="submit" variant="outline" size="sm">
            {t('cancel')}
          </Button>
        </form>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Progress value={percent} aria-label={t('progressLabel')} />
        <p className="text-sm text-muted-foreground">
          {t('progress', {
            done: crawl.urlsDoneCount,
            total: crawl.urlsCount,
            pages: crawl.pagesCount,
            external: crawl.externalCount,
          })}
        </p>
      </CardContent>
    </Card>
  )
}
