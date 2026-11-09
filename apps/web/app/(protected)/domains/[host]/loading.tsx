import { Skeleton } from '@/components/ui/skeleton'

/**
 * Shown while a page of a domain loads: a title, a row of figures and a block. It lives here and not
 * in `(protected)` on purpose: a `loading.tsx` makes the response stream with a 200 before the page
 * runs, so a page that ends in `notFound()` would no longer answer 404. The layout of `[host]`
 * resolves the domain (and its 404) outside this boundary; System pages have no skeleton for the
 * same reason (`requireAdmin` answers 404).
 */
export default function ProtectedLoading() {
  return (
    <main className="grid gap-8" aria-busy="true">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-48 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </main>
  )
}
