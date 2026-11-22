'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import {
  loadPairedExamplesAction,
  type PairedExamplesResult,
} from '@/app/(protected)/domains/[host]/crawl-details-actions'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The URLs a crawl's paired check found answering differently. They are read when the details of the
 * crawl open (this mounts with the drawer), with a skeleton of the same size meanwhile.
 */
export function PairedExamples({ host, crawlId }: { host: string; crawlId: string }) {
  const t = useTranslations('PairedAnswers')
  const [result, setResult] = useState<PairedExamplesResult | 'failed' | null>(null)
  useEffect(() => {
    let current = true
    loadPairedExamplesAction(host, crawlId).then(
      (outcome) => current && setResult(outcome),
      () => current && setResult('failed'),
    )
    return () => {
      current = false
    }
  }, [host, crawlId])

  if (!result) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loadingExamples')} className="grid gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-full max-w-72" />
      </div>
    )
  }
  if (result === 'failed' || result.kind === 'unavailable') {
    return <p className="text-muted-foreground">{t('examplesUnavailable')}</p>
  }
  if (result.examples.length === 0) return null
  return (
    <div className="grid gap-1">
      <p className="text-muted-foreground">{t('examplesTitle')}</p>
      <ul className="grid gap-1">
        {result.examples.map((example) => (
          <li key={example.urlHash}>
            <Link
              className="font-mono text-xs break-all underline"
              href={`/domains/${host}/urls/${example.urlHash}?crawl=${crawlId}`}
            >
              {example.url}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
