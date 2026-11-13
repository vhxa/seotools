import {
  GOOGLE_VITALS_KEY,
  googleVitalsKeySchema,
  RENDER_STATUS_KEY,
  readRenderStatus,
  renderStatusSchema,
} from '@seotools/core'
import { getTranslations } from 'next-intl/server'
import { RenderBrowserCard } from '@/components/render-browser-card'
import { IntegrationsForm } from '@/components/integrations-form'
import { requireAdmin } from '@/lib/session'
import { getSettings } from '@/lib/settings'

export default async function IntegrationsPage() {
  await requireAdmin()
  const t = await getTranslations('Vitals')
  const key = await (await getSettings()).readJson(GOOGLE_VITALS_KEY, googleVitalsKeySchema)
  const stored = await (
    await getSettings()
  )
    .getJson(RENDER_STATUS_KEY, renderStatusSchema)
    .catch(() => null)
  const browser = readRenderStatus(stored)
  return (
    <main className="grid gap-6">
      <h1 className="text-2xl font-semibold">{t('integrations')}</h1>
      <RenderBrowserCard status={browser} />
      <IntegrationsForm
        configured={key.state === 'ready'}
        unreadable={key.state === 'undecryptable'}
      />
    </main>
  )
}
