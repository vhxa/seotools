import { SkeletonPage, TableSkeleton, TabsSkeleton, TextSkeleton } from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

/** The list of crawls: the header of the area (title, run buttons, navigation, line) and the table. */
export default function CrawlsLoading() {
  return (
    <SkeletonPage>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Skeleton className="h-7 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-8 w-36" />
          </div>
        </div>
        <TabsSkeleton count={3} />
        <TextSkeleton />
      </div>
      <Skeleton className="h-5 w-96 max-w-full" />
      <TableSkeleton rows={4} columns={6} />
    </SkeletonPage>
  )
}
