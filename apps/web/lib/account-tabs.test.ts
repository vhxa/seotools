import { describe, expect, it } from 'vitest'
import { ACCOUNT_TABS, accountTabHref, parseAccountTab } from './account-tabs'

describe('the tabs of the account page', () => {
  it('reads the tab from the address, and falls back to the first for anything else', () => {
    for (const tab of ACCOUNT_TABS) expect(parseAccountTab(tab)).toBe(tab)
    expect(parseAccountTab(undefined)).toBe('profile')
    expect(parseAccountTab('nope')).toBe('profile')
    expect(parseAccountTab(['alerts', 'password'])).toBe('alerts')
    expect(parseAccountTab('constructor')).toBe('profile')
    expect(parseAccountTab('__proto__')).toBe('profile')
  })

  it('builds the address of each tab, and round-trips it', () => {
    expect(accountTabHref('profile')).toBe('/account')
    expect(accountTabHref('alerts')).toBe('/account?tab=alerts')
    for (const tab of ACCOUNT_TABS) {
      const query = new URL(accountTabHref(tab), 'https://x').searchParams.get('tab')
      expect(parseAccountTab(query ?? undefined)).toBe(tab)
    }
  })
})
