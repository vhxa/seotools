import type { LanguageConfig } from '@seotools/core/crawl/audit'
import type { AuditRuleRecord } from '@seotools/db'
import { getTranslations } from 'next-intl/server'
import { LanguagesForm } from '@/components/audit/languages-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** The language directories of the domain: what the rules shared between languages look at. */
export async function LanguagesTab({
  host,
  languages,
  rules,
}: {
  host: string
  languages: LanguageConfig
  rules: AuditRuleRecord[]
}) {
  const t = await getTranslations('AuditRules.languages')
  const shared = rules.filter(
    (rule) => rule.selector.kind !== 'url' && rule.selector.scope === 'shared',
  ).length
  const declared = languages.prefixes.length > 0 || languages.unprefixed
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <LanguagesForm host={host} languages={languages} />
        <div className="grid gap-1 border-t pt-4 text-sm text-muted-foreground">
          <p>{t('example')}</p>
          <p>{shared > 0 ? t('sharedRules', { count: shared }) : t('noSharedRules')}</p>
          {!declared && shared > 0 && <p className="text-foreground">{t('none')}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
