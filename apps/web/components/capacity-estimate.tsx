'use client'

import {
  estimateMemory,
  type CapacityHardware,
  type CrawlCapacityMetrics,
} from '@seotools/core/capacity'
import { useFormatter, useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

export function useCapacityNumbers() {
  const format = useFormatter()
  const t = useTranslations('Capacity')
  return {
    memory: (bytes: number | null) =>
      bytes === null
        ? t('unknown')
        : t('gib', { amount: format.number(bytes / 1024 ** 3, { maximumFractionDigits: 2 }) }),
    duration: (ms: number) =>
      ms < 60_000
        ? t('seconds', { count: Math.max(1, Math.round(ms / 1000)) })
        : t('minutes', { count: Math.round(ms / 60_000) }),
  }
}

export function EstimateItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1">
      <dt className="font-medium">{label}</dt>
      <dd className="text-muted-foreground">{children}</dd>
    </div>
  )
}

export function MemoryEstimate({
  renders,
  hardware,
  metrics,
}: {
  renders: number
  hardware: CapacityHardware | null
  metrics: CrawlCapacityMetrics | null
}) {
  const t = useTranslations('Capacity')
  const format = useFormatter()
  const { memory } = useCapacityNumbers()
  const estimate = estimateMemory(renders, hardware, metrics?.heapP95 ?? null)
  return (
    <>
      <EstimateItem label={t('memory')}>
        <p>
          {estimate.ceiling === null
            ? t('memoryUnknownCeiling', { memory: memory(estimate.browser) })
            : t('memoryUsage', {
                memory: memory(estimate.browser),
                ceiling: memory(estimate.ceiling),
              })}
        </p>
        <p>{t('serverBudget', { budget: memory(estimate.budget) })}</p>
        <p className="text-xs">{t(estimate.measuredHeap ? 'memoryMeasured' : 'memoryDefault')}</p>
      </EstimateItem>
      <EstimateItem label={t('risk')}>
        <div className="grid [&>*]:col-start-1 [&>*]:row-start-1">
          {/* Both states reserve the warning's space at the current width. */}
          <div aria-hidden className="invisible">
            <p>{t('browserRisk')}</p>
            <p>{t('serverRisk')}</p>
            <p>{t('processorRisk')}</p>
          </div>
          <div aria-live="polite">
            {estimate.browserRisk && <p>{t('browserRisk')}</p>}
            {estimate.serverRisk && <p>{t('serverRisk')}</p>}
            {estimate.processorRisk && <p>{t('processorRisk')}</p>}
            {!estimate.browserRisk && !estimate.serverRisk && !estimate.processorRisk && (
              <p>{t(estimate.ceiling === null || hardware === null ? 'riskUnknown' : 'riskLow')}</p>
            )}
          </div>
        </div>
        {!!metrics?.captures && (
          <p className="text-xs">
            {t('unsettled', {
              share: format.number(metrics.unsettled / metrics.captures, {
                style: 'percent',
                maximumFractionDigits: 1,
              }),
            })}
          </p>
        )}
        {metrics?.delayP95Ms != null && (
          <p className="text-xs">
            {t('delay', {
              ms: format.number(metrics.delayP95Ms, { maximumFractionDigits: 0 }),
            })}
          </p>
        )}
      </EstimateItem>
    </>
  )
}
