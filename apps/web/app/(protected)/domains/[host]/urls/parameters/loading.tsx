import { SkeletonPage, TableSkeleton, TitleSkeleton } from '@/components/skeletons'

export default function ParametersLoading() {
  return (
    <SkeletonPage>
      <TitleSkeleton />
      <TableSkeleton rows={8} columns={4} />
    </SkeletonPage>
  )
}
