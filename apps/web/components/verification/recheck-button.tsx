'use client'

import { useCanEdit } from '@/components/domain-access'
import { RefreshCwIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { recheckUrlsAction } from '@/app/(protected)/domains/[host]/verify-actions'
import { Button } from '@/components/ui/button'

/**
 * Asks for some URLs to be requested again, without a crawl. The worker does it in the background:
 * this only queues it, and the page shows how it goes (`RecheckBanner`, and the URL's own section).
 * Why it could not be queued is said under the button.
 */
export function RecheckButton({
  host,
  urls,
  disabled,
  variant = 'outline',
}: {
  host: string
  urls: string[]
  /** The domain is already rechecking: a domain does one recheck at a time. */
  disabled?: boolean
  variant?: 'default' | 'outline'
}) {
  const canEdit = useCanEdit()
  const t = useTranslations('Verification')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const start = () =>
    startTransition(async () => {
      setError(null)
      const state = await recheckUrlsAction(host, urls)
      if (state.error) setError(state.error)
      else router.refresh()
    })

  if (!canEdit) return null
  return (
    <div className="grid justify-items-start gap-1">
      <Button variant={variant} size="sm" disabled={disabled || pending} onClick={start}>
        <RefreshCwIcon className={pending ? 'animate-spin' : undefined} />
        {pending ? t('starting') : t('recheckUrl')}
      </Button>
      {error && (
        <p role="alert" className="max-w-72 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
