'use client'

import {
  ChevronRightIcon,
  CircleAlertIcon,
  FileCode2Icon,
  FileTextIcon,
  FolderTreeIcon,
  LayoutGridIcon,
  LayoutListIcon,
  Settings2Icon,
  TargetIcon,
  ShieldIcon,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { CrawlActionsPlaceholder } from '@/components/crawl/sidebar-crawl-actions'
import { DomainSwitcher, type SwitcherCompany } from '@/components/domain-switcher'
import { NavUser, type NavUserData } from '@/components/nav-user'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
  useSidebar,
} from '@/components/ui/sidebar'
import { SYSTEM_SECTIONS } from '@/components/system-sections'
import { CRAWL_SLOT_ID, isNavActive, isSectionOpen, type SectionOverride } from '@/lib/sidebar-nav'
import { cn } from '@/lib/utils'

interface NavLink {
  label: string
  href: string
  icon: LucideIcon
  /** Active only on this exact path, not on its sub-pages. */
  exact?: boolean
  /** Other paths that belong to this link. */
  also?: string[]
}

interface NavSection {
  label: string
  icon: LucideIcon
  links: { label: string; href: string; exact?: boolean }[]
}

type NavItem = NavLink | NavSection

const isActive = isNavActive

/** Rows of the design: 32px high, medium text, 8px apart (the menu's gap). */
const NAV_BUTTON = 'h-8 gap-2.5 px-2 text-sm font-medium'

/** Options that unfold in place. */
function NavCollapsible({ section, pathname }: { section: NavSection; pathname: string }) {
  const active = section.links.some((link) => isActive(link, pathname))
  const [override, setOverride] = useState<SectionOverride | null>(null)
  const open = isSectionOpen(active, override, pathname)
  const { state, setOpen } = useSidebar()

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        // Folded to icons the options have no room: open the sidebar to show them.
        if (state === 'collapsed') setOpen(true)
        setOverride({ pathname, open: next || state === 'collapsed' })
      }}
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger
        render={<SidebarMenuButton className={NAV_BUTTON} tooltip={section.label} />}
      >
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
  items,
  pathname,
  label,
}: {
  items: NavItem[]
  pathname: string
  label?: string
}) {
  return (
    <SidebarGroup className="p-0">
      {label && (
        <SidebarGroupLabel className="mb-1 px-2 text-[13px] font-normal">{label}</SidebarGroupLabel>
      )}
      <SidebarGroupContent>
        <SidebarMenu className="gap-2">
          {items.map((item) =>
            'links' in item ? (
              <NavCollapsible key={item.label} section={item} pathname={pathname} />
            ) : (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  className={NAV_BUTTON}
                  tooltip={item.label}
                  render={<Link href={item.href} />}
                  isActive={isActive(item, pathname)}
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
 * The inset sidebar of every page: the domain selector at the top, the options of the domain
 * while one is open (`/domains/[host]`) or the sections of Administration, and at the bottom the
 * administration link and the user. On narrow screens
 * it is a sheet that the button of the page's header opens.
 */
export function AppSidebar({
  favouriteDomainId,
  isAdmin,
  companies,
  user,
}: {
  favouriteDomainId: string | null
  isAdmin: boolean
  companies: SwitcherCompany[]
  user: NavUserData
}) {
  const t = useTranslations('Sidebar')
  const tFiles = useTranslations('CrawlFiles.extra.kinds')
  const tSystem = useTranslations('SystemNav')
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
          icon: LayoutGridIcon,
          exact: true,
        },
        { label: t('issues'), href: `/domains/${activeHost}/issues`, icon: CircleAlertIcon },
        {
          label: t('urls'),
          href: `/domains/${activeHost}/urls`,
          icon: FileTextIcon,
        },
        { label: t('structure'), href: `/domains/${activeHost}/structure`, icon: FolderTreeIcon },
        // One link: the list, the comparison and the rechecks are tabs of the area.
        { label: t('crawls'), href: `/domains/${activeHost}/crawls`, icon: TargetIcon },
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
      ]
    : []
  const settingsItems: NavItem[] = activeHost
    ? [{ label: t('settings'), href: `/domains/${activeHost}/settings`, icon: Settings2Icon }]
    : []

  // Outside a domain the sidebar keeps the same frame: the way to the portfolio and, inside
  // Administration, its sections (they are the sidebar's entries, not tabs of the page).
  const generalItems: NavItem[] = activeHost
    ? []
    : [{ label: t('domains'), href: '/domains', icon: LayoutListIcon, exact: true }]
  const inSystem = pathname === '/system' || pathname.startsWith('/system/')
  const systemItems: NavItem[] =
    !activeHost && isAdmin && inSystem
      ? SYSTEM_SECTIONS.map(({ id, href, icon, exact }) => ({
          label: tSystem(id),
          href,
          icon,
          exact,
        }))
      : []

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="gap-4 p-3 pb-0 group-data-[collapsible=icon]:p-2">
        <DomainSwitcher
          favouriteDomainId={favouriteDomainId}
          canManage={isAdmin}
          companies={companies}
        />
        {/* The domain layout puts the crawl buttons here (it knows the permissions and the active
            crawl): the slot keeps its height so nothing moves when they arrive. */}
        {activeHost && (
          <div
            id={CRAWL_SLOT_ID}
            className="min-h-8 [&>[data-placeholder]:not(:only-child)]:hidden"
          >
            {activeDomain?.canCrawl && <CrawlActionsPlaceholder />}
          </div>
        )}
      </SidebarHeader>
      <SidebarContent className="px-3 pt-2 group-data-[collapsible=icon]:px-2">
        <nav aria-label={t('navLabel')} className="grid gap-6">
          {generalItems.length > 0 && <NavGroup items={generalItems} pathname={pathname} />}
          {systemItems.length > 0 && (
            <NavGroup label={t('administration')} items={systemItems} pathname={pathname} />
          )}
          {domainItems.length > 0 && <NavGroup items={domainItems} pathname={pathname} />}
          {settingsItems.length > 0 && (
            <NavGroup label={t('domain')} items={settingsItems} pathname={pathname} />
          )}
        </nav>
      </SidebarContent>
      <SidebarFooter className="gap-2 p-3 group-data-[collapsible=icon]:p-2">
        {isAdmin && (
          <nav aria-label={t('administration')}>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className={NAV_BUTTON}
                  tooltip={t('administration')}
                  render={<Link href="/system" />}
                  isActive={pathname === '/system' || pathname.startsWith('/system/')}
                >
                  <ShieldIcon />
                  <span>{t('administration')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </nav>
        )}
        <NavUser user={user} isAdmin={isAdmin} />
      </SidebarFooter>
    </Sidebar>
  )
}
