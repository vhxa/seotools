import {
  BlockCardSkeleton,
  SkeletonPage,
  StatCardsSkeleton,
  TitleSkeleton,
} from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

/** A crawl file (robots.txt, sitemaps, llms.txt…): title, its check, the figures and the content. */
export default function CrawlFilesLoading() {
  return (
    <SkeletonPage>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleSkeleton />
        <Skeleton className="h-8 w-32" />
      </div>
      <StatCardsSkeleton count={3} />
      <BlockCardSkeleton height="h-64" />
    </SkeletonPage>
  )
}
