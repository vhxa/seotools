'use client'

import {
  ActivityIcon,
  CalendarClockIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { DomainSwitcher, type SwitcherCompany } from '@/components/domain-switcher'
import { Logo } from '@/components/logo'
import { NavUser, type NavUserData } from '@/components/nav-user'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  /** Active only on this exact path, not on its sub-pages. */
  exact?: boolean
}

function NavGroup({
  label,
  items,
  pathname,
}: {
  label: string
  items: NavItem[]
  pathname: string
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                render={<Link href={item.href} />}
                isActive={
                  pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`))
                }
                tooltip={item.label}
              >
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/**
 * App navigation: logo and domain selector on top, the options in the middle and the signed-in
 * user at the bottom. Domain options only show while a tracked domain is open (`/domains/[host]`).
 */
export function AppSidebar({
  companies,
  user,
  version,
}: {
  companies: SwitcherCompany[]
  user: NavUserData
  version?: string
}) {
  const t = useTranslations('Sidebar')
  const pathname = usePathname()
  const { host } = useParams<{ host?: string }>()
  // Only a tracked domain counts: a 404 host must not get links of its own.
  const activeHost = companies
    .flatMap((company) => company.domains)
    .find((domain) => domain.host === host)?.host

  const domainItems: NavItem[] = activeHost
    ? [
        {
          label: t('overview'),
          href: `/domains/${activeHost}`,
          icon: LayoutDashboardIcon,
          exact: true,
        },
        { label: t('pages'), href: `/domains/${activeHost}/pages`, icon: FileTextIcon },
        { label: t('scheduledJobs'), href: `/domains/${activeHost}/jobs`, icon: CalendarClockIcon },
      ]
    : []
  const instanceItems: NavItem[] = [{ label: t('system'), href: '/system', icon: ActivityIcon }]

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />} tooltip="seotools">
              {/* `!` beats the button's `[&_svg]:size-4`, which is meant for icons. */}
              <Logo className="size-8! shrink-0 rounded-lg" />
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">seotools</span>
                {version && (
                  <span className="truncate text-xs text-muted-foreground">v{version}</span>
                )}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <DomainSwitcher companies={companies} />
      </SidebarHeader>
      <SidebarContent>
        {activeHost && <NavGroup label={activeHost} items={domainItems} pathname={pathname} />}
        <NavGroup label={t('instance')} items={instanceItems} pathname={pathname} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
