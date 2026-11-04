import { describe, expect, it } from 'vitest'
import { AUDIT_TABS, auditTabHref, parseAuditTab } from './audit-tabs'

describe('the tabs of the audit settings', () => {
  it('reads the tab from the address, and falls back to the first for anything else', () => {
    for (const tab of AUDIT_TABS) expect(parseAuditTab(tab)).toBe(tab)
    expect(parseAuditTab(undefined)).toBe('rules')
    expect(parseAuditTab('nope')).toBe('rules')
    expect(parseAuditTab(['languages', 'rules'])).toBe('languages')
    expect(parseAuditTab("rules' or 1=1")).toBe('rules')
    expect(parseAuditTab('constructor')).toBe('rules')
    expect(parseAuditTab('__proto__')).toBe('rules')
  })

  it('still opens the tabs that were replaced by the one list of rules', () => {
    expect(parseAuditTab('exclusions')).toBe('rules')
    expect(parseAuditTab('intent')).toBe('rules')
    expect(parseAuditTab(['intent', 'languages'])).toBe('rules')
  })

  it('builds the address of each tab, and round-trips it', () => {
    expect(auditTabHref('acme.com', 'rules')).toBe('/domains/acme.com/settings/audit')
    expect(auditTabHref('acme.com', 'languages')).toBe(
      '/domains/acme.com/settings/audit?tab=languages',
    )
    for (const tab of AUDIT_TABS) {
      const query = new URL(auditTabHref('acme.com', tab), 'https://x').searchParams.get('tab')
      expect(parseAuditTab(query ?? undefined)).toBe(tab)
    }
  })
})
