'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

/** Rows own both scroll axes. The footer stays outside that single scroll surface. */
export function ResultsTable({
  children,
  footer,
  fill = false,
}: {
  children: ReactNode
  footer: ReactNode
  fill?: boolean
}) {
  const t = useTranslations('ResultsTable')
  const viewport = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const content = viewport.current
    if (!content) return
    const measure = () => {
      const url = content.querySelector<HTMLElement>('.results-url')
      content.dataset.pinUrl = String(
        content.clientWidth >= 768 && (url?.offsetWidth ?? 0) < content.clientWidth - 320,
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    if (content.firstElementChild) observer.observe(content.firstElementChild)
    measure()
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className={cn(
        'results-table flex min-h-0 min-w-0 flex-col rounded-md border',
        fill && 'flex-1',
      )}
    >
      <div
        ref={viewport}
        role="region"
        aria-label={t('rows')}
        tabIndex={0}
        className={cn(
          'min-h-0 overflow-auto overscroll-contain rounded-t-md outline-none focus-visible:ring-2 focus-visible:ring-ring [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20 [&_thead]:bg-muted',
          fill ? 'flex-1' : 'max-h-[calc(100svh-18rem)]',
        )}
      >
        {children}
      </div>
      <div className="shrink-0 rounded-b-md border-t bg-muted/40 px-3 py-2">{footer}</div>
    </div>
  )
}
