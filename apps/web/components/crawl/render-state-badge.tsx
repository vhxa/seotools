'use client'

import { isCompleteRender, type RenderState } from '@seotools/core/crawl/render-state'
import { CircleCheckIcon, CornerUpRightIcon, TriangleAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

/**
 * What a rendered crawl observed of a page, in one word, with the sentence that says what it means
 * as its title. Not rendered (`null`) is a state of its own: nothing was observed, which is never
 * the same as nothing differing.
 */
export function RenderStateBadge({ state }: { state: RenderState | null }) {
  const t = useTranslations('RenderState')
  if (state === null) {
    return (
      <span className="text-muted-foreground" title={t('hints.notRendered')}>
        {t('notRendered')}
      </span>
    )
  }
  const Icon =
    state === 'redirect'
      ? CornerUpRightIcon
      : isCompleteRender(state)
        ? CircleCheckIcon
        : TriangleAlertIcon
  return (
    <span
      className={`inline-flex items-center gap-1 ${isCompleteRender(state) ? '' : 'text-amber-700 dark:text-amber-400'}`}
      title={t(`hints.${state}`)}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {t(state)}
    </span>
  )
}
