'use client'

import {
  BellIcon,
  CalendarClockIcon,
  RadarIcon,
  ShieldCheckIcon,
  StarIcon,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

/** The sections of a domain's settings. Each one is a route under `/domains/[host]/settings`. */
const SECTIONS: readonly {
  id: 'crawl' | 'schedules' | 'audit' | 'priority' | 'alerts'
  icon: LucideIcon
}[] = [
  { id: 'crawl', icon: RadarIcon },
  { id: 'schedules', icon: CalendarClockIcon },
  { id: 'audit', icon: ShieldCheckIcon },
  { id: 'priority', icon: StarIcon },
  { id: 'alerts', icon: BellIcon },
]

/** A column beside the section on wide screens, and a row above it on narrow ones. */
export function SettingsNav({ host }: { host: string }) {
  const t = useTranslations('DomainSettings')
  const pathname = usePathname()
  return (
    <nav
      aria-label={t('navLabel')}
      className="flex gap-1 overflow-x-auto md:sticky md:top-20 md:flex-col"
    >
      {SECTIONS.map(({ id, icon: Icon }) => {
        const href = `/domains/${host}/settings/${id}`
        const active = pathname === href
        return (
          <Link
            key={id}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              // The rows of the sidebar, so a list of sections reads like the main navigation.
              'flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2 text-sm font-medium whitespace-nowrap outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0',
              active && 'bg-muted',
            )}
          >
            <Icon />
            {t(`sections.${id}`)}
          </Link>
        )
      })}
    </nav>
  )
}
