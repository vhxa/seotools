import { useTranslations } from 'next-intl'

/** What deleting removes, in rows. The server counted it: the client only shows it. */
export interface UsageCounts {
  crawls: number
  urls: number
  rules: number
  rechecks: number
  schedules: number
  priorityUrls: number
  crawlFiles: number
}

export const USAGE_KINDS = [
  'crawls',
  'urls',
  'rules',
  'rechecks',
  'schedules',
  'priorityUrls',
  'crawlFiles',
] as const satisfies readonly (keyof UsageCounts)[]

export function sumUsage(list: UsageCounts[]): UsageCounts {
  const total: UsageCounts = {
    crawls: 0,
    urls: 0,
    rules: 0,
    rechecks: 0,
    schedules: 0,
    priorityUrls: 0,
    crawlFiles: 0,
  }
  for (const usage of list) for (const kind of USAGE_KINDS) total[kind] += usage[kind]
  return total
}

/** The kinds of data with something in them, one line each; a sentence when there is none. */
export function UsageList({ usage }: { usage: UsageCounts }) {
  const t = useTranslations('Companies.delete')
  const present = USAGE_KINDS.filter((kind) => usage[kind] > 0)
  if (present.length === 0) return <p className="text-muted-foreground">{t('nothingStored')}</p>
  return (
    <ul className="list-disc pl-5 marker:text-muted-foreground">
      {present.map((kind) => (
        <li key={kind}>{t(`usage.${kind}`, { count: usage[kind] })}</li>
      ))}
    </ul>
  )
}
