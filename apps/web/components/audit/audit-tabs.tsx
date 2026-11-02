'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AUDIT_TABS, auditTabHref, type AuditTab } from '@/lib/audit-tabs'

/**
 * The tabs of Settings → Audit. The active one is in the address, so that saving, cancelling and
 * coming back keep it; the server renders only that tab's content (`children`). Arrow keys move
 * between tabs, and the list scrolls on a narrow screen instead of wrapping.
 */
export function AuditTabs({
  host,
  active,
  children,
}: {
  host: string
  active: AuditTab
  children: ReactNode
}) {
  const t = useTranslations('AuditRules.tabs')
  const router = useRouter()
  return (
    <Tabs
      value={active}
      onValueChange={(value) =>
        router.push(auditTabHref(host, value as AuditTab), { scroll: false })
      }
    >
      <TabsList
        variant="line"
        aria-label={t('label')}
        className="w-full justify-start overflow-x-auto"
      >
        {AUDIT_TABS.map((tab) => (
          <TabsTrigger key={tab} value={tab} className="flex-none px-3">
            {t(tab)}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={active} className="grid gap-4 text-base">
        {children}
      </TabsContent>
    </Tabs>
  )
}
