import type { CrawlUrl } from '@seotools/db'
import { Badge } from '@/components/ui/badge'

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
