import { AUDIT_CONDITIONS } from '@seotools/core/crawl/audit'
import type { AuditRuleRecord } from '@seotools/db'
import { ListChecksIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { CreateRuleButton } from '@/components/audit/create-rule-button'
import { RuleRowActions, RuleToggle } from '@/components/audit/rule-actions'
import { SelectorLabel } from '@/components/audit/selector-label'
import { InfoHelp } from '@/components/help'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { groupRules } from '@/lib/audit-rules'
import { detailHref, parseDetailQuery } from '@/lib/pages-query'

/**
 * The rules of the domain, as one list: where each applies and everything it says there (whether the
 * URLs take part in the audit, what it requires, allows or forbids of each condition, and, as an
 * advanced concept, the expectation of indexing as a whole). A rule is the rows that share a
 * selector, so creating, editing, switching and deleting act on all of what it says. The exceptions
 * set on one URL from the table or its detail are rules too, and are listed here.
 */
export async function RulesTab({
  host,
  rules,
  affected,
  languagesDeclared,
}: {
  host: string
  /** Every rule of the domain. */
  rules: AuditRuleRecord[]
  /**
   * How many URLs of the analysed crawl each row decided. A rule the analysis did not know yet has
   * no entry, which is not the same as deciding none.
   */
  affected: ReadonlyMap<string, number | null>
  /** Whether the domain declared language directories: shared rules cover nothing before. */
  languagesDeclared: boolean
}) {
  const t = await getTranslations('AuditRules')
  const tStatements = await getTranslations('AuditStatements')
  const tRequirement = await getTranslations('AuditStatements.requirement')
  const groups = groupRules(rules)
  const base = parseDetailQuery({})

  return (
    <Card>
      <CardHeader className="gap-3 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-1">
            {t('sections.rules.title')}
            <InfoHelp label={t('sections.rules.title')}>{t('sections.rules.description')}</InfoHelp>
          </CardTitle>
          <p className="text-sm font-medium">{t('sections.rules.default')}</p>
        </div>
        {groups.length > 0 && (
          <CreateRuleButton host={host} languagesDeclared={languagesDeclared} />
        )}
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <div className="grid justify-items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
            <ListChecksIcon aria-hidden className="size-6 text-muted-foreground" />
            <div className="grid gap-1">
              <p className="font-medium">{t('sections.rules.emptyTitle')}</p>
              <p className="max-w-md text-sm text-muted-foreground">{t('sections.rules.empty')}</p>
            </div>
            <CreateRuleButton host={host} languagesDeclared={languagesDeclared} />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('list.columns.selector')}</TableHead>
                <TableHead>{t('list.columns.says')}</TableHead>
                <TableHead>{t('list.columns.enabled')}</TableHead>
                <TableHead>{t('list.columns.reason')}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const shared = group.selector.kind !== 'url' && group.selector.scope === 'shared'
                const statements = [
                  ...(['audit', 'intent', ...AUDIT_CONDITIONS] as const).flatMap((key) => {
                    const rule = group.statements[key]
                    if (!rule) return []
                    const label =
                      rule.dimension === 'audit'
                        ? tStatements(`audit.${rule.value}`)
                        : rule.dimension === 'intent'
                          ? tStatements(
                              `intent.${rule.value === 'not-indexable' ? 'not-indexable' : 'indexable'}`,
                            )
                          : tStatements('conditions.statement', {
                              condition: tStatements(`conditions.${rule.dimension}.label`),
                              requirement: tRequirement(rule.value),
                            })
                    return [{ id: rule.id, label, count: affected.get(rule.id) ?? null }]
                  }),
                ]
                return (
                  <TableRow key={group.key} className={group.enabled ? undefined : 'opacity-60'}>
                    <TableCell className="max-w-xs whitespace-normal">
                      <div className="grid gap-1">
                        <SelectorLabel selector={group.selector} />
                        <div className="flex flex-wrap items-center gap-1">
                          {group.selector.kind === 'url' && (
                            <span className="text-xs text-muted-foreground">
                              {t('list.exception')}
                            </span>
                          )}
                          {shared && (
                            <Badge variant="secondary" className="font-normal">
                              {t('scope.shared')}
                            </Badge>
                          )}
                        </div>
                        {shared && !languagesDeclared && (
                          <span className="text-xs text-muted-foreground">
                            {t('list.sharedWithoutLanguages')}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <ul className="grid gap-1.5">
                        {statements.map(({ id, label, count }) => (
                          <li key={id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <Badge variant="outline" className="font-normal">
                              {label}
                            </Badge>
                            {count === null ? (
                              <span className="text-xs text-muted-foreground">
                                {t('list.affectsUnknown')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-x-2 text-xs whitespace-nowrap">
                                <span className="text-muted-foreground tabular-nums">
                                  {t('list.affects', { count })}
                                </span>
                                {count > 0 && (
                                  <Link
                                    href={detailHref(host, base, { rule: id })}
                                    className="underline"
                                  >
                                    {t('list.viewAffected')}
                                  </Link>
                                )}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell>
                      <RuleToggle
                        host={host}
                        ids={group.ids}
                        enabled={group.enabled}
                        selector={group.selector}
                      />
                    </TableCell>
                    <TableCell className="max-w-56 whitespace-normal text-muted-foreground">
                      {group.reason ?? '—'}
                    </TableCell>
                    <TableCell>
                      <RuleRowActions
                        host={host}
                        rule={group}
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
