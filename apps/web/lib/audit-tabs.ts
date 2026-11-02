import type { AuditDimension } from '@seotools/core/crawl/audit'

/**
 * The tabs of Settings → Audit. The active one is in the address (`?tab=`), so that it survives
 * saving, cancelling, a reload and coming back from the detail of a URL.
 */
export const AUDIT_TABS = ['exclusions', 'intent', 'languages'] as const
export type AuditTab = (typeof AUDIT_TABS)[number]

export const DEFAULT_AUDIT_TAB: AuditTab = 'exclusions'

/** The tab asked for, or the first one when the address names none that exists. */
export function parseAuditTab(value: string | string[] | undefined): AuditTab {
  const first = Array.isArray(value) ? value[0] : value
  return AUDIT_TABS.find((tab) => tab === first) ?? DEFAULT_AUDIT_TAB
}

/** The tab that lists the rules of a dimension. */
export const tabOfDimension = (dimension: AuditDimension): AuditTab =>
  dimension === 'audit' ? 'exclusions' : 'intent'

/** The address of a tab. The first one is the default and needs no parameter. */
export const auditTabHref = (host: string, tab: AuditTab) =>
  `/domains/${host}/settings/audit${tab === DEFAULT_AUDIT_TAB ? '' : `?tab=${tab}`}`
