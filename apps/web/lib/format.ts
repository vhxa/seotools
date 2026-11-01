import type { useFormatter } from 'next-intl'

/** What of `useFormatter` / `getFormatter` the helpers here need. */
type NumberFormatter = Pick<ReturnType<typeof useFormatter>, 'number'>

/** A size in the largest unit that keeps it above 1: `812 byte`, `1.5 kB`, `2.4 MB`. */
export function formatBytes(format: NumberFormatter, bytes: number): string {
  const unit = (value: number, name: 'byte' | 'kilobyte' | 'megabyte') =>
    format.number(value, {
      style: 'unit',
      unit: name,
      unitDisplay: 'short',
      maximumFractionDigits: name === 'byte' ? 0 : 1,
    })
  if (bytes < 1024) return unit(bytes, 'byte')
  if (bytes < 1024 * 1024) return unit(bytes / 1024, 'kilobyte')
  return unit(bytes / (1024 * 1024), 'megabyte')
}
