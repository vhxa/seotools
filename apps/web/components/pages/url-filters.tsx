'use client'

import { STATUS_FILTERS, VIEW_KINDS } from '@seotools/core/crawl/listing'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { FilterSelect } from '@/components/pages/filter-select'
import { detailHref, type DetailQuery, type NotApplied } from '@/lib/pages-query'

/**
 * The filters on what a request got: its HTTP status class and what the URL turned out to be. They
 * live in the address like the rest of the table's state, and the server applies them.
 */
export function UrlFilters({
  host,
  query,
  typeUnavailable,
}: {
  host: string
  query: DetailQuery
  /** Why the type cannot be picked in this view, if it cannot. */
  typeUnavailable?: NotApplied | undefined
}) {
  const t = useTranslations('PagesDetails.filters')
  const router = useRouter()

  const go = (changes: Partial<DetailQuery>) =>
    router.push(detailHref(host, query, { ...changes, page: 1, url: null }), { scroll: false })

  return (
    <div role="group" aria-label={t('label')} className="flex flex-wrap items-center gap-2">
      <FilterSelect
        label={t('status.label')}
        anyLabel={t('status.all')}
        value={query.status}
        options={STATUS_FILTERS.map((value) => ({ value, label: t(`status.${value}`) }))}
        onChange={(status) => go({ status })}
        className="w-48"
      />
      <FilterSelect
        label={t('type.label')}
        anyLabel={t('type.all')}
        value={query.type}
        options={VIEW_KINDS[query.view].map((value) => ({ value, label: t(`type.${value}`) }))}
        onChange={(type) => go({ type })}
        unavailable={typeUnavailable ? t(`unavailable.${typeUnavailable}`) : undefined}
        className="w-52"
      />
    </div>
  )
}
