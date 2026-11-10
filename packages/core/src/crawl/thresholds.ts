import { z } from '../zod'

/**
 * The figures some checks compare with, which are conventions rather than facts: a domain can set
 * its own (Settings → Audit), with these as the recommended defaults. Only what the analysis reads
 * is here: lengths the crawler measures while it parses (headings, `alt` texts) cannot change
 * afterwards, so they are not configurable. Pure, so client components can import it.
 */
export const AUDIT_THRESHOLDS = {
  /** Characters of a title under which it is too short. */
  titleMin: { default: 30, min: 1, max: 200 },
  /** Characters of a title over which it is too long. */
  titleMax: { default: 60, min: 10, max: 300 },
  descriptionMin: { default: 70, min: 1, max: 300 },
  descriptionMax: { default: 155, min: 20, max: 500 },
  /** Words of text under which a page is thin. */
  thinWords: { default: 200, min: 1, max: 5000 },
  /** Characters of a URL over which it is too long. */
  urlMax: { default: 115, min: 30, max: 2048 },
  /** Clicks from the home page over which a page is deep. */
  clickDepthMax: { default: 3, min: 1, max: 20 },
  /** Kilobytes of an image over which it is too heavy. */
  imageMaxKb: { default: 100, min: 10, max: 10_000 },
} as const satisfies Record<string, { default: number; min: number; max: number }>

export type ThresholdKey = keyof typeof AUDIT_THRESHOLDS

/**
 * The issues each figure decides. Two analyses with a different value of one of them cannot say
 * whether the site changed: a finding that comes or goes may be the figure that moved.
 */
export const THRESHOLD_ISSUES: Readonly<Record<string, readonly ThresholdKey[]>> = {
  'title-too-short': ['titleMin'],
  'title-too-long': ['titleMax'],
  'description-too-short': ['descriptionMin'],
  'description-too-long': ['descriptionMax'],
  'content-thin': ['thinWords'],
  'url-too-long': ['urlMax'],
  'deep-page': ['clickDepthMax'],
  'img-too-heavy': ['imageMaxKb'],
}
export type AuditThresholds = Record<ThresholdKey, number>
export const THRESHOLD_KEYS = Object.keys(AUDIT_THRESHOLDS) as ThresholdKey[]

export const DEFAULT_THRESHOLDS = Object.fromEntries(
  THRESHOLD_KEYS.map((key) => [key, AUDIT_THRESHOLDS[key].default]),
) as AuditThresholds

/** What a domain set, stored and kept in snapshots: only the values that differ from the defaults. */
export type ThresholdOverrides = Partial<AuditThresholds>

export const thresholdOverridesSchema = z
  .object(
    Object.fromEntries(
      THRESHOLD_KEYS.map((key) => {
        const { min, max } = AUDIT_THRESHOLDS[key]
        return [key, z.number().int().min(min).max(max).optional()]
      }),
    ) as Record<ThresholdKey, z.ZodOptional<z.ZodNumber>>,
  )
  .strict()

/** The figures an analysis uses: the defaults, with what the domain set on top. */
export const resolveThresholds = (overrides?: ThresholdOverrides | null): AuditThresholds => ({
  ...DEFAULT_THRESHOLDS,
  ...overrides,
})

/** Only what differs from the defaults, in key order: one form for one configuration. */
export function canonicalThresholds(values?: ThresholdOverrides | null): ThresholdOverrides {
  const out: ThresholdOverrides = {}
  for (const key of THRESHOLD_KEYS) {
    const value = values?.[key]
    if (value !== undefined && value !== DEFAULT_THRESHOLDS[key]) out[key] = value
  }
  return out
}

/** Why a set of figures cannot be used together, or `null` when it can. */
export function thresholdsProblem(values: AuditThresholds): 'title' | 'description' | null {
  if (values.titleMin >= values.titleMax) return 'title'
  if (values.descriptionMin >= values.descriptionMax) return 'description'
  return null
}

/** Reads stored overrides, dropping anything that does not check out. */
export function parseThresholdOverrides(value: unknown): ThresholdOverrides {
  const parsed = thresholdOverridesSchema.safeParse(value)
  return parsed.success ? canonicalThresholds(parsed.data) : {}
}
