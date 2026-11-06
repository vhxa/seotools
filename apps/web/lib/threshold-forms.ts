import {
  AUDIT_THRESHOLDS,
  THRESHOLD_KEYS,
  canonicalThresholds,
  resolveThresholds,
  thresholdsProblem,
  type ThresholdKey,
  type ThresholdOverrides,
} from '@seotools/core/crawl/thresholds'

export type ThresholdsFormResult =
  | { ok: true; thresholds: ThresholdOverrides }
  | { ok: false; error: 'range' | 'title' | 'description'; field?: ThresholdKey }

/**
 * Reads the figures of Settings → Audit → Thresholds. An empty field is the recommended figure,
 * which is not stored: only what differs from the defaults is kept.
 */
export function parseThresholdsForm(form: FormData): ThresholdsFormResult {
  const values: ThresholdOverrides = {}
  for (const key of THRESHOLD_KEYS) {
    const raw = form.get(key)
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (text === '') continue
    const value = /^\d{1,6}$/.test(text) ? Number(text) : Number.NaN
    const { min, max } = AUDIT_THRESHOLDS[key]
    if (!Number.isInteger(value) || value < min || value > max) {
      return { ok: false, error: 'range', field: key }
    }
    values[key] = value
  }
  const problem = thresholdsProblem(resolveThresholds(values))
  if (problem) return { ok: false, error: problem }
  return { ok: true, thresholds: canonicalThresholds(values) }
}
