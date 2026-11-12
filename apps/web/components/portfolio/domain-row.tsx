import { FavouriteDomainButton } from '@/components/favourite-domain-button'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { CrawlStatusBadge } from '@/components/crawl/crawl-status-badge'
import { DomainIcon } from '@/components/domain-icon'
import { Sparkline } from '@/components/portfolio/sparkline'
import { Badge } from '@/components/ui/badge'
import type { DomainSummary } from '@/lib/portfolio'

/** One domain of the portfolio: where it stands after its last full crawl, and how it has moved. */
export async function DomainRow({
  host,
  favourite,
  faviconVersion,
  summary,
  compact = false,
}: {
  favourite: boolean
  host: string
  faviconVersion: string | null
  summary: DomainSummary
  /** Archived domains: the crawl and nothing else. */
  compact?: boolean
}) {
  const [t, format] = await Promise.all([getTranslations('Portfolio'), getFormatter()])
  const { last, figures, crawled, running, points, hasResults } = summary
  const number = (value: number | null) => (value === null ? '—' : format.number(value))
  const tiles = [
    { key: 'crawled', value: crawled },
    { key: 'indexable', value: figures?.indexable ?? null },
    { key: 'issues', value: figures?.issues ?? null },
    { key: 'warnings', value: figures?.warnings ?? null },
    { key: 'opportunities', value: figures?.opportunities ?? null },
  ] as const
  const trend = points.map(({ issues }) => issues)

  return (
    <li className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,14rem)_1fr_auto] md:items-center md:gap-6">
      <div className="grid min-w-0 gap-1">
        <div className="flex items-center gap-1">
          <FavouriteDomainButton host={host} favourite={favourite} />
          <Link
            href={`/domains/${host}`}
            aria-label={t('open', { host })}
            className="flex min-w-0 items-center gap-2 rounded-md font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <DomainIcon host={host} version={faviconVersion} size="sm" />
            <span className="truncate">{host}</span>
          </Link>
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {running && <Badge variant="secondary">{t('running')}</Badge>}
          {last ? (
            <>
              <CrawlStatusBadge status={last.status} />
              {t('lastCrawl', { when: format.relativeTime(last.finishedAt ?? last.createdAt) })}
            </>
          ) : (
            !running && t('neverCrawled')
          )}
        </p>
      </div>
      {compact ? (
        <span />
      ) : (
        <>
          <dl className="grid grid-cols-5 gap-2">
            {tiles.map(({ key, value }) => (
              <div key={key} className="grid min-w-0 content-start gap-0.5">
                <dt className="truncate text-xs text-muted-foreground">{t(`figures.${key}`)}</dt>
                <dd className="text-lg font-semibold tabular-nums">{number(value)}</dd>
              </div>
            ))}
          </dl>
          <div className="flex items-center gap-2">
            {hasResults && !figures && (
              <span className="text-xs text-muted-foreground">{t('notChecked')}</span>
            )}
            {(figures || !hasResults) && (
              <Sparkline values={trend} label={t('trend')} empty={t('trendEmpty')} />
            )}
          </div>
        </>
      )}
    </li>
  )
}
