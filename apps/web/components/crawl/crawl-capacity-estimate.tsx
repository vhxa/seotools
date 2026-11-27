'use client'

import {
  estimateDuration,
  estimateLoad,
  type CapacityHardware,
  type CrawlCapacitySample,
} from '@seotools/core/capacity'
import { useTranslations } from 'next-intl'
import { EstimateItem, MemoryEstimate, useCapacityNumbers } from '@/components/capacity-estimate'

export function CrawlCapacityEstimate({
  samples,
  mode,
  concurrency,
  requestsPerSecond,
  maxUrls,
  slots,
  hardware,
}: {
  samples: Record<'html' | 'rendered', CrawlCapacitySample | null>
  mode: 'html' | 'rendered'
  concurrency: number
  requestsPerSecond: number
  maxUrls: number | null
  slots: number
  hardware: CapacityHardware | null
}) {
  const t = useTranslations('Capacity')
  const { duration } = useCapacityNumbers()
  const settings = { concurrency, requestsPerSecond, maxUrls }
  const sample = samples[mode]
  const time = estimateDuration(sample, mode, settings, slots)
  const load = estimateLoad(settings, mode, slots)
  return (
    <dl className="grid gap-4 rounded-xl border p-4 text-sm sm:grid-cols-2">
      <EstimateItem label={t('duration')}>
        {sample?.pace && time !== null ? (
          <>
            <p>{t('durationEstimate', { time: duration(time) })}</p>
            <p className="text-xs">
              {t('durationBasis', {
                time: duration(sample.elapsedMs),
                count: sample.pace.concurrency,
              })}
            </p>
          </>
        ) : (
          <p>{t(sample ? 'missingMeasurements' : 'noCrawl')}</p>
        )}
      </EstimateItem>
      <EstimateItem label={t('load')}>
        <p>{t('documents', { count: load.documents, rate: load.requestsPerSecond })}</p>
        {mode === 'rendered' && (
          <p className="text-xs">
            {t('resources', { count: load.resources, renders: load.renders })}
          </p>
        )}
        {sample?.metrics?.slowed && <p className="text-xs font-medium">{t('slowdown')}</p>}
      </EstimateItem>
      {mode === 'rendered' && (
        <MemoryEstimate
          renders={load.renders}
          hardware={hardware}
          metrics={sample?.metrics ?? null}
        />
      )}
    </dl>
  )
}
