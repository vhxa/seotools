import type { CrawlUrl } from '@seotools/db'
import { StarIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { setPriorityUrlAction } from '@/app/(protected)/domains/[host]/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/** The pieces of a table of URLs, shared by the pages list and the priority pages settings. */

export function StatusCell({ row }: { row: Pick<CrawlUrl, 'statusCode' | 'error'> | undefined }) {
  if (!row) return <span className="text-muted-foreground">—</span>
  if (row.statusCode === null) return <Badge variant="destructive">{row.error ? '!' : '—'}</Badge>
  const failed = row.statusCode >= 400
  const moved = row.statusCode >= 300 && row.statusCode < 400
  return (
    <Badge variant={failed ? 'destructive' : moved ? 'secondary' : 'outline'}>
      {row.statusCode}
    </Badge>
  )
}

export const detailOf = (row: CrawlUrl | undefined) =>
  row?.error ?? row?.title ?? (row?.redirectTo && `→ ${row.redirectTo}`) ?? row?.contentType ?? '—'

export function UrlLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={url}
      className="block max-w-md truncate font-mono text-xs hover:underline"
    >
      {url}
    </a>
  )
}

/** A star that marks or unmarks a URL as priority, wherever the URL is listed. */
export function PriorityToggle({
  host,
  url,
  marked,
}: {
  host: string
  url: string
  marked: boolean
}) {
  return (
    <form action={setPriorityUrlAction.bind(null, host, url, !marked)}>
      <PriorityButton marked={marked} />
    </form>
  )
}

async function PriorityButton({ marked }: { marked: boolean }) {
  const t = await getTranslations('Pages.priority')
  const label = t(marked ? 'unmark' : 'mark')
  return (
    <Button type="submit" variant="ghost" size="icon" aria-label={label} title={label}>
      <StarIcon className={marked ? 'fill-current' : undefined} />
    </Button>
  )
}
