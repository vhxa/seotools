'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const ANY = 'any'

/**
 * One filter of the table: a choice among a few values, or "any". When it does not apply it stays
 * where it is, disabled and with the reason, so that nothing around it moves and nobody wonders
 * where it went.
 */
export function FilterSelect<T extends string>({
  label,
  anyLabel,
  value,
  options,
  onChange,
  unavailable,
  className,
}: {
  /** What the filter is, for whoever cannot see the box. */
  label: string
  anyLabel: string
  value: T | null
  options: readonly { value: T; label: string }[]
  onChange: (value: T | null) => void
  /** Why the filter does nothing here, if it does not. */
  unavailable?: string | undefined
  className?: string
}) {
  const items = [{ value: ANY, label: anyLabel }, ...options]
  return (
    <Select
      items={items}
      // A filter that does not apply is not choosing anything, whatever the address still says.
      value={unavailable !== undefined ? ANY : (value ?? ANY)}
      disabled={unavailable !== undefined}
      onValueChange={(next) => onChange(next === ANY ? null : (next as T))}
    >
      <SelectTrigger
        size="sm"
        className={cn('w-44', className)}
        aria-label={label}
        title={unavailable}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
