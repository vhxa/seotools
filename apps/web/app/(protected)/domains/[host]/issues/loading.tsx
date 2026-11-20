import {
  ListCardSkeleton,
  SectionTitleSkeleton,
  SkeletonPage,
  StatCardsSkeleton,
  TitleSkeleton,
} from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

export default function IssuesLoading() {
  return (
    <SkeletonPage className="gap-8">
      <TitleSkeleton />
      <StatCardsSkeleton count={3} columns="grid-cols-1 @xl:grid-cols-3" hint />
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-full sm:w-64" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-16" />
      </div>
      <section className="grid gap-3">
        <SectionTitleSkeleton />
        <ListCardSkeleton rows={6} />
      </section>
      <section className="grid gap-3">
        <SectionTitleSkeleton />
        <ListCardSkeleton rows={3} />
      </section>
    </SkeletonPage>
  )
}
