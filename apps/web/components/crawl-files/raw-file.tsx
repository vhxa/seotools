'use client'

import { ChevronRightIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

/** A file as the site serves it, hidden until asked for: it can be half a megabyte. */
export function RawFile({ body, truncated }: { body: string; truncated: boolean }) {
  const t = useTranslations('CrawlFiles.raw')
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="grid gap-2">
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="justify-self-start" />}
      >
        <ChevronRightIcon className={cn('transition-transform', open && 'rotate-90')} />
        {t(open ? 'hide' : 'show')}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-[32rem] overflow-auto rounded-md border bg-muted/50 p-4 font-mono text-xs break-words whitespace-pre-wrap">
          {body}
        </pre>
        {truncated && <p className="mt-2 text-xs text-muted-foreground">{t('truncated')}</p>}
      </CollapsibleContent>
    </Collapsible>
  )
}
