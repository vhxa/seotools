/**
 * The tabs of the account page. The active one is in the address (`?tab=`), so that saving a form,
 * a reload and a link from elsewhere (the alerts of a domain's settings) keep it.
 */
export const ACCOUNT_TABS = ['profile', 'alerts', 'password'] as const
export type AccountTab = (typeof ACCOUNT_TABS)[number]

export const DEFAULT_ACCOUNT_TAB: AccountTab = 'profile'

/** The tab asked for, or the first one when the address names none that exists. */
export function parseAccountTab(value: string | string[] | undefined): AccountTab {
  const first = Array.isArray(value) ? value[0] : value
  return ACCOUNT_TABS.find((tab) => tab === first) ?? DEFAULT_ACCOUNT_TAB
}

/** The address of a tab. The first one is the default and needs no parameter. */
export const accountTabHref = (tab: AccountTab) =>
  tab === DEFAULT_ACCOUNT_TAB ? '/account' : `/account?tab=${tab}`
