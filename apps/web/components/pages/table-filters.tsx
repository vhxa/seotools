'use client'

import { Popover } from '@base-ui/react/popover'
import { SlidersHorizontalIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export function TableFilters({ children }: { children: ReactNode }) {
  const t = useTranslations('PagesDetails')
  return (
    <Popover.Root>
      <Popover.Trigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontalIcon />
        {t('filtersMenu')}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="z-40">
          <Popover.Popup className="grid max-h-[min(32rem,80svh)] w-[min(22rem,calc(100vw-2rem))] gap-4 overflow-y-auto rounded-lg border bg-popover p-4 text-popover-foreground shadow-md">
            <Popover.Title className="font-medium">{t('filtersMenu')}</Popover.Title>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
