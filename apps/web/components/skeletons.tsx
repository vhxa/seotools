import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * The pieces the `loading.tsx` of each page is made of, so that every page shows a skeleton with
 * its own shape (the same title, cards and tables it will have) and nothing moves when it loads.
 */

/** The `<main>` of a skeleton: announced as busy, with the gap of the pages. */
export function SkeletonPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main aria-busy="true" className={cn('grid gap-6', className)}>
      {children}
    </main>
  )
}

/** The title of a page, with the line under it when it has one. */
export function TitleSkeleton({ line = true }: { line?: boolean }) {
  return (
    <div className="grid gap-2">
      <Skeleton className="h-8 w-56 max-w-full" />
      {line && <Skeleton className="h-4 w-72 max-w-full" />}
    </div>
  )
}

/** The title of a section. */
export function SectionTitleSkeleton() {
  return <Skeleton className="h-5 w-40" />
}

/** A row of pill-shaped tabs or links. */
export function TabsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-2">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-7 w-24 rounded-full" />
      ))}
    </div>
  )
}

/** A row of `Stat` cards. */
export function StatCardsSkeleton({
  count = 5,
  className,
}: {
  count?: number
  className?: string
}) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3', className)}>
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} size="sm">
          <CardContent className="grid gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-4 w-12" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/** A card with a small title and a block (a chart, a form, a preview). */
export function BlockCardSkeleton({ height = 'h-48' }: { height?: string }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-44" />
      </CardHeader>
      <CardContent>
        <Skeleton className={cn('w-full', height)} />
      </CardContent>
    </Card>
  )
}

/** A table in its rounded frame: a header row and `rows` rows. */
export function TableSkeleton({
  rows = 8,
  columns = 4,
  className,
}: {
  rows?: number
  columns?: number
  className?: string
}) {
  return (
    <div className={cn('overflow-hidden rounded-xl border bg-card shadow-card', className)}>
      <div className="flex gap-4 border-b bg-muted/40 px-4 py-3">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className={cn('h-4', index === 0 ? 'w-1/3' : 'w-20')} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-4 border-b px-4 py-3.5 last:border-b-0">
          {Array.from({ length: columns }, (_, index) => (
            <Skeleton key={index} className={cn('h-4', index === 0 ? 'w-1/3' : 'w-20')} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** A list of rows separated by lines, in a card. */
export function ListCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y rounded-xl bg-card px-4 shadow-card ring-1 ring-foreground/10">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 py-3.5">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-4 w-1/2 max-w-md" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  )
}

/** A row of controls (a search field and some buttons). */
export function ToolbarSkeleton({ buttons = 3 }: { buttons?: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Skeleton className="h-8 w-56" />
      {Array.from({ length: buttons }, (_, index) => (
        <Skeleton key={index} className="h-8 w-24" />
      ))}
    </div>
  )
}
