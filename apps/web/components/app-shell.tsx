'use client'

import { useParams } from 'next/navigation'
import type { CSSProperties, ReactNode } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { type SwitcherCompany } from '@/components/domain-switcher'
import { type NavUserData } from '@/components/nav-user'
import { Separator } from '@/components/ui/separator'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { UrlSearch } from '@/components/url-search'
import { HEADER_SLOT_ID, SECONDARY_SLOT_ID } from '@/lib/sidebar-nav'

/** Every page uses the whole width of the panel, so none is narrower than another. */
const MAIN_CLASS = 'w-full flex-1 scroll-mt-16 px-4 pt-3 pb-4 outline-none md:px-6 md:pb-6'

/**
 * The frame of every signed-in page: an inset sidebar (the domain selector, the navigation and the
 * user) next to a rounded panel whose header holds the sidebar's button and, inside a domain, the
 * URL search. Outside a domain the sidebar shows the portfolio and, in Administration, its sections.
 */
export function AppShell({
  favouriteDomainId,
  isAdmin,
  companies,
  user,
  defaultOpen,
  skipLabel,
  children,
}: {
  favouriteDomainId: string | null
  isAdmin: boolean
  companies: SwitcherCompany[]
  user: NavUserData
  defaultOpen: boolean
  skipLabel: string
  children: ReactNode
}) {
  const { host } = useParams<{ host?: string }>()
  // Only a tracked domain counts: a 404 host has nothing to search nor a sidebar.
  const searchHost = companies
    .flatMap((company) => company.domains)
    .find((domain) => domain.host === host)?.host

  const skip = (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:ring-2 focus:ring-ring"
    >
      {skipLabel}
    </a>
  )

  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      style={{ '--sidebar-width': '18.75rem' } as CSSProperties}
    >
      {skip}
      <AppSidebar
        favouriteDomainId={favouriteDomainId}
        isAdmin={isAdmin}
        companies={companies}
        user={user}
      />
      {/* A div, not `SidebarInset`: that one renders a <main> and pages bring their own. On wide
          screens the panel scrolls by itself, so its header stays in view and the page never
          moves behind the sidebar. */}
      <div
        data-slot="sidebar-inset"
        className="relative flex min-w-0 flex-1 flex-col bg-background md:m-2 md:ml-0 md:h-[calc(100svh-1rem)] md:overflow-y-auto md:rounded-xl md:shadow-sm"
      >
        {/* The search takes the whole header when the page has buttons of its own at its right. */}
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 bg-background px-4 has-[#header-actions-slot:not(:empty)]:[&_[data-slot=url-search]]:max-w-none">
          <SidebarTrigger className="-ml-1" />
          {searchHost && (
            <>
              <Separator
                orientation="vertical"
                className="mr-1 data-vertical:h-4 data-vertical:self-center"
              />
              <UrlSearch host={searchHost} />
            </>
          )}
          <div id={HEADER_SLOT_ID} className="ml-auto flex items-center gap-2 empty:hidden" />
        </header>
        <div id="main-content" tabIndex={-1} className={MAIN_CLASS}>
          {children}
        </div>
      </div>
      {/* A page's own side panel (the URLs' issues): it sits on the sidebar's background, beside
          the rounded panel, and takes no room while nothing is drawn in it. The page opens it
          (`data-state`) and the width animates, like the main sidebar's. */}
      <div
        id={SECONDARY_SLOT_ID}
        className="hidden w-0 shrink-0 overflow-hidden xl:block xl:h-svh xl:transition-[width] xl:duration-200 xl:ease-linear xl:data-instant:transition-none xl:data-[state=open]:w-80"
      />
    </SidebarProvider>
  )
}
