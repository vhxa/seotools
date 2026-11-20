'use client'

import { EllipsisIcon, ListIcon, LoaderCircleIcon, StarIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { crawlActivityAction } from '@/app/(protected)/domains/[host]/activity-actions'
import { startCrawlAction, type ActionState } from '@/app/(protected)/domains/[host]/actions'
import { ListCrawlDialogPanel } from '@/components/crawl/list-crawl-dialog'
import { useCanEdit } from '@/components/domain-access'
import { RollingText } from '@/components/rolling-text'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  CRAWL_CHANGED_EVENT,
  newest,
  type CrawlActivity,
  type CrawlState,
} from '@/lib/crawl-activity'
import { offerActivity, readActivity, subscribeActivity } from '@/lib/crawl-activity-store'
import { CRAWL_SLOT_ID } from '@/lib/sidebar-nav'
import { cn } from '@/lib/utils'

/** A filled circle with the play triangle cut out, in the colours of the button around it. */
function PlayCircleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <path d="M6.4 4.9v6.2l5-3.1z" className="fill-primary" />
    </svg>
  )
}

/** How often the button asks what the crawl is doing: fast while it runs, slowly otherwise. */
const BUSY_POLL_MS = 2000
const IDLE_POLL_MS = 15000

/** The classes of the main button, shared with the placeholder so both occupy the same place. */
const FULL_BUTTON =
  'h-8 w-full justify-start gap-2.5 rounded-lg px-2 text-sm font-medium group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0'
const MORE_BUTTON = 'size-8 shrink-0 rounded-lg bg-background group-data-[collapsible=icon]:hidden'

/**
 * What the slot holds from the server's first paint, until `SidebarCrawlActions` hydrates and draws
 * the real buttons next to it (the stylesheet of the slot hides it then): the same two buttons,
 * disabled, so they do not appear late. Only for who can start a crawl; the others get nothing.
 */
export function CrawlActionsPlaceholder() {
  const tSidebar = useTranslations('Sidebar')
  const t = useTranslations('Crawl')
  return (
    <div data-placeholder="" className="flex gap-2">
      <div className="min-w-0 flex-1 group-data-[collapsible=icon]:flex-none">
        <Button type="button" disabled className={FULL_BUTTON}>
          <PlayCircleIcon className="size-4 shrink-0" />
          <span className="truncate group-data-[collapsible=icon]:hidden">
            {tSidebar('fullCrawl')}
          </span>
        </Button>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled
        className={MORE_BUTTON}
        aria-label={t('moreCrawls')}
      >
        <EllipsisIcon strokeWidth={3} />
      </Button>
    </div>
  )
}

const subscribeNever = () => () => {}
const findSlot = () => document.getElementById(CRAWL_SLOT_ID)

/**
 * Starts a crawl from the sidebar: "Full Crawl" and, in a menu, a crawl of the priority pages and a
 * crawl of a URL list. While a crawl runs both are disabled and the button says how far it is
 * (pages done/known) and, once every page was requested, that it is processing: the text rolls from
 * one to the next. The domain layout renders it (it knows whether the domain is archived and what
 * the crawl is doing) and it draws into the sidebar's slot. Nothing for viewers.
 */
