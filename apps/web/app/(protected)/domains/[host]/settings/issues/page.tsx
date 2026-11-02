import { getTranslations } from 'next-intl/server'
import { IssueSettingsForm } from '@/components/pages/issue-settings-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('IssueSettings')
  return { title: t('metaTitle', { host }) }
}

export default async function IssueSettingsPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  const t = await getTranslations('IssueSettings')
  const { issueThreshold } = await (await getDb()).crawls.settings(domain.id)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description', { host: domain.host })}</CardDescription>
      </CardHeader>
      <CardContent>
        <IssueSettingsForm host={domain.host} threshold={issueThreshold} />
      </CardContent>
    </Card>
  )
}
