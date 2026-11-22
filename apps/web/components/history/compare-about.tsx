'use client'

import { InfoIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'

/**
 * The button after the comparison's chips and the side drawer behind it: what the two crawls are,
 * the full summary and the totals, which the page keeps out of the way until they are asked for.
 */
export function CompareAbout({ children }: { children: ReactNode }) {
  const t = useTranslations('CrawlCompare.about')
  const tUrl = useTranslations('UrlDetail')
  return (
    <Drawer swipeDirection="right">
      <DrawerTrigger render={<Button type="button" variant="outline" size="xs" />}>
        <InfoIcon />
        {t('open')}
      </DrawerTrigger>
      <DrawerContent className="max-w-dvw data-[swipe-axis=x]:[--drawer-content-width:100%] data-[swipe-axis=x]:sm:[--drawer-content-width:36rem] [&_[data-slot=drawer-content]]:min-w-0">
        <DrawerHeader className="min-w-0 shrink-0 gap-1 border-b pr-14 pb-4">
          <DrawerTitle>{t('title')}</DrawerTitle>
          <DrawerDescription>{t('description')}</DrawerDescription>
          <DrawerClose
            render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" />}
          >
            <XIcon />
            <span className="sr-only">{tUrl('close')}</span>
          </DrawerClose>
        </DrawerHeader>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </DrawerContent>
    </Drawer>
  )
}
