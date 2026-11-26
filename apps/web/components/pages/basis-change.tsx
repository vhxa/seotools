'use client'

import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { BasisChange } from '@/lib/dashboard'

/** The words for what changed between two crawls, the same in the trend chart and the tiles. */
export function useDescribeBasisChange(): (change: BasisChange) => string {
  const t = useTranslations('Dashboard')
  const format = useFormatter()
  return (change) => {
    switch (change.kind) {
      case 'rendering':
        return t(`basis.rendering.${change.to}`)
      case 'ignoredAdded':
      case 'ignoredRemoved':
        return t(`basis.${change.kind}`, {
          count: change.parameters.length,
          parameters: format.list(change.parameters.slice(0, 4)),
          more: Math.max(0, change.parameters.length - 4),
        })
      case 'settings':
        return t('basis.settings', {
          settings: format.list(change.settings.map((setting) => t(`basis.setting.${setting}`))),
        })
      case 'catalog':
        return t('basis.catalog')
      case 'rules':
        return t('basis.rules')
    }
  }
}

/**
 * Where a tile's difference would be, when the two crawls did not measure the same thing: no
 * figure, only the fact, what changed (as the trend says it) and a link to the comparison.
 */
export function NotComparable({ changes, href }: { changes: BasisChange[]; href: string }) {
  const t = useTranslations('Dashboard')
  const describe = useDescribeBasisChange()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={href}
            className="rounded-sm text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        }
      >
        {t('notComparable')}
      </TooltipTrigger>
      <TooltipContent className="grid max-w-xs gap-1">
        <span className="font-medium">{t('notComparableTitle')}</span>
        {changes.map((change) => (
          <span key={change.kind}>{describe(change)}</span>
        ))}
        <span className="opacity-80">{t('notComparableLink')}</span>
      </TooltipContent>
    </Tooltip>
  )
}
