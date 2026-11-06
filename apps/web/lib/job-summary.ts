/** What a finished job's result says, as a message key of `System.summary` and its values. */
export type JobSummary =
  | { key: 'crawl'; values: { pages: number; urls: number } }
  | { key: 'crawlStopped'; values: { pages: number; urls: number } }
  | { key: 'recomputed'; values: { count: number } }
  | { key: 'upToDate'; values: Record<string, never> }
  | { key: 'alertsSent'; values: { sent: number } }
  | { key: `alertsSkipped.${AlertSkip}`; values: Record<string, never> }
  | { key: 'emailSent'; values: Record<string, never> }
  | { key: 'emailSkipped'; values: Record<string, never> }

type AlertSkip = 'nobody' | 'archived' | 'gone' | 'not-applicable'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const SKIPS = ['nobody', 'archived', 'gone', 'not-applicable'] as const

/**
 * Puts the result of a job in words for people. `null` when the type is unknown or the result is
 * not what the handler returns (old or foreign data): the raw result is shown instead, never a
 * guess.
 */
export function summarizeJobResult(type: string, result: unknown): JobSummary | null {
  if (!isRecord(result)) return null
  switch (type) {
    case 'crawl.run': {
      const pages = count(result.pages)
      const urls = count(result.urls)
      if (pages === null || urls === null) return null
      const ended = result.status === 'completed' || result.status === 'incomplete'
      return { key: ended ? 'crawl' : 'crawlStopped', values: { pages, urls } }
    }
    case 'audit.recompute': {
      const analysed = count(result.analysed)
      if (analysed === null) return null
      return analysed === 0
        ? { key: 'upToDate', values: {} }
        : { key: 'recomputed', values: { count: analysed } }
    }
    case 'crawl.alerts': {
      const skipped = SKIPS.find((reason) => reason === result.skipped)
      if (skipped) return { key: `alertsSkipped.${skipped}`, values: {} }
      const sent = count(result.sent)
      return sent === null ? null : { key: 'alertsSent', values: { sent } }
    }
    case 'access.email':
    case 'mail.send':
      if (result.skipped === true) return { key: 'emailSkipped', values: {} }
      return 'messageId' in result ? { key: 'emailSent', values: {} } : null
    default:
      return null
  }
}
