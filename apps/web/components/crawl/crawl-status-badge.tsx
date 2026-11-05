import type { CrawlStatus } from '@seotools/core'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'

const variants: Record<CrawlStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'secondary',
  completed: 'default',
  incomplete: 'secondary',
  failed: 'destructive',
  cancelled: 'outline',
}

export function CrawlStatusBadge({ status }: { status: CrawlStatus }) {
  const t = useTranslations('Crawl.status')
  if (status === 'completed') return <span className="text-sm">{t(status)}</span>
  return <Badge variant={variants[status]}>{t(status)}</Badge>
}
