import { ChevronDownIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

/** Keep the heading/name visible while explanations remain available to keyboard users. */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
}: {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="min-w-0">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-lg p-3 text-left text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&[aria-expanded=true]>svg]:rotate-180">
        <span className="min-w-0">{title}</span>
        <ChevronDownIcon aria-hidden className="size-4 shrink-0 transition-transform" />
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 px-3 pt-3 pb-3">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
