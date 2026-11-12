'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { StarIcon } from 'lucide-react'
import { toggleFavouriteAction } from '@/app/(protected)/favourite-actions'
import { Button } from '@/components/ui/button'

export function FavouriteDomainButton({ host, favourite }: { host: string; favourite: boolean }) {
  const t = useTranslations('FavouriteDomain')
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t(favourite ? 'clear' : 'set', { host })}
      aria-pressed={favourite}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await toggleFavouriteAction(host)
        })
      }
    >
      <StarIcon aria-hidden="true" className={favourite ? 'fill-current text-amber-600' : ''} />
    </Button>
  )
}
