import type { VerificationStatus } from '@seotools/core/crawl/verification'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'

const variants: Record<VerificationStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'secondary',
  completed: 'default',
  failed: 'destructive',
  cancelled: 'outline',
}

export function RecheckStatusBadge({ status }: { status: VerificationStatus }) {
  const t = useTranslations('Verification.status')
  return <Badge variant={variants[status]}>{t(status)}</Badge>
}
