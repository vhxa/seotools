'use client'

import { RadarIcon, ShieldCheckIcon, StarIcon, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The sections of a domain's settings. Each one is a route under `/domains/[host]/settings`. */
const SECTIONS: readonly { id: 'crawl' | 'audit' | 'priority'; icon: LucideIcon }[] = [
  { id: 'crawl', icon: RadarIcon },
  { id: 'audit', icon: ShieldCheckIcon },
  { id: 'priority', icon: StarIcon },
]

/** A column beside the section on wide screens, and a row above it on narrow ones. */
export function SettingsNav({ host }: { host: string }) {
  const t = useTranslations('DomainSettings')
  const pathname = usePathname()
  return (
    <nav aria-label={t('navLabel')} className="flex gap-1 overflow-x-auto md:flex-col">
      {SECTIONS.map(({ id, icon: Icon }) => {
        const href = `/domains/${host}/settings/${id}`
        const active = pathname === href
        return (
          <Link
            key={id}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              buttonVariants({ variant: active ? 'secondary' : 'ghost' }),
              'shrink-0 md:justify-start',
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
