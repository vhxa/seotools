/**
 * The alerts someone can ask for, per domain. Nobody receives any until they choose: a new
 * installation makes no noise. Pure on purpose (no Node imports): client components import it
 * through `@seotools/core/alerts`.
 */

/**
 * - `crawl-problem`: a full crawl of the domain ended `failed` or `incomplete`.
 * - `important-findings`: a completed full crawl has findings of high importance that are new or
 *   back, against the previous completed one, and that nothing but the site can explain.
 * - `change-summary`: one summary of what changed, for every full crawl that ended with results.
 */
export const ALERT_KINDS = [
  'crawl-problem',
  'important-findings',
  'change-summary',
  'site-files',
  'site-availability',
  'vitals-regression',
] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

export const isAlertKind = (value: unknown): value is AlertKind =>
  ALERT_KINDS.some((kind) => kind === value)

/** The languages of the emails: the worker cannot read the web app's catalogs. */
export const ALERT_LOCALES = ['en', 'es'] as const
export type AlertLocale = (typeof ALERT_LOCALES)[number]

/** The language of an email for a locale the interface uses, English when there is no copy for it. */
export const alertLocaleOf = (locale: string): AlertLocale =>
  ALERT_LOCALES.find((candidate) => candidate === locale) ?? 'en'

/** Kinds in the order the email lists them, without repeats. */
export const sortedAlertKinds = (kinds: Iterable<AlertKind>): AlertKind[] => {
  const wanted = new Set(kinds)
  return ALERT_KINDS.filter((kind) => wanted.has(kind))
}
