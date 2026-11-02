import { describe, expect, it } from 'vitest'
import { AUDIT_TABS, auditTabHref, parseAuditTab, tabOfDimension } from './audit-tabs'

describe('the tabs of the audit settings', () => {
  it('reads the tab from the address, and falls back to the first for anything else', () => {
    for (const tab of AUDIT_TABS) expect(parseAuditTab(tab)).toBe(tab)
    expect(parseAuditTab(undefined)).toBe('exclusions')
    expect(parseAuditTab('nope')).toBe('exclusions')
    expect(parseAuditTab(['languages', 'intent'])).toBe('languages')
    expect(parseAuditTab("intent' or 1=1")).toBe('exclusions')
  })

  it('builds the address of each tab, and round-trips it', () => {
    expect(auditTabHref('acme.com', 'exclusions')).toBe('/domains/acme.com/settings/audit')
    expect(auditTabHref('acme.com', 'intent')).toBe('/domains/acme.com/settings/audit?tab=intent')
    for (const tab of AUDIT_TABS) {
      const query = new URL(auditTabHref('acme.com', tab), 'https://x').searchParams.get('tab')
      expect(parseAuditTab(query ?? undefined)).toBe(tab)
    }
  })

  it('names the tab that lists each kind of rule', () => {
    expect(tabOfDimension('audit')).toBe('exclusions')
    expect(tabOfDimension('intent')).toBe('intent')
  })
})
