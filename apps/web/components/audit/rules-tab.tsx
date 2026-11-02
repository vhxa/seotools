import type { AuditDimension } from '@seotools/core/crawl/audit'
import type { AuditRuleRecord } from '@seotools/db'
import { CheckIcon, ListChecksIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { CreateRuleButton } from '@/components/audit/create-rule-button'
import { RuleRowActions, RuleToggle } from '@/components/audit/rule-actions'
import { SelectorLabel } from '@/components/audit/selector-label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { detailHref, parseDetailQuery } from '@/lib/pages-query'

/**
 * The rules of one dimension — exclusions from the audit, or expected indexing and directives — as
 * a management panel: a short header with what happens by default and the button to create a rule,
 * and the table of what is there. Creating and editing happen in a dialog. Both tabs are this
 * component: the selectors, the preview, the precedence and the rules themselves are the same, and
 * so are the exceptions set on one URL from the table or its detail, which are listed here too.
 */
export async function RulesTab({
  host,
  dimension,
  rules,
  affected,
  languagesDeclared,
}: {
  host: string
  dimension: AuditDimension
  /** Every rule of the domain; the tab shows those of its dimension. */
  rules: AuditRuleRecord[]
  /**
   * How many URLs of the analysed crawl each rule decided. A rule the analysis did not know yet has
   * no entry, which is not the same as deciding none.
   */
  affected: ReadonlyMap<string, number | null>
  /** Whether the domain declared language directories: shared rules cover nothing before. */
  languagesDeclared: boolean
}) {
  const t = await getTranslations('AuditRules')
  const mine = rules.filter((rule) => rule.dimension === dimension)
  const base = parseDetailQuery({})
  const showsNofollow = dimension === 'intent'

  return (
    <Card>
      <CardHeader className="gap-3 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-1.5">
          <CardTitle>{t(`sections.${dimension}.title`)}</CardTitle>
          <CardDescription>{t(`sections.${dimension}.description`)}</CardDescription>
          <p className="text-sm font-medium">{t(`sections.${dimension}.default`)}</p>
        </div>
        {mine.length > 0 && (
          <CreateRuleButton
            host={host}
            dimension={dimension}
            languagesDeclared={languagesDeclared}
          />
        )}
      </CardHeader>
      <CardContent>
        {mine.length === 0 ? (
          <div className="grid justify-items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
            <ListChecksIcon aria-hidden className="size-6 text-muted-foreground" />
            <div className="grid gap-1">
              <p className="font-medium">{t(`sections.${dimension}.emptyTitle`)}</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {t(`sections.${dimension}.empty`)}
              </p>
            </div>
            <CreateRuleButton
              host={host}
              dimension={dimension}
              languagesDeclared={languagesDeclared}
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('list.columns.selector')}</TableHead>
                <TableHead>{t('list.columns.scope')}</TableHead>
                <TableHead>{t('list.columns.rule')}</TableHead>
                {showsNofollow && <TableHead>{t('list.columns.nofollow')}</TableHead>}
                <TableHead>{t('list.columns.enabled')}</TableHead>
                <TableHead>{t('list.columns.affects')}</TableHead>
                <TableHead>{t('list.columns.reason')}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {mine.map((rule) => {
                const count = affected.get(rule.id) ?? null
                const shared = rule.selector.kind !== 'url' && rule.selector.scope === 'shared'
                return (
                  <TableRow key={rule.id} className={rule.enabled ? undefined : 'opacity-60'}>
                    <TableCell className="max-w-xs whitespace-normal">
                      <div className="grid gap-1">
                        <SelectorLabel selector={rule.selector} />
                        {rule.selector.kind === 'url' && (
                          <span className="text-xs text-muted-foreground">
                            {t('list.exception')}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="grid gap-1">
                        <Badge variant={shared ? 'secondary' : 'outline'} className="font-normal">
                          {t(
                            rule.selector.kind === 'url'
                              ? 'scope.url'
                              : shared
                                ? 'scope.shared'
                                : 'scope.literal',
                          )}
                        </Badge>
                        {shared && !languagesDeclared && (
                          <span className="text-xs text-muted-foreground">
                            {t('list.sharedWithoutLanguages')}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {rule.dimension === 'audit'
                          ? t(`values.audit.${rule.value}`)
                          : t(`values.intent.${rule.value === 'none' ? 'indexable' : rule.value}`)}
                      </Badge>
                    </TableCell>
                    {showsNofollow && (
                      <TableCell>
                        {rule.dimension === 'intent' && rule.acceptNofollow ? (
                          <span className="inline-flex items-center gap-1 text-sm">
                            <CheckIcon aria-hidden className="size-3.5" />
                            {t('nofollow.accepted')}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t('nofollow.notAccepted')}</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <RuleToggle host={host} rule={rule} />
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {count === null ? (
                        <span className="text-xs text-muted-foreground">
                          {t('list.affectsUnknown')}
                        </span>
                      ) : (
                        <div className="grid gap-0.5">
                          <span className="tabular-nums">{t('list.affects', { count })}</span>
                          {count > 0 && (
                            <Link
                              href={detailHref(host, base, { rule: rule.id })}
                              className="text-xs underline"
                            >
                              {t('list.viewAffected')}
                            </Link>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-56 whitespace-normal text-muted-foreground">
                      {rule.reason ?? '—'}
                    </TableCell>
                    <TableCell>
                      <RuleRowActions
                        host={host}
                        rule={rule}
                        languagesDeclared={languagesDeclared}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
