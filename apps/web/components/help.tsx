'use client'

import { Popover } from '@base-ui/react/popover'
import { ChevronDownIcon, InfoIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

/** A hoverable help button that also opens on click, touch, Enter or Space. */
export function InfoHelp({
  label,
  children,
  compact,
}: {
  label: string
  children: ReactNode
  /** A smaller button, for dense forms. */
  compact?: boolean
}) {
  const t = useTranslations('Help')
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        closeDelay={150}
        aria-label={t('about', { subject: label })}
        className={`inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${compact ? 'size-6' : 'size-8'}`}
      >
        <InfoIcon aria-hidden className={compact ? 'size-3.5' : 'size-4'} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} className="z-50">
          <Popover.Popup className="relative max-w-[min(20rem,calc(100vw-2rem))] rounded-lg border bg-popover p-4 pr-10 text-sm text-popover-foreground shadow-md">
            <Popover.Title className="sr-only">{label}</Popover.Title>
            <Popover.Description render={<div />}>{children}</Popover.Description>
            <Popover.Close
              aria-label={t('close')}
              className="absolute top-1 right-1 inline-flex size-8 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <XIcon aria-hidden className="size-4" />
            </Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function HelpDisclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Collapsible className="min-w-0">
      <CollapsibleTrigger className="flex items-center gap-2 rounded-md py-2 text-left text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&[aria-expanded=true]>svg]:rotate-180">
        <ChevronDownIcon aria-hidden className="size-4 shrink-0 transition-transform" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-3 py-2 text-sm text-muted-foreground">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
