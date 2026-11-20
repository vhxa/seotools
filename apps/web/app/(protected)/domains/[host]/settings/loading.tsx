import { BlockCardSkeleton } from '@/components/skeletons'

/** A section of the settings: the layout (title and section list) stays; this is its form. */
export default function SettingsLoading() {
  return (
    <div aria-busy="true" className="grid gap-6">
      <BlockCardSkeleton height="h-32" />
      <BlockCardSkeleton height="h-48" />
    </div>
  )
}
