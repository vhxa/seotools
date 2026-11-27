import { readCapacityContext } from '@seotools/db'
import { minimumCapacity } from '@seotools/core/capacity'
import { lastCapacitySample } from '@/lib/capacity'
import { renderBrowserStatus } from '@/lib/render-browser'
import { getBuildInfo } from '@/lib/build-info'
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
  const db = await getDb()
  const [settings, capacity, html, rendered, secrets, browser] = await Promise.all([
    db.crawls.settings(domain.id),
    readCapacityContext(db),
    lastCapacitySample(db, domain.id, 'html'),
    lastCapacitySample(db, domain.id, 'rendered'),
    db.crawls.requestSecrets(domain.id),
    renderBrowserStatus(),
  ])

  return (
    <>
      <div className="grid gap-1">
        <h2 className="text-base font-medium">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description', { host: domain.host })}</p>
      </div>
      <CrawlSettingsForm
        browserState={browser?.state ?? 'unknown'}
        renderSlots={(capacity.capacity ?? minimumCapacity).renders}
        hardware={capacity.hardware}
        samples={{ html, rendered }}
        host={domain.host}
        settings={settings}
        secretsSaved={Boolean(secrets)}
        defaultUserAgent={defaultCrawlerUserAgent(getBuildInfo().version)}
      />
    </>
  )
}
