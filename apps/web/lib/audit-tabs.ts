/**
 * The tabs of Settings → Audit. The active one is in the address (`?tab=`), so that it survives
 * saving, cancelling, a reload and coming back from the detail of a URL.
 *
 * Exclusions and expected indexing were tabs of their own when a rule said one thing; a rule says
 * several now, in one list. The addresses of those tabs still work.
 */
export const AUDIT_TABS = ['rules', 'languages', 'thresholds'] as const
export type AuditTab = (typeof AUDIT_TABS)[number]

export const DEFAULT_AUDIT_TAB: AuditTab = 'rules'

/** The tabs that existed before the rules were one list, and the one that replaced them. */
const RETIRED_TABS: Readonly<Record<string, AuditTab>> = { exclusions: 'rules', intent: 'rules' }

/** The tab asked for, or the first one when the address names none that exists. */
export function parseAuditTab(value: string | string[] | undefined): AuditTab {
  const first = Array.isArray(value) ? value[0] : value
  return (
    AUDIT_TABS.find((tab) => tab === first) ??
    (first !== undefined && Object.hasOwn(RETIRED_TABS, first) ? RETIRED_TABS[first] : undefined) ??
    DEFAULT_AUDIT_TAB
  )
}

/** The address of a tab. The first one is the default and needs no parameter. */
export const auditTabHref = (host: string, tab: AuditTab) =>
  `/domains/${host}/settings/audit${tab === DEFAULT_AUDIT_TAB ? '' : `?tab=${tab}`}`
