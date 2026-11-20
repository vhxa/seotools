'use client'

import { ChevronRightIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

/**
 * A category of the issues list that opens and closes. The server renders what is inside it; this
 * only holds whether it is open. It is controlled, because it stays mounted while the address
 * changes: choosing an issue of a closed category (a link in the overview, the back button) opens
 * it, and closing one by hand is respected until the selection moves into it again. It looks like
 * a section of the main sidebar.
 */
export function IssueCategory({
  holdsSelection,
  header,
  children,
}: {
  /** The issue the table is filtered by is one of this category's. */
  holdsSelection: boolean
  header: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(holdsSelection)
  const [wasHolding, setWasHolding] = useState(holdsSelection)
  // Adjusted while rendering, so the first paint already has it right.
  if (holdsSelection !== wasHolding) {
    setWasHolding(holdsSelection)
    if (holdsSelection) setOpen(true)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} render={<SidebarMenuItem />}>
      <CollapsibleTrigger
        render={<SidebarMenuButton className="h-8 gap-2.5 px-2 text-sm font-medium" />}
      >
        <ChevronRightIcon
          aria-hidden
          className={cn('shrink-0 transition-transform', open && 'rotate-90')}
        />
        {header}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}
