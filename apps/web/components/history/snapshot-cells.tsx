import type { UrlSnapshot } from '@seotools/core/crawl/compare'
import { useTranslations } from 'next-intl'
import { StatusCell } from '@/components/crawl/status-cell'
import { Badge } from '@/components/ui/badge'

export function NotSet() {
  const t = useTranslations('CrawlCompare.table')
  return <span className="text-muted-foreground">{t('notSet')}</span>
}

export function Text({ value }: { value: string | null }) {
  return value ? <span className="break-words">{value}</span> : <NotSet />
}

/** How a URL answered: its status, what kind of URL it was, and where it redirected. */
export function Answer({ snapshot }: { snapshot: UrlSnapshot }) {
  const t = useTranslations('CrawlCompare.table')
  const tKinds = useTranslations('UrlDetail.kinds')
  if (snapshot.state !== 'done') return <Badge variant="outline">{t('notRequested')}</Badge>
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusCell row={snapshot} />
      {snapshot.kind !== 'page' && <Badge variant="outline">{tKinds(snapshot.kind)}</Badge>}
      {snapshot.redirectTo && (
        <span className="font-mono text-xs break-all">→ {snapshot.redirectTo}</span>
      )}
    </span>
  )
}

export function Robots({ snapshot }: { snapshot: UrlSnapshot }) {
  const t = useTranslations('CrawlCompare.table')
  if (!snapshot.metaRobots && !snapshot.xRobotsTag) return <NotSet />
  return (
    <span className="grid gap-0.5 text-xs">
      {snapshot.metaRobots && (
        <span>
          <span className="text-muted-foreground">{t('metaRobots')}</span> {snapshot.metaRobots}
        </span>
      )}
      {snapshot.xRobotsTag && (
        <span>
          <span className="text-muted-foreground">{t('xRobotsTag')}</span> {snapshot.xRobotsTag}
        </span>
      )}
    </span>
  )
}
