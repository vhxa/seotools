export type VitalState = 'good' | 'needs-improvement' | 'poor' | 'no-data'
export function vitalState(
  metric: 'lcp' | 'inp' | 'cls',
  value: number | null | undefined,
): VitalState {
  if (value == null) return 'no-data'
  const [good, poor] = metric === 'lcp' ? [2500, 4000] : metric === 'inp' ? [200, 500] : [0.1, 0.25]
  return value <= good! ? 'good' : value > poor! ? 'poor' : 'needs-improvement'
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
