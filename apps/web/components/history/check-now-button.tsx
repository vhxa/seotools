'use client'

import { RefreshCwIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { checkComparedUrlsAction } from '@/app/(protected)/domains/[host]/verify-actions'
import { useCanEdit } from '@/components/domain-access'
import { Button } from '@/components/ui/button'

/**
 * "Check now": requests again URLs one crawl of the pair has and the other lacks, through a recheck
 * based on the crawl that has them, to see what they answer today. Only for people who may edit the
 * domain; while the domain is rechecking, the button is disabled and links to that recheck.
 */
export function CheckNowButton({
  host,
  from,
  to,
  side,
  urlHashes,
  activeRecheckId,
  scope = 'url',
}: {
  host: string
  from: string
  to: string
  side: 'base' | 'target'
  urlHashes: string[]
  activeRecheckId: string | null
  /** One row, or every row of the page. */
  scope?: 'url' | 'page'
}) {
  const canEdit = useCanEdit()
  const t = useTranslations('CrawlCompare.check')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!canEdit || urlHashes.length === 0) return null
  const start = () =>
    startTransition(async () => {
      setError(null)
      const state = await checkComparedUrlsAction(host, { from, to, side, urlHashes })
      if (state.error) setError(state.error)
      else router.refresh()
    })

  return (
    <div className="grid justify-items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size={scope === 'page' ? 'sm' : 'xs'}
        disabled={pending || activeRecheckId !== null}
        onClick={start}
      >
        <RefreshCwIcon className={pending ? 'animate-spin' : undefined} />
        {pending ? t('starting') : t(scope === 'page' ? 'page' : 'url')}
      </Button>
      {activeRecheckId !== null && scope === 'page' && (
        <Link
          href={`/domains/${host}/crawls/rechecks/${activeRecheckId}`}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {t('busy')}
        </Link>
      )}
      {error && (
        <p role="alert" className="max-w-72 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
