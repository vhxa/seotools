import { defaultCrawlerUserAgent } from '@seotools/core'
import { getTranslations } from 'next-intl/server'
import { CrawlSettingsForm } from '@/components/crawl/crawl-settings-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('CrawlSettings')
  return { title: t('metaTitle', { host }) }
}

export default async function CrawlSettingsPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  const t = await getTranslations('CrawlSettings')
  const settings = await (await getDb()).crawls.settings(domain.id)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description', { host: domain.host })}</CardDescription>
      </CardHeader>
      <CardContent>
        <CrawlSettingsForm
          host={domain.host}
          settings={settings}
          secretsSaved={Boolean(await (await getDb()).crawls.requestSecrets(domain.id))}
          defaultUserAgent={defaultCrawlerUserAgent(process.env.APP_VERSION)}
        />
      </CardContent>
    </Card>
  )
}
