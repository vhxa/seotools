'use client'

import { XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { TableCell, TableRow } from '@/components/ui/table'

/**
 * One crawl of the list: its short row and, on demand, a side drawer with everything else about it
 * (the same drawer the detail of a URL uses). The drawer opens the moment the row or its "Details"
 * button is activated; its body is made by the server and whatever it loads (`CrawlDetailsLoader`)
 * shows its own skeleton. The row never changes size, so nothing under or beside it moves.
 *
 * The button is the way in for the keyboard and for assistive technology; clicking anywhere else on
 * the row is a courtesy for the mouse, and never takes over a link or a button of the row.
 */
export function CrawlRow({
  cells,
  actions,
  title,
  description,
  details,
}: {
  /** The `TableCell`s of the row, but the last one. */
  cells: ReactNode
  /** The links and buttons of the row's last cell, before "Details". */
  actions: ReactNode
  /** What the drawer is about: the crawl's date. */
  title: string
  /** The crawl's type and state, for the drawer's header. */
  description: ReactNode
  /** The sections of the drawer. */
  details: ReactNode
}) {
  const t = useTranslations('Crawls.details')
  const [open, setOpen] = useState(false)
  const onRowClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if (event.defaultPrevented || window.getSelection()?.toString()) return
    if ((event.target as HTMLElement).closest('a, button, summary, input, [role="button"]')) return
    setOpen(true)
  }
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onRowClick}>
        {cells}
        <TableCell>
          <div className="flex items-center justify-end gap-3 text-xs">
            {actions}
            <Button
              type="button"
              variant="outline"
              size="xs"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              {t('open')}
            </Button>
          </div>
        </TableCell>
      </TableRow>
      <Drawer open={open} swipeDirection="right" onOpenChange={setOpen}>
        <DrawerContent className="max-w-dvw data-[swipe-axis=x]:[--drawer-content-width:100%] data-[swipe-axis=x]:sm:[--drawer-content-width:32rem] [&_[data-slot=drawer-content]]:min-w-0">
          <DrawerHeader className="min-w-0 shrink-0 gap-1 border-b pr-14 pb-4">
            <DrawerTitle className="text-base">{title}</DrawerTitle>
            <DrawerDescription className="flex flex-wrap items-center gap-2">
              {description}
            </DrawerDescription>
            <DrawerClose
              render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" />}
            >
              <XIcon />
              <span className="sr-only">{t('close')}</span>
            </DrawerClose>
          </DrawerHeader>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4">{details}</div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
