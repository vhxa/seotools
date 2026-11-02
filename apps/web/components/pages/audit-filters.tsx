'use client'

import { INDEX_INTENTS } from '@seotools/core/crawl/audit'
import { XIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  PARTICIPATION_FILTERS,
  detailHref,
  type DetailQuery,
  type ParticipationFilter,
} from '@/lib/pages-query'

const ALL = 'all'

/**
 * Filters on whether URLs were audited and on what is expected of them. They live in the address
 * like the rest of the table's state, and the server applies them. The row has a fixed size, so
 * nothing below it moves when a filter changes.
 */
export function AuditFilters({
  host,
  query,
  rulesHref,
}: {
  host: string
  query: DetailQuery
  /** Where the rules are, when the list is of the URLs one rule decided: the tab it is in. */
  rulesHref?: string
}) {
  const t = useTranslations('PagesDetails.filters')
  const router = useRouter()

  const go = (changes: Partial<DetailQuery>) =>
    router.push(detailHref(host, query, { ...changes, page: 1, url: null }), { scroll: false })

  const participations = [
    { value: ALL, label: t('audit.all') },
    ...PARTICIPATION_FILTERS.map((value) => ({ value, label: t(`audit.${value}`) })),
  ]
  const intents = [
    { value: ALL, label: t('intent.all') },
    ...INDEX_INTENTS.map((value) => ({ value, label: t(`intent.${value}`) })),
  ]

  return (
    <div role="group" aria-label={t('label')} className="flex flex-wrap items-center gap-2">
      <Select
        items={participations}
        value={query.participation ?? ALL}
        onValueChange={(value) =>
          go({ participation: value === ALL ? null : (value as ParticipationFilter) })
        }
      >
        <SelectTrigger size="sm" className="w-44" aria-label={t('audit.label')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {participations.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={intents}
        value={query.intent ?? ALL}
        onValueChange={(value) =>
          go({ intent: value === ALL ? null : (value as (typeof INDEX_INTENTS)[number]) })
        }
      >
        <SelectTrigger size="sm" className="w-52" aria-label={t('intent.label')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {intents.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {query.rule && rulesHref && (
        <Button variant="ghost" size="sm" render={<Link href={rulesHref} />}>
          {t('backToRules')}
        </Button>
      )}
      {query.rule && (
        <Button
          variant="secondary"
          size="sm"
          render={<Link href={detailHref(host, query, { rule: null, page: 1, url: null })} />}
        >
          {t('rule')}
          <XIcon />
          <span className="sr-only">{t('clearRule')}</span>
        </Button>
      )}
    </div>
  )
}
