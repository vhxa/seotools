'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ACCOUNT_TABS, accountTabHref, type AccountTab } from '@/lib/account-tabs'

/**
 * The tabs of the account page. The active one is in the address, and the server renders only that
 * tab's content (`children`). The list scrolls on a narrow screen instead of wrapping.
 */
export function AccountTabs({ active, children }: { active: AccountTab; children: ReactNode }) {
  const t = useTranslations('Account.tabs')
  const router = useRouter()
  return (
    <Tabs
      value={active}
      onValueChange={(value) => router.push(accountTabHref(value as AccountTab), { scroll: false })}
    >
      <TabsList
        variant="line"
        aria-label={t('label')}
        className="w-full justify-start overflow-x-auto"
      >
        {ACCOUNT_TABS.map((tab) => (
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
