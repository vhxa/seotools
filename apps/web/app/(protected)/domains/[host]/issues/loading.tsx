import {
  ListCardSkeleton,
  SectionTitleSkeleton,
  SkeletonPage,
  TableSkeleton,
  TitleSkeleton,
} from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

export default function IssuesLoading() {
  return (
    <SkeletonPage className="gap-8">
      <TitleSkeleton />
      <section className="grid gap-3">
        <SectionTitleSkeleton />
        <ListCardSkeleton rows={3} />
      </section>
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-40" />
      </div>
      <TableSkeleton rows={10} columns={4} />
    </SkeletonPage>
  )
}
