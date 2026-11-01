'use client'

import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface SwitcherCompany {
  id: string
  name: string
  domains: { id: string; host: string }[]
}

/**
 * Domain picker in the header, grouped by company (like Search Console's property selector).
 * The active domain comes from the `/domains/[host]` route, so it is always shareable and each
 * browser tab can sit on a different domain.
 */
export function DomainSwitcher({ companies }: { companies: SwitcherCompany[] }) {
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            aria-label={t('label')}
            className="h-auto min-w-52 justify-between gap-3 py-1"
          />
        }
      >
        {current && currentHost ? (
          <span className="grid text-left leading-tight">
            <span className="text-sm font-medium">{currentHost}</span>
            <span className="text-xs font-normal text-muted-foreground">{current.name}</span>
          </span>
        ) : (
          <span className="py-1.5 font-normal text-muted-foreground">{t('placeholder')}</span>
        )}
        <ChevronsUpDownIcon className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="start">
        {companies.map((company, index) => (
          <DropdownMenuGroup key={company.id}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{company.name}</DropdownMenuLabel>
            {company.domains.map((domain) => (
              <DropdownMenuItem
                key={domain.id}
                render={<Link href={hrefFor(domain.host)} />}
                className="justify-between"
              >
                {domain.host}
                {domain.host === currentHost && <CheckIcon />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
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
          <DropdownMenuItem render={<Link href="/companies/new" />}>
            <PlusIcon />
            {t('addCompany')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
