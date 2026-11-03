'use client'

import { useRouter } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface CrawlPickerItem {
  /** The id of the crawl. */
  value: string
  label: string
  /** Where choosing it goes. The server builds it: the address is the state. */
  href: string
}

/** A list of crawls to go to. Choosing one navigates; nothing is kept on the client. */
export function CrawlPicker({
  items,
  value,
  label,
  className,
}: {
  items: CrawlPickerItem[]
  value: string
  label: string
  className?: string
}) {
  const router = useRouter()
  return (
    <Select
      items={items.map(({ value, label }) => ({ value, label }))}
      value={value}
      onValueChange={(next) => {
        const item = items.find((candidate) => candidate.value === next)
        if (item && item.value !== value) router.push(item.href, { scroll: false })
      }}
    >
      <SelectTrigger size="sm" className={className ?? 'w-80 max-w-full'} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="w-auto min-w-(--anchor-width)">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
