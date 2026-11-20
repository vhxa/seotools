import {
  SectionTitleSkeleton,
  SkeletonPage,
  TableSkeleton,
  TitleSkeleton,
} from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

export default function StructureLoading() {
  return (
    <SkeletonPage className="gap-8">
      <TitleSkeleton />
      <section className="grid gap-3">
        <SectionTitleSkeleton />
        <Skeleton className="h-5 w-64" />
        <TableSkeleton rows={8} columns={4} />
      </section>
    </SkeletonPage>
  )
}
