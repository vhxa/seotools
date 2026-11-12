'use client'

import type { ExtraCrawlFileKind } from '@seotools/core'
import {
  LayoutListIcon,
  StarIcon,
  BuildingIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  PlusIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { DomainIcon } from '@/components/domain-icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

export interface SwitcherDomain {
  id: string
  host: string
  /** Archived domains stay reachable but are listed apart, so they do not clutter daily use. */
  archived: boolean
  /** Hash of the stored favicon, or `null` when the site has none (yet). */
  faviconVersion: string | null
  /** The extra crawl files the domain turned on: each one is an entry of the sidebar. */
  extraFiles: ExtraCrawlFileKind[]
}

export interface SwitcherCompany {
  id: string
  name: string
  domains: SwitcherDomain[]
}

/**
 * Domain picker in the header, grouped by company (like Search Console's property
 * selector). The active domain comes from the `/domains/[host]` route, so it is always shareable
 * and each browser tab can sit on a different domain.
 */
export function DomainSwitcher({
  favouriteDomainId,
  companies,
  canManage,
}: {
  favouriteDomainId: string | null
  companies: SwitcherCompany[]
  /** Adding and managing companies is for administrators. */
  canManage: boolean
}) {
  const t = useTranslations('DomainSwitcher')
  const { host: currentHost } = useParams<{ host?: string }>()
  const pathname = usePathname()

  const current = companies.find((company) =>
    company.domains.some((domain) => domain.host === currentHost),
  )

  // Switching keeps the section you are in: /domains/a.com/audits → /domains/b.com/audits.
  const currentBase = `/domains/${currentHost}`
  const section =
    currentHost && pathname.startsWith(`${currentBase}/`) ? pathname.slice(currentBase.length) : ''
  const hrefFor = (host: string) => `/domains/${host}${section}`

  // Active domains by company; archived ones, whatever their company, in a group of their own.
  const withActive = companies
    .map((company) => ({
      ...company,
      domains: company.domains.filter((domain) => !domain.archived),
    }))
    .filter((company) => company.domains.length > 0)
  const archivedDomains = companies.flatMap((company) =>
    company.domains.filter((domain) => domain.archived),
  )
  const domainItem = (domain: SwitcherDomain) => (
    <DropdownMenuItem key={domain.id} render={<Link href={hrefFor(domain.host)} />}>
      <DomainIcon host={domain.host} version={domain.faviconVersion} size="sm" />
      <span className="flex-1 truncate">{domain.host}</span>
      {domain.id === favouriteDomainId && (
        <StarIcon className="size-3 fill-current text-amber-600" aria-label={t('favourite')} />
      )}
      {domain.host === currentHost && <CheckIcon />}
    </DropdownMenuItem>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            aria-label={t('label')}
            className="h-10 min-w-0 gap-2 px-2 data-popup-open:bg-muted"
          />
        }
      >
        {current && currentHost ? (
          <span className="grid min-w-0 text-left text-sm leading-tight">
            <span className="truncate font-medium">{currentHost}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              {current.name}
            </span>
          </span>
        ) : (
          <span className="truncate text-muted-foreground">{t('placeholder')}</span>
        )}
        <ChevronsUpDownIcon className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="max-h-(--available-height) w-72 overflow-y-auto"
        align="start"
        side="bottom"
        sideOffset={4}
      >
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link href="/domains" />}>
            <LayoutListIcon />
            {t('allDomains')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {withActive.map((company, index) => (
          <DropdownMenuGroup key={company.id}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{company.name}</DropdownMenuLabel>
            {company.domains.map((domain) => domainItem(domain))}
          </DropdownMenuGroup>
        ))}
        {archivedDomains.length > 0 && (
          <DropdownMenuGroup>
            {withActive.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{t('archived')}</DropdownMenuLabel>
            {archivedDomains.map((domain) => domainItem(domain))}
          </DropdownMenuGroup>
        )}
        {canManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                render={
                  <Link
                    href={
                      current
                        ? `/domains/new?company=${encodeURIComponent(current.id)}`
                        : '/domains/new'
                    }
                  />
                }
              >
                <PlusIcon />
                {t('addDomain')}
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/system/companies/new" />}>
                <PlusIcon />
                {t('addCompany')}
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/system/companies" />}>
                <BuildingIcon />
                {t('manageCompanies')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
