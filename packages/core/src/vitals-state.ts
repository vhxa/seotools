export type VitalState = 'good' | 'needs-improvement' | 'poor' | 'no-data'
export type StatefulVital = 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb'

/** Google's thresholds (web.dev): up to the first is good, past the second is poor. */
const THRESHOLDS: Record<StatefulVital, readonly [number, number]> = {
  lcp: [2500, 4000],
  inp: [200, 500],
  cls: [0.1, 0.25],
  fcp: [1800, 3000],
  ttfb: [800, 1800],
}

export function vitalState(metric: StatefulVital, value: number | null | undefined): VitalState {
  if (value == null) return 'no-data'
  const [good, poor] = THRESHOLDS[metric]
  return value <= good ? 'good' : value > poor ? 'poor' : 'needs-improvement'
}

/** Share of the bar (good 60%, needs improvement 15%, poor 25%) where a value falls, 0 to 1. */
export function vitalPosition(metric: StatefulVital, value: number): number {
  const [good, poor] = THRESHOLDS[metric]
  if (value <= good) return (Math.max(value, 0) / good) * 0.6
  if (value <= poor) return 0.6 + ((value - good) / (poor - good)) * 0.15
  // Past the poor threshold the scale reaches twice that threshold.
  return 0.75 + Math.min((value - poor) / poor, 1) * 0.25
}

export const VITAL_FAILURES = [
  'no-key',
  'quota',
  'forbidden',
  'network',
  'timeout',
  'http',
  'invalid-response',
  'no-data',
] as const
export function vitalFailure(value: string | null) {
  return VITAL_FAILURES.find((failure) => failure === value) ?? 'network'
}
