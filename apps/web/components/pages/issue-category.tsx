'use client'

import { ChevronRightIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

/**
 * A category of the issues list that opens and closes. The server renders what is inside it; this
 * only holds whether it is open. It is controlled, because it stays mounted while the address
 * changes: choosing an issue of a closed category (a link in the overview, the back button) opens
 * it, and closing one by hand is respected until the selection moves into it again.
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
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group/category flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open/category:rotate-90"
        />
        {header}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}
