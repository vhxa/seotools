'use client'

import { GitCompareArrowsIcon, ListIcon, RefreshCwIcon, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The sections of the Crawls area. Each one is a route under `/domains/[host]/crawls`. */
const SECTIONS: readonly {
  id: 'list' | 'compare' | 'rechecks'
  path: string
  icon: LucideIcon
  /** Active only on this exact path, not on its sub-pages. */
  exact?: boolean
}[] = [
  { id: 'list', path: '', icon: ListIcon, exact: true },
  { id: 'compare', path: '/compare', icon: GitCompareArrowsIcon },
  { id: 'rechecks', path: '/rechecks', icon: RefreshCwIcon },
]

/** A row above the pages of the Crawls area; it wraps on narrow screens. */
export function CrawlsNav({ host }: { host: string }) {
  const t = useTranslations('CrawlsArea.nav')
  const pathname = usePathname()
  return (
    <nav aria-label={t('label')} className="flex min-w-0 flex-wrap gap-1">
      {SECTIONS.map(({ id, path, icon: Icon, exact }) => {
        const href = `/domains/${host}/crawls${path}`
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
