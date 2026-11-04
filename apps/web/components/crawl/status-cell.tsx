import type { CrawlUrl } from '@seotools/db'
import { useTranslations } from 'next-intl'
import { httpStatusVariant } from '@/lib/http-status'
import { Badge } from '@/components/ui/badge'

export function StatusCell({
  row,
  automaticCheck = false,
}: {
  row: Pick<CrawlUrl, 'statusCode' | 'error'> | undefined
  automaticCheck?: boolean
}) {
  const t = useTranslations('HttpStatus')
  const tStatus = useTranslations('Common.status')
  if (!row) return <span className="text-muted-foreground">—</span>
  if (row.statusCode === null) {
    const label = row.error ? tStatus('failed') : tStatus('noResponse')
    return (
      <Badge variant={row.error ? 'destructive' : 'outline'} title={row.error ?? undefined}>
        {label}
      </Badge>
    )
  }
  const missing = automaticCheck && (row.statusCode === 404 || row.statusCode === 410)
  return (
    <Badge
      variant={httpStatusVariant(row.statusCode, automaticCheck)}
      title={automaticCheck ? t('automaticCheck') : undefined}
    >
      {row.statusCode}
      {missing && <> · {t('notFound')}</>}
      {automaticCheck && <> · {t('automaticCheck')}</>}
    </Badge>
  )
}
