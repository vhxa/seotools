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
import { Skeleton } from '@/components/ui/skeleton'
import { detailHref, type DetailQuery } from '@/lib/pages-query'

/** A URL of the crawl, by the hash that identifies it in the address. */
export interface DrawerTarget {
  hash: string
  url: string
}

const OpenUrlContext = createContext<((target: DrawerTarget) => void) | null>(null)

/** Opens the drawer on a URL, or `null` when there is no drawer around (the page of a URL). */
export const useOpenUrl = () => useContext(OpenUrlContext)

/**
 * A link to a URL's detail. Inside the drawer's page it opens the drawer on the spot; anywhere
 * else, and for a click that asks for a new tab or window, it is a plain link to `href`.
 */
export function OpenUrlLink({
  target,
  href,
  className,
  title,
  children,
}: {
  target: DrawerTarget
  href: string
  className?: string
  title?: string
  children: ReactNode
}) {
  const open = useOpenUrl()
  if (!open) {
    return (
      <Link href={href} scroll={false} className={className} title={title}>
        {children}
      </Link>
    )
  }
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    open(target)
  }
  return (
    <a href={href} onClick={onClick} className={className} title={title}>
      {children}
    </a>
  )
}

/** What the drawer shows while the server is still sending the detail of a URL. */
function DetailSkeleton() {
  const t = useTranslations('UrlDetail')
  return (
    <div role="status" aria-busy="true" aria-label={t('loading')} className="grid gap-6">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-12 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="h-4 w-32" />
      </div>
      {[5, 4, 6].map((rows, section) => (
        <div key={section} className="grid gap-3">
          <Skeleton className="h-4 w-24" />
          <div className="grid gap-2">
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className="grid grid-cols-[8rem_1fr] gap-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-full max-w-72" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The side drawer with the detail of a URL, around whatever lists the URLs (`children`).
 *
 * It opens the moment a URL is chosen, with that URL in the title and a skeleton in the body, and
 * the detail replaces the skeleton when the server has it: the server renders it (`detail`) for
 * the URL in the address (`?url=…`, so it can be shared and the back button works), and that is
 * what `current` and `detail` carry. Closing slides it away first and takes the URL out of the
 * address afterwards.
 */
export function UrlDrawer({
  host,
  query,
  current,
  detail,
  children,
}: {
  host: string
  query: DetailQuery
  /** The URL in the address, if the crawl has it. */
  current: DrawerTarget | null
  /** Its detail, rendered by the server. */
  detail: ReactNode
  children: ReactNode
}) {
  const t = useTranslations('UrlDetail')
  const router = useRouter()
  const [loading, startTransition] = useTransition()
  const [open, setOpen] = useState(current !== null)
  const [target, setTarget] = useState<DrawerTarget | null>(current)
  // The last detail the server sent, kept for the drawer to show while it slides out.
  const [shown, setShown] = useState(current ? { ...current, detail } : null)
  const [seen, setSeen] = useState(current?.hash ?? null)

  // The address changed under us: our own navigation arriving, or back and forward.
  if ((current?.hash ?? null) !== seen) {
    setSeen(current?.hash ?? null)
    if (current) {
      setTarget(current)
      setOpen(true)
    } else {
      setOpen(false)
    }
  }
  if (current && detail !== shown?.detail) setShown({ ...current, detail })

  const openUrl = useCallback(
    (next: DrawerTarget) => {
      setTarget(next)
      setOpen(true)
      if (current?.hash === next.hash) return
      startTransition(() =>
        router.push(detailHref(host, query, { url: next.hash }), { scroll: false }),
      )
    },
    [current?.hash, host, query, router],
  )
  const body =
    shown && target && shown.hash === target.hash ? (
      shown.detail
    ) : target && !loading ? (
      <p className="text-sm text-muted-foreground">{t('notFound')}</p>
    ) : (
      <DetailSkeleton />
    )

  return (
    <OpenUrlContext.Provider value={openUrl}>
      {children}
      <Drawer
        open={open}
        swipeDirection="right"
        onOpenChange={(next) => {
          if (!next) setOpen(false)
        }}
        onOpenChangeComplete={(next) => {
          if (!next && current) {
            router.push(detailHref(host, query, { url: null }), { scroll: false })
          }
        }}
      >
        <DrawerContent className="data-[swipe-axis=x]:sm:[--drawer-content-width:36rem]">
          <DrawerHeader className="gap-2 border-b pr-14 pb-4">
            <DrawerTitle className="font-mono text-sm break-all">{target?.url}</DrawerTitle>
            <DrawerDescription>{t('drawerDescription')}</DrawerDescription>
            <div>
              {target && (
                <Link
                  href={`/domains/${host}/pages/details/${target.hash}${query.crawl ? `?crawl=${query.crawl}` : ''}`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  <ExpandIcon />
                  {t('openFullScreen')}
                </Link>
              )}
            </div>
            <DrawerClose
              render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" />}
            >
              <XIcon />
              <span className="sr-only">{t('close')}</span>
            </DrawerClose>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{body}</div>
        </DrawerContent>
      </Drawer>
    </OpenUrlContext.Provider>
  )
}
