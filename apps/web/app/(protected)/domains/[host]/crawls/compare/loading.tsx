import {
  SkeletonPage,
  StatCardsSkeleton,
  TabsSkeleton,
  TableSkeleton,
} from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

/** The comparison of two crawls: heading, the two crawls to pick, the totals and the changes. */
export default function CompareLoading() {
  return (
    <SkeletonPage>
      <div className="grid gap-3">
        <Skeleton className="h-8 w-32" />
        <TabsSkeleton count={3} />
      </div>
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-64" />
      </div>
      <StatCardsSkeleton count={4} className="sm:grid-cols-4" />
      <TableSkeleton rows={8} columns={4} />
    </SkeletonPage>
  )
}
