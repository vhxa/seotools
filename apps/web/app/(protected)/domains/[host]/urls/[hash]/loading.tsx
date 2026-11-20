import { BlockCardSkeleton, SkeletonPage } from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

/** The detail of one URL: the way back, its address, and its sections. */
export default function UrlDetailLoading() {
  return (
    <SkeletonPage>
      <div className="grid justify-items-start gap-3">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-2/3 max-w-xl" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-6 w-28 rounded-full" />
      </div>
      <BlockCardSkeleton height="h-24" />
      <BlockCardSkeleton height="h-40" />
      <BlockCardSkeleton height="h-32" />
    </SkeletonPage>
  )
}
