import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { SettingsNav } from '@/components/settings-nav'
import { cn } from '@/lib/utils'
import { requireDomain } from '@/lib/workspace'

/** A layout does not protect what it wraps: each section still calls `requireDomain` itself. */
export default async function DomainSettingsLayout({
  params,
  children,
}: {
  params: Promise<{ host: string }>
  children: ReactNode
}) {
  const { host } = await params
  const { domain, canEdit } = await requireDomain(host)
  const readOnly = domain.archivedAt !== null || !canEdit
  const t = await getTranslations('DomainSettings')
  return (
    <main className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
      </div>
      <div className="grid items-start gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
        <SettingsNav host={domain.host} />
        {/* Inert for who cannot change them, or while archived: the actions refuse either way. */}
        <div className={cn('grid min-w-0 gap-6', readOnly && 'opacity-60')} inert={readOnly}>
          {children}
        </div>
      </div>
    </main>
  )
}
