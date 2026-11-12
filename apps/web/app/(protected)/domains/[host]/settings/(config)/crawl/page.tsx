import { defaultCrawlerUserAgent } from '@seotools/core'
import { getTranslations } from 'next-intl/server'
import { CrawlSettingsForm } from '@/components/crawl/crawl-settings-form'
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
    <>
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description', { host: domain.host })}</p>
      </div>
      <CrawlSettingsForm
        host={domain.host}
        settings={settings}
        secretsSaved={Boolean(await (await getDb()).crawls.requestSecrets(domain.id))}
        defaultUserAgent={defaultCrawlerUserAgent(process.env.APP_VERSION)}
      />
    </>
  )
}
