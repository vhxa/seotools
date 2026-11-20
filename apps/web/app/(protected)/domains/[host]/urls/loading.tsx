import { SkeletonPage } from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The list of URLs: the same frame as the page (full height, with the width the findings panel
 * leaves on wide screens), the views and buttons, and the table card.
 */
export default function UrlsLoading() {
  return (
    <SkeletonPage className="flex h-[calc(100svh-5.75rem)] min-h-0 flex-col gap-3 md:-mb-4 md:h-[calc(100svh-6.25rem)] xl:pr-80">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-[395px] max-w-full rounded-lg" />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-20" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="flex shrink-0 gap-4 border-b bg-muted/40 px-4 py-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
        </div>
        {Array.from({ length: 12 }, (_, row) => (
          <div key={row} className="flex shrink-0 gap-4 border-b px-4 py-3.5 last:border-b-0">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  )
}
