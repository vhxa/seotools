import {
  BlockCardSkeleton,
  ListCardSkeleton,
  SectionTitleSkeleton,
  SkeletonPage,
  StatCardsSkeleton,
} from '@/components/skeletons'

/**
 * Shown while the overview of a domain loads (the other pages have a `loading.tsx` of their own,
 * which replaces this one). It lives under `[host]` and not in `(protected)` on purpose: a
 * `loading.tsx` makes the response stream with a 200 before the page runs, so a page that ends in
 * `notFound()` would no longer answer 404. The layout of `[host]` resolves the domain (and its
 * 404) outside this boundary; System pages have no skeleton for the same reason (`requireAdmin`
 * answers 404).
 */
export default function OverviewLoading() {
  return (
    <SkeletonPage className="gap-8">
      <section className="grid gap-3">
        <SectionTitleSkeleton />
        <StatCardsSkeleton className="lg:grid-cols-5" />
      </section>
      <section className="grid gap-3">
        <SectionTitleSkeleton />
        <BlockCardSkeleton height="h-64" />
        <BlockCardSkeleton height="h-40" />
      </section>
      <section className="grid gap-3">
        <SectionTitleSkeleton />
        <ListCardSkeleton />
      </section>
    </SkeletonPage>
  )
}
