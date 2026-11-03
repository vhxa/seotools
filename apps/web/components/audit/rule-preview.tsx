'use client'

import { useFormatter, useTranslations } from 'next-intl'
import type { PreviewState } from '@/app/(protected)/domains/[host]/audit-actions'
import { SelectorLabel, useSelectorText } from '@/components/audit/selector-label'

function Urls({ title, urls }: { title: string; urls: string[] }) {
  if (urls.length === 0) return null
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{title}</span>
      <ul className="grid gap-0.5">
        {urls.map((url) => (
          <li key={url} className="font-mono text-xs break-all">
            {url}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * What a rule would do to the URLs the last full crawl knows, before saving it: the URLs the selector
 * covers, the ones whose effective result would change, and the ones where another rule prevails.
 */
export function RulePreview({ state }: { state: PreviewState }) {
  const t = useTranslations('AuditRules.preview')
  const format = useFormatter()
  const selectorText = useSelectorText()

  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    )
  }
  if (state.status === 'no-results') {
    return <p className="text-sm text-muted-foreground">{t('noResults')}</p>
  }
  if (state.status === 'conflict') {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('conflict', { rule: selectorText(state.with.selector) })}
      </p>
    )
  }
  return (
    <div role="status" className="grid gap-3 rounded-lg border p-3 text-sm">
      <p className="font-medium">
        {state.matches === 0 ? t('matchesNone') : t('matches', { count: state.matches })}
      </p>
      {!state.active && <p>{t('inactive')}</p>}
      {/* What changes can be more than what the selector covers: an edit stops covering URLs. */}
      {(state.matches > 0 || state.changes > 0) && (
        <p>{state.changes === 0 ? t('changesNone') : t('changes', { count: state.changes })}</p>
      )}
      {state.overriddenCount > 0 && <p>{t('overridden', { count: state.overriddenCount })}</p>}
      <Urls title={t('matchExamples')} urls={state.matchSamples} />
      <Urls title={t('changeExamples')} urls={state.changeSamples} />
      {state.overridden.length > 0 && (
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">{t('overriddenExamples')}</span>
          <ul className="grid gap-1.5">
            {state.overridden.map(({ url, by }) => (
              <li key={url} className="grid gap-0.5">
                <span className="font-mono text-xs break-all">{url}</span>
                <SelectorLabel selector={by.selector} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {state.crawledAt
          ? t('note', {
              when: format.dateTime(new Date(state.crawledAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })
          : t('noteUnknown')}{' '}
        {t('scanned', { count: state.scanned })}
      </p>
    </div>
  )
}
