export interface NavMatch {
  href: string
  /** Active only on this exact path, not on its sub-pages. */
  exact?: boolean
  /** Other paths (and their sub-pages) that belong to this link. */
  also?: string[]
}

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`)

/** Whether a sidebar link is the current place: its path, its sub-pages or the paths it claims. */
export function isNavActive(link: NavMatch, pathname: string): boolean {
  if (link.exact) return pathname === link.href
  return under(pathname, link.href) || (link.also ?? []).some((base) => under(pathname, base))
}

/** A hand-made fold or unfold, valid only for the page it was made on. */
export interface SectionOverride {
  pathname: string
  open: boolean
}

/**
 * A section is open whenever one of its links is active (also after a client-side navigation into
 * it); a toggle by hand wins only until the user goes to another page.
 */
export function isSectionOpen(
  active: boolean,
  override: SectionOverride | null,
  pathname: string,
): boolean {
  return override && override.pathname === pathname ? override.open : active
}

/** Where the domain layout puts the crawl buttons inside the sidebar (`SidebarCrawlActions`). */
export const CRAWL_SLOT_ID = 'sidebar-crawl-slot'

/** Where a page draws its own side panel, to the right of the main panel. */
export const SECONDARY_SLOT_ID = 'secondary-sidebar-slot'

/** Where a page draws its own buttons in the main panel's header, at its right edge. */
export const HEADER_SLOT_ID = 'header-actions-slot'
