'use client'

import { ArrowRightIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { compareHref, type CompareQuery } from '@/lib/compare-query'

export interface PairOption {
  value: string
  label: string
}

/**
 * Chooses the two crawls to compare. Both ids go into the address as soon as either is changed, so
 * what is being compared is always what the address says. The server puts them in order: it does not
 * matter which is picked first.
 */
export function PairPicker({
  host,
  query,
  options,
  from,
  to,
}: {
  host: string
  query: CompareQuery
  /** Newest first. */
  options: PairOption[]
  /** The crawls being compared now, the earlier one and the later one. */
  from: string
  to: string
}) {
  const t = useTranslations('CrawlCompare.picker')
  const router = useRouter()
  const go = (changes: { from?: string; to?: string }) =>
    router.push(compareHref(host, query, { from, to, ...changes, page: 1 }), { scroll: false })
  return (
    <div role="group" aria-label={t('label')} className="flex flex-wrap items-center gap-2">
      <Select items={options} value={from} onValueChange={(next) => next && go({ from: next })}>
        <SelectTrigger size="sm" className="w-80 max-w-full" aria-label={t('from')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} className="w-auto min-w-(--anchor-width)">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ArrowRightIcon aria-hidden className="size-4 text-muted-foreground" />
      <Select items={options} value={to} onValueChange={(next) => next && go({ to: next })}>
        <SelectTrigger size="sm" className="w-80 max-w-full" aria-label={t('to')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} className="w-auto min-w-(--anchor-width)">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
