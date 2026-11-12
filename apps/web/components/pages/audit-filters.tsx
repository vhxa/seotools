'use client'

import { INDEX_INTENTS } from '@seotools/core/crawl/audit'
import { INDEXABILITY_STATES } from '@seotools/core/crawl/indexability'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { FilterSelect } from '@/components/pages/filter-select'
import { Button } from '@/components/ui/button'
import {
  PARTICIPATION_FILTERS,
  detailHref,
  type DetailQuery,
  type NotApplied,
} from '@/lib/pages-query'

/**
 * Filters on what the crawl saw of whether URLs can be indexed, on whether they were audited and on
 * what is expected of them. They live in the address like the rest of the table's state, and the
 * server applies them. Each one stays in its place whatever the view, so nothing moves when they
 * stop applying (external URLs have no audit state): they are disabled and say why.
 */
export function AuditFilters({
  host,
  query,
  stacked = false,
  unavailable,
  rulesHref,
}: {
  stacked?: boolean
  host: string
  query: DetailQuery
  /** Why none of these can apply to the list, if that is so: external URLs, or a crawl without audit data. */
  unavailable?: NotApplied | undefined
  /** Where the rules are, when the list is of the URLs one rule decided: the tab it is in. */
  rulesHref?: string
}) {
  const t = useTranslations('PagesDetails.filters')
  const decisions = useTranslations('FindingStates')
  const tState = useTranslations('AuditState')
  const router = useRouter()

  const go = (changes: Partial<DetailQuery>) =>
    router.push(detailHref(host, query, { ...changes, page: 1, url: null }), { scroll: false })
  const reason = unavailable ? t(`unavailable.${unavailable}`) : undefined

  return (
    <div
      role="group"
      aria-label={t('label')}
      className={stacked ? 'grid w-full gap-4' : 'flex flex-wrap items-center gap-2'}
    >
      <FilterSelect
        label={decisions('state')}
        anyLabel={decisions('all')}
        value={query.state}
        options={(['pending', 'in-progress', 'dismissed'] as const).map((value) => ({
          value,
          label: decisions(value),
        }))}
        onChange={(state) => go({ state })}
        showLabel={stacked}
      />
      <FilterSelect
        showLabel={stacked}
        label={t('indexability.label')}
        anyLabel={t('indexability.all')}
        value={query.indexability}
        options={INDEXABILITY_STATES.map((value) => ({
          value,
          label: tState(`indexability.${value}`),
        }))}
        onChange={(indexability) => go({ indexability })}
        unavailable={reason}
        className="w-52"
      />
      <FilterSelect
        showLabel={stacked}
        label={t('audit.label')}
        anyLabel={t('audit.all')}
        value={query.participation}
        options={PARTICIPATION_FILTERS.map((value) => ({ value, label: t(`audit.${value}`) }))}
        onChange={(participation) => go({ participation })}
        unavailable={reason}
      />
      <FilterSelect
        showLabel={stacked}
        label={t('intent.label')}
        anyLabel={t('intent.all')}
        value={query.intent}
        options={INDEX_INTENTS.map((value) => ({ value, label: t(`intent.${value}`) }))}
        onChange={(intent) => go({ intent })}
        unavailable={reason}
        className="w-52"
      />
      {query.rule && rulesHref && (
        <Button variant="ghost" size="sm" render={<Link href={rulesHref} />}>
          {t('backToRules')}
        </Button>
      )}
    </div>
  )
}
