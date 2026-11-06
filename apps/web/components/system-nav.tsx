'use client'

import {
  ActivityIcon,
  ArrowUpCircleIcon,
  BuildingIcon,
  MailIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The sections of Administration. Each one is a route under `/system`. */
const SECTIONS: readonly {
  id: 'status' | 'companies' | 'users' | 'email' | 'updates'
  href: string
  icon: LucideIcon
  /** Active only on this exact path, not on its sub-pages. */
  exact?: boolean
}[] = [
  { id: 'status', href: '/system', icon: ActivityIcon, exact: true },
  { id: 'companies', href: '/system/companies', icon: BuildingIcon },
  { id: 'users', href: '/system/users', icon: UsersIcon },
  { id: 'email', href: '/system/email', icon: MailIcon },
  { id: 'updates', href: '/system/updates', icon: ArrowUpCircleIcon },
]

/** A row above the section of Administration; it scrolls sideways on narrow screens. */
export function SystemNav() {
  const t = useTranslations('SystemNav')
  const pathname = usePathname()
  return (
    <nav aria-label={t('label')} className="flex gap-1 overflow-x-auto">
      {SECTIONS.map(({ id, href, icon: Icon, exact }) => {
        const active = pathname === href || (!exact && pathname.startsWith(`${href}/`))
        return (
          <Link
            key={id}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(buttonVariants({ variant: active ? 'secondary' : 'ghost' }), 'shrink-0')}
          >
            <Icon />
            {t(id)}
          </Link>
        )
      })}
    </nav>
  )
}
