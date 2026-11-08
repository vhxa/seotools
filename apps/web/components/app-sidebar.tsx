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
import { type SwitcherCompany } from '@/components/domain-switcher'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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

/** Options that unfold in place. */
function NavCollapsible({ section, pathname }: { section: NavSection; pathname: string }) {
  const active = section.links.some((link) => isActive(link, pathname))
  const [open, setOpen] = useState(active)

  return (
    <Collapsible open={open} onOpenChange={setOpen} render={<SidebarMenuItem />}>
      <CollapsibleTrigger render={<SidebarMenuButton />}>
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

function NavGroup({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <SidebarGroup>
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
 * App navigation, under the header, only while a domain is open (`/domains/[host]`): its options
 * and, for administrators, the administration at the bottom. The domain selector and the user are in the
 * header. Always in view on wide screens; on narrow ones it opens from the header's button.
 */
export function AppSidebar({
  isAdmin,
  companies,
}: {
  isAdmin: boolean
  companies: SwitcherCompany[]
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

  // Outside a domain (System, the account, adding a domain) there is nothing to navigate here.
  if (!activeHost) return null

  return (
    <nav aria-label={t('navLabel')} className="contents">
      {/* Starts below the header (`h-16`) instead of at the top of the screen, and has no
          background or border of its own: it sits on the page like the header does. */}
      <Sidebar className="top-16 h-[calc(100svh-4rem)] group-data-[side=left]:border-r-0 [&_[data-slot=sidebar-inner]]:bg-transparent">
        <div className="flex min-h-0 flex-1 flex-col">
          <SidebarContent>
            <NavGroup items={domainItems} pathname={pathname} />
          </SidebarContent>
        </div>
        {isAdmin && (
          <SidebarFooter>
            <nav aria-label={t('administration')}>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/system" />}
                    isActive={pathname === '/system' || pathname.startsWith('/system/')}
                  >
                    <ShieldIcon />
                    <span>{t('administration')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </nav>
          </SidebarFooter>
        )}
      </Sidebar>
    </nav>
  )
}