export function SidebarCrawlActions({ host, initial }: { host: string; initial: CrawlActivity }) {
  const canEdit = useCanEdit()
  const t = useTranslations('Crawl')
  const tSidebar = useTranslations('Sidebar')
  const tList = useTranslations('Crawls.list')
  // The slot is in the sidebar, outside this tree: it is read in the browser only.
  const slot = useSyncExternalStore(subscribeNever, findSlot, () => null)
  const [listOpen, setListOpen] = useState(false)
  const router = useRouter()
  // What a page render and a poll say can arrive in any order, and React may render this with older
  // props while a newer render is pending: the newest reading, kept outside React, always wins.
  const activity = useSyncExternalStore(
    subscribeActivity,
    () => newest(readActivity(host), initial),
    () => initial,
  )
  const latest = useRef(activity)
  useEffect(() => {
    latest.current = activity
    offerActivity(host, initial)
  })
  const crawling = activity.state.kind !== 'idle'
  const poll = useCallback(async () => {
    if (document.visibilityState !== 'visible') return
    try {
      const next = await crawlActivityAction(host)
      const before = latest.current
      // A crawl that has just ended changed what the pages show.
      if (before.state.kind !== 'idle' && next.state.kind === 'idle' && next.at >= before.at)
        router.refresh()
      offerActivity(host, next)
    } catch {
      // A failed read keeps what the button shows; the next one tries again.
    }
  }, [host, router])
  useEffect(() => {
    const id = setInterval(poll, crawling ? BUSY_POLL_MS : IDLE_POLL_MS)
    // A cancel made on a page of the area changed it now.
    window.addEventListener(CRAWL_CHANGED_EVENT, poll)
    return () => {
      clearInterval(id)
      window.removeEventListener(CRAWL_CHANGED_EVENT, poll)
    }
  }, [poll, crawling])
  const [full, runFull, fullPending] = useActionState<ActionState, FormData>(
    startCrawlAction.bind(null, host, 'full'),
    {},
  )
  const [priority, runPriority, priorityPending] = useActionState<ActionState, FormData>(
    startCrawlAction.bind(null, host, 'priority'),
    {},
  )
  // A start from a page the server does not draw again leaves the button idle until the next poll:
  // ask as soon as the action answers.
  useEffect(() => {
    const id = setTimeout(poll, 300)
    return () => clearTimeout(id)
  }, [full, priority, poll])
  const submitting = fullPending || priorityPending
  const disabled = crawling || submitting
  // From the click on it is starting, not idle: there is no moment in between with the old text.
  const shown: CrawlState =
    activity.state.kind === 'idle' && submitting
      ? { kind: 'starting', crawlId: '' }
      : activity.state
  const label =
    shown.kind === 'crawling'
      ? tSidebar('crawlProgress', { done: shown.done, total: shown.total })
      : shown.kind === 'processing'
        ? tSidebar('processing')
        : shown.kind === 'starting'
          ? tSidebar('starting')
          : tSidebar('fullCrawl')
  const working = shown.kind === 'processing' || shown.kind === 'starting'

  if (!canEdit || !slot) return null
  const error = full.error ?? priority.error
  return createPortal(
    <div className="grid gap-1">
      <div className="flex gap-2">
        <form action={runFull} className="min-w-0 flex-1 group-data-[collapsible=icon]:flex-none">
          <Button
            type="submit"
            disabled={disabled}
            aria-label={label}
            title={shown.kind !== 'idle' ? label : undefined}
            className={cn(FULL_BUTTON, 'disabled:opacity-100')}
          >
            {working ? (
              <LoaderCircleIcon
                key="working"
                aria-hidden="true"
                className="size-4 shrink-0 animate-spin"
              />
            ) : (
              <PlayCircleIcon key="idle" className="size-4 shrink-0" />
            )}
            <RollingText text={label} className="group-data-[collapsible=icon]:hidden" />
          </Button>
        </form>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={crawling}
            render={
              <Button
                variant="outline"
                size="icon"
                className={MORE_BUTTON}
                aria-label={t('moreCrawls')}
              />
            }
          >
            <EllipsisIcon strokeWidth={3} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuItem
              disabled={disabled}
              onClick={() =>
                (
                  document.getElementById('sidebar-priority-crawl') as HTMLFormElement | null
                )?.requestSubmit()
              }
            >
              <StarIcon />
              {t('start.priority')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={disabled} onClick={() => setListOpen(true)}>
              <ListIcon />
              {tList('open')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Outside the row: an empty form would count as one more item of its gap. */}
      <form action={runPriority} id="sidebar-priority-crawl" hidden />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <ListCrawlDialogPanel host={host} open={listOpen} onOpenChange={setListOpen} />
    </div>,
    slot,
  )
}
