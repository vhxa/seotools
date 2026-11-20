import { BlockCardSkeleton, SkeletonPage, TabsSkeleton, TextSkeleton } from '@/components/skeletons'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/** The comparison: header of the area, the pair picker, the two crawls, the totals and the changes. */
export default function CompareLoading() {
  return (
    <SkeletonPage>
      <div className="grid gap-3">
        <Skeleton className="h-7 w-32" />
        <TabsSkeleton count={3} />
        <TextSkeleton />
      </div>
      <Skeleton className="h-[68px] w-full rounded-xl" />
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1].map((index) => (
          <Card key={index} size="sm">
            <CardHeader>
              <Skeleton className="h-5 w-16" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      <BlockCardSkeleton height="h-40" />
    </SkeletonPage>
  )
}
