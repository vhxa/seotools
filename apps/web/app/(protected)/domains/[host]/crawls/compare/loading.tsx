import { BlockCardSkeleton, SkeletonPage, TabsSkeleton, TextSkeleton } from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

/** The comparison: header of the area, the pair picker, the figures, the line of differences and the list. */
export default function CompareLoading() {
  return (
    <SkeletonPage>
      <div className="grid gap-3">
        <Skeleton className="h-7 w-32" />
        <TabsSkeleton count={3} />
        <TextSkeleton />
      </div>
      <div className="grid gap-3 lg:grid-cols-[3fr_4fr]">
        {[3, 4].map((cards) => (
          <div key={cards} className="grid gap-2">
            <Skeleton className="h-6 w-16" />
            <div
              className={`grid grid-cols-2 gap-3 ${cards === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}
            >
              {Array.from({ length: cards }, (_, index) => (
                <Skeleton key={index} className="h-[7.25rem] w-full rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-6 w-2/3" />
      <BlockCardSkeleton height="h-40" />
    </SkeletonPage>
  )
}
