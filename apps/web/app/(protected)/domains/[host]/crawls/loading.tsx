import { SkeletonPage, TabsSkeleton, TableSkeleton } from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

/** The Crawls area (its list and rechecks): heading with the run buttons, tabs, and the table. */
export default function CrawlsLoading() {
  return (
    <SkeletonPage>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Skeleton className="h-8 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-8 w-36" />
          </div>
        </div>
        <TabsSkeleton count={3} />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <TableSkeleton rows={8} columns={6} />
    </SkeletonPage>
  )
}
