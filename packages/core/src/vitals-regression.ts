import { vitalState } from './vitals-state'
export interface OriginVitals {
  formFactor: string
  status: string
  lcp: number | null
  inp: number | null
  cls: number | null
}
export function vitalsRegressions(previous: OriginVitals[], current: OriginVitals[]): string[] {
  return current
    .filter((row) => row.status === 'collected' && row.formFactor !== 'all')
    .flatMap((row) => {
      const before = previous.find(
        (p) => p.formFactor === row.formFactor && p.status === 'collected',
      )
      if (!before) return []
      return (['lcp', 'inp', 'cls'] as const)
        .filter((metric) => {
          const was = vitalState(metric, before[metric])
          return (
            (was === 'good' || was === 'needs-improvement') &&
            vitalState(metric, row[metric]) === 'poor'
          )
        })
        .map(
          (metric) =>
            `${row.formFactor}: ${metric.toUpperCase()} ${before[metric]} → ${row[metric]}`,
        )
    })
}
