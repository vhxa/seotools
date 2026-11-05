import type { Crawl } from '@seotools/db'
import { useFormatter, useTranslations } from 'next-intl'
import { crawlMoment, useCrawlMoment } from '@/components/history/crawl-stamp'
import { CrawlPicker, type CrawlPickerItem } from '@/components/history/crawl-picker'

/** The option a crawl is in a list: its date, how it ended and whether its results remain. */
export function useCrawlOptionLabel() {
  const t = useTranslations('CrawlHistory.picker')
  const tStatus = useTranslations('Crawl.status')
  const when = useCrawlMoment()
  return (crawl: Crawl, latestId?: string | null) =>
    t('option', {
      when: when(crawl),
      status: tStatus(crawl.status).toLowerCase(),
      coverage: crawl.pruned ? 'pruned' : 'retained',
      latest: crawl.id === latestId ? 'yes' : 'no',
    })
}

/**
 * Chooses which crawl a page shows. `crawls` are the domain's, newest first; `selected` is always
 * offered even when it is older than the ones listed.
 */
export function CrawlSwitcher({
  crawls,
  selected,
  latestId,
  hrefFor,
}: {
  crawls: Crawl[]
  selected: Crawl
  latestId: string | null
  /** Where a crawl is shown; the page decides what else stays in the address. */
  hrefFor: (crawl: Crawl) => string
}) {
  const t = useTranslations('CrawlHistory.picker')
  const label = useCrawlOptionLabel()
  const format = useFormatter()
  const listed = crawls.some((crawl) => crawl.id === selected.id) ? crawls : [selected, ...crawls]
  const items: CrawlPickerItem[] = listed.map((crawl) => ({
    value: crawl.id,
    label: label(crawl, latestId),
    href: hrefFor(crawl),
  }))
  return (
    <CrawlPicker
      items={items}
      value={selected.id}
      label={t('label')}
      selectedLabel={t(selected.id === latestId ? 'latestCompact' : 'historicalCompact', {
        when: format.relativeTime(crawlMoment(selected)),
      })}
      title={label(selected, latestId)}
    />
  )
}
