'use client'

import { ExpandIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  createContext,
  useCallback,
  useContext,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { TableRow } from '@/components/ui/table'
import { compareHref, type CompareQuery } from '@/lib/compare-query'

/** What the drawer shows of one listed URL, rendered by the server with the rest of the page. */
export interface RowDetail {
  url: string
  /** The page of the URL, in the crawl that has it. */
  href: string
  body: ReactNode
}

const OpenRowContext = createContext<((hash: string) => void) | null>(null)

/**
 * The side drawer with the details of one URL of the list (the reason in full, the link as it was,
 * what a recheck answered), around the table that lists them. The page renders the details of the
 * rows it shows, so the drawer opens at once; which one is open is the address (`?row=`), so it can
 * be shared and the back button closes it.
 */
export function CompareDrawer({
  host,
  query,
  details,
  children,
}: {
  host: string
  query: CompareQuery
  details: Record<string, RowDetail>
  children: ReactNode
}) {
  const t = useTranslations('CrawlCompare.detail')
  const tUrl = useTranslations('UrlDetail')
  const router = useRouter()
  const [, startTransition] = useTransition()
  const current = query.row && details[query.row] ? query.row : null
  const [open, setOpen] = useState(current !== null)
  // The last one opened, kept for the drawer to show while it slides out.
  const [shown, setShown] = useState<string | null>(current)
  const [seen, setSeen] = useState(current)

  // The address changed under us: our own navigation arriving, or back and forward.
  if (current !== seen) {
    setSeen(current)
    if (current) {
      setShown(current)
      setOpen(true)
    } else {
      setOpen(false)
    }
  }

  const go = useCallback(
    (row: string | null) =>
      startTransition(() => router.push(compareHref(host, query, { row }), { scroll: false })),
    [host, query, router],
  )
  const openRow = useCallback(
    (hash: string) => {
      setShown(hash)
      setOpen(true)
      if (current !== hash) go(hash)
    },
    [current, go],
  )

  const detail = shown ? details[shown] : undefined
  return (
    <OpenRowContext.Provider value={openRow}>
      {children}
      <Drawer
        open={open}
        swipeDirection="right"
        onOpenChange={(next) => {
          if (!next) setOpen(false)
        }}
        onOpenChangeComplete={(next) => {
          if (!next && current) go(null)
        }}
      >
        <DrawerContent className="max-w-dvw data-[swipe-axis=x]:[--drawer-content-width:100%] data-[swipe-axis=x]:sm:[--drawer-content-width:36rem] [&_[data-slot=drawer-content]]:min-w-0">
          <DrawerHeader className="min-w-0 shrink-0 gap-2 border-b pr-14 pb-4">
            <DrawerTitle className="font-mono text-sm break-all">{detail?.url}</DrawerTitle>
            <DrawerDescription>{t('description')}</DrawerDescription>
            <div>
              {detail && (
                <Link
                  href={detail.href}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  <ExpandIcon />
                  {tUrl('openFullScreen')}
                </Link>
              )}
            </div>
            <DrawerClose
              render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" />}
            >
              <XIcon />
              <span className="sr-only">{tUrl('close')}</span>
            </DrawerClose>
          </DrawerHeader>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4">{detail?.body}</div>
        </DrawerContent>
      </Drawer>
    </OpenRowContext.Provider>
  )
}

/** The button that opens the details of a URL: the keyboard and screen reader way in. */
export function DetailsButton({ hash, url }: { hash: string; url: string }) {
  const t = useTranslations('CrawlCompare.detail')
  const open = useContext(OpenRowContext)
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      aria-label={t('openFor', { url })}
      onClick={() => open?.(hash)}
    >
      {t('open')}
    </Button>
  )
}

/** A row of the table that also opens the details when clicked (courtesy: the button is the way in). */
export function DetailRow({ hash, children }: { hash: string; children: ReactNode }) {
  const open = useContext(OpenRowContext)
  const onClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if (event.defaultPrevented || window.getSelection()?.toString()) return
    if ((event.target as HTMLElement).closest('a, button, input, [role=button]')) return
    open?.(hash)
  }
  return (
    <TableRow onClick={onClick} className="cursor-pointer hover:bg-muted/50 [&_td]:align-middle">
      {children}
    </TableRow>
  )
}
