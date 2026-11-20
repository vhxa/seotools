'use client'

import type { ComponentProps, ReactNode } from 'react'
import { useTransition } from 'react'
import { cancelCrawlAction } from '@/app/(protected)/domains/[host]/actions'
import { useCanEdit } from '@/components/domain-access'
import { Button } from '@/components/ui/button'
import { CRAWL_CHANGED_EVENT } from '@/lib/crawl-activity'

/**
 * Cancels a crawl and tells the sidebar's button at once, instead of leaving it to its next poll.
 * Nothing for viewers: the action decides, this is courtesy.
 */
export function CancelCrawlButton({
  host,
  crawlId,
  variant = 'outline',
  size = 'sm',
  children,
}: {
  host: string
  crawlId: string
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  children: ReactNode
}) {
  const canEdit = useCanEdit()
  const [pending, start] = useTransition()
  if (!canEdit) return null
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await cancelCrawlAction(host, crawlId)
          window.dispatchEvent(new Event(CRAWL_CHANGED_EVENT))
        })
      }
    >
      {children}
    </Button>
  )
}
