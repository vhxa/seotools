import type { AuditSelector } from '@seotools/core/crawl/audit'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'

/** The parts of what a selector covers, in words. */
export function useSelectorParts() {
  const t = useTranslations('AuditRules')
  return (selector: AuditSelector) => ({
    kind: t(`kinds.${selector.kind}`),
    value: selector.kind === 'url' ? selector.url : selector.path,
    query:
      selector.kind === 'url'
        ? null
        : selector.query.mode === 'any'
          ? t('query.ignored')
          : selector.query.value === ''
            ? t('query.none')
            : t('query.only', { query: selector.query.value }),
  })
}

/** A selector on one line of text, for titles and messages. */
export function useSelectorText() {
  const parts = useSelectorParts()
  return (selector: AuditSelector) => {
    const { kind, value, query } = parts(selector)
    return query ? `${kind} ${value} (${query})` : `${kind} ${value}`
  }
}

/** What a rule covers: its kind, its address and, for a path, the query it asks for. */
export function SelectorLabel({ selector }: { selector: AuditSelector }) {
  const { kind, value, query } = useSelectorParts()(selector)
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge variant="outline">{kind}</Badge>
      <code className="font-mono text-xs break-all">{value}</code>
      {query && <span className="text-xs text-muted-foreground">{query}</span>}
    </span>
  )
}
