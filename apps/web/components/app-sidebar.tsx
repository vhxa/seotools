'use client'

import {
  ChevronRightIcon,
  CircleAlertIcon,
  FileCode2Icon,
  FileTextIcon,
  LayoutDashboardIcon,
  RadarIcon,
  SettingsIcon,
  ShieldIcon,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { DomainSwitcher, type SwitcherCompany } from '@/components/domain-switcher'
import { Logo } from '@/components/logo'
import { NavUser, type NavUserData } from '@/components/nav-user'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

interface NavLink {
  label: string
  href: string
  icon: LucideIcon
  /** Active only on this exact path, not on its sub-pages. */
  exact?: boolean
}

interface NavSection {
  label: string
  icon: LucideIcon
  links: { label: string; href: string; exact?: boolean }[]
}

type NavItem = NavLink | NavSection

const isActive = (link: { href: string; exact?: boolean }, pathname: string) =>
  pathname === link.href || (!link.exact && pathname.startsWith(`${link.href}/`))

/**
 * Options that unfold in place. A sidebar collapsed to icons has no room for that, so there they
 * open as a menu beside it.
 */
function NavCollapsible({ section, pathname }: { section: NavSection; pathname: string }) {
  const { state, isMobile } = useSidebar()
  const active = section.links.some((link) => isActive(link, pathname))
  const [open, setOpen] = useState(active)

  if (state === 'collapsed' && !isMobile) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton isActive={active} tooltip={section.label} />}
          >
            <section.icon />
            <span>{section.label}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            {section.links.map((link) => (
              <DropdownMenuItem key={link.href} render={<Link href={link.href} />}>
                {link.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} render={<SidebarMenuItem />}>
      <CollapsibleTrigger render={<SidebarMenuButton tooltip={section.label} />}>
        <section.icon />
        <span>{section.label}</span>
        <ChevronRightIcon className={cn('ml-auto transition-transform', open && 'rotate-90')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          {section.links.map((link) => (
            <SidebarMenuSubItem key={link.href}>
              <SidebarMenuSubButton
                render={<Link href={link.href} />}
                isActive={isActive(link, pathname)}
              >
                <span>{link.label}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
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
          {items.map((item) =>
            'links' in item ? (
              <NavCollapsible key={item.label} section={item} pathname={pathname} />
            ) : (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  render={<Link href={item.href} />}
                  isActive={isActive(item, pathname)}
                  tooltip={item.label}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ),
          )}
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
  isAdmin,
  companies,
  user,
  version,
  development = false,
}: {
  isAdmin: boolean
  companies: SwitcherCompany[]
  user: NavUserData
  version?: string
  /** The build is not a release: say so next to the version, so it is never taken for one. */
  development?: boolean
}) {
  const t = useTranslations('Sidebar')
  const tFiles = useTranslations('CrawlFiles.extra.kinds')
  const pathname = usePathname()
  const { host } = useParams<{ host?: string }>()
  // Only a tracked domain counts: a 404 host must not get links of its own.
  const activeDomain = companies
    .flatMap((company) => company.domains)
    .find((domain) => domain.host === host)
  const activeHost = activeDomain?.host

  const domainItems: NavItem[] = activeHost
    ? [
        {
          label: t('overview'),
          href: `/domains/${activeHost}`,
          icon: LayoutDashboardIcon,
          exact: true,
        },
        { label: t('issues'), href: `/domains/${activeHost}/issues`, icon: CircleAlertIcon },
        {
          label: t('urls'),
          href: `/domains/${activeHost}/pages/details`,
          icon: FileTextIcon,
        },
        {
          label: t('crawls'),
          icon: RadarIcon,
          links: [
            { label: t('crawlsRun'), href: `/domains/${activeHost}/jobs` },
            { label: t('crawlsHistory'), href: `/domains/${activeHost}/pages/history` },
            { label: t('crawlsCompare'), href: `/domains/${activeHost}/pages/compare` },
          ],
        },
        {
          label: t('crawlFiles'),
          icon: FileCode2Icon,
          links: [
            { label: t('robots'), href: `/domains/${activeHost}/crawl-files/robots` },
            { label: t('sitemaps'), href: `/domains/${activeHost}/crawl-files/sitemaps` },
            { label: t('llms'), href: `/domains/${activeHost}/crawl-files/llms` },
            // One per file the domain turned on in its settings.
            ...(activeDomain?.extraFiles ?? []).map((kind) => ({
              label: tFiles(`${kind}.name`),
              href: `/domains/${activeHost}/crawl-files/${kind}`,
            })),
          ],
        },
        { label: t('settings'), href: `/domains/${activeHost}/settings`, icon: SettingsIcon },
      ]
    : []

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
                  <span className="truncate text-xs text-muted-foreground">
                    {t(development ? 'versionDevelopment' : 'versionRelease', { version })}
                  </span>
                )}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <DomainSwitcher canManage={isAdmin} companies={companies} />
      </SidebarHeader>
      <nav aria-label={t('navLabel')} className="flex min-h-0 flex-1 flex-col">
        <SidebarContent>
          {activeHost && <NavGroup label={activeHost} items={domainItems} pathname={pathname} />}
        </SidebarContent>
      </nav>
      <SidebarFooter>
        {isAdmin && (
          <nav aria-label={t('administration')}>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/system" />}
                  isActive={pathname === '/system' || pathname.startsWith('/system/')}
                  tooltip={t('administration')}
                >
                  <ShieldIcon />
                  <span>{t('administration')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </nav>
        )}
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
