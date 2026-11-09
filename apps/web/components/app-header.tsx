'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { DomainSwitcher, type SwitcherCompany } from '@/components/domain-switcher'
import { Logo } from '@/components/logo'
import { NavUser, type NavUserData } from '@/components/nav-user'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { UrlSearch } from '@/components/url-search'
import { cn } from '@/lib/utils'

/**
 * The bar across the top: the way home, the domain you are in (and the others), a search for any
 * URL of that domain and the signed-in user. The sidebar below only holds the navigation. On narrow
 * screens it also has the button that opens that navigation, which is otherwise always in view.
 */
export function AppHeader({
  isAdmin,
  companies,
  user,
}: {
  isAdmin: boolean
  companies: SwitcherCompany[]
  user: NavUserData
}) {
  const t = useTranslations('Header')
  const { host } = useParams<{ host?: string }>()
  // Only a tracked domain counts: a 404 host has nothing to search nor a sidebar.
  const searchHost = companies
    .flatMap((company) => company.domains)
    .find((domain) => domain.host === host)?.host

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 bg-background px-4">
      {/* The sidebar only exists inside a domain, so only there is there something to open. */}
      {searchHost && <SidebarTrigger className="-ml-1 md:hidden" />}
      <Link
        href="/"
        className="flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Logo className="size-8 shrink-0 rounded-lg" />
        <span className="hidden text-base font-semibold sm:inline">seotools</span>
        <span className="sr-only sm:hidden">{t('home')}</span>
      </Link>
      <Separator
        orientation="vertical"
        className="hidden sm:block data-vertical:h-8 data-vertical:self-center"
      />
      <DomainSwitcher canManage={isAdmin} companies={companies} />
      {searchHost && <UrlSearch host={searchHost} />}
      <div className={cn('shrink-0', searchHost ? 'md:ml-auto' : 'ml-auto')}>
        <NavUser user={user} isAdmin={isAdmin} />
      </div>
    </header>
  )
}
