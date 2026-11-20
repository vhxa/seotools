import { SkeletonPage, TabsSkeleton, TableSkeleton, ToolbarSkeleton } from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

/** The list of URLs: title, views, toolbar, and the table beside the findings panel. */
export default function UrlsLoading() {
  return (
    <SkeletonPage className="gap-4">
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-7 w-36" />
      </div>
      <TabsSkeleton count={6} />
      <ToolbarSkeleton buttons={4} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <TableSkeleton rows={10} columns={5} />
        <Skeleton className="hidden h-96 rounded-xl lg:block" />
      </div>
    </SkeletonPage>
  )
}
