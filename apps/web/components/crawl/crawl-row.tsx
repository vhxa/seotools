'use client'

import { ChevronDownIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/**
 * One crawl of the list: its short row, and under it, on demand, everything else about the crawl.
 * The row keeps its height whether the details are open or not (the details are a row of their
 * own below it), so opening one never moves the others' columns. The cells and the details are made
 * by the server; this only holds whether they are open.
 */
export function CrawlRow({
  cells,
  details,
  actions,
  columns,
}: {
  /** The `TableCell`s of the short row, one per column but the last. */
  cells: ReactNode
  /** What the details show. */
  details: ReactNode
  /** Links and buttons of the row. */
  actions: ReactNode
  /** How many columns the table has, for the details to span. */
  columns: number
}) {
  const t = useTranslations('Crawls')
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <>
      <TableRow className={cn(open && 'border-b-0')}>
        {cells}
        <TableCell className="align-top">
          <div className="flex items-center justify-end gap-3 text-xs">
            {actions}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => setOpen((value) => !value)}
            >
              {t('details.toggle')}
              <ChevronDownIcon
                aria-hidden
                className={cn('transition-transform', open && 'rotate-180')}
              />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow id={id} className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={columns} className="whitespace-normal">
            {details}
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
