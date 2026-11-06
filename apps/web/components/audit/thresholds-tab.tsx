import type { ThresholdOverrides } from '@seotools/core/crawl/thresholds'
import { getTranslations } from 'next-intl/server'
import { ThresholdsForm } from '@/components/audit/thresholds-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** The figures the domain's checks compare with, where it set its own. */
export async function ThresholdsTab({
  host,
  thresholds,
}: {
  host: string
  thresholds: ThresholdOverrides
}) {
  const t = await getTranslations('AuditRules.thresholds')
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ThresholdsForm host={host} thresholds={thresholds} />
      </CardContent>
    </Card>
  )
}
