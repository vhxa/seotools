import { FindingStatesList } from '@/components/audit/finding-states-list'
import { auditResultsState } from '@seotools/core/crawl/audit'
import { getTranslations } from 'next-intl/server'
import { AuditResultsNotice } from '@/components/audit/audit-notice'
import { AuditTabs } from '@/components/audit/audit-tabs'
import { LanguagesTab } from '@/components/audit/languages-tab'
import { RulesTab } from '@/components/audit/rules-tab'
import { ThresholdsTab } from '@/components/audit/thresholds-tab'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { parseAuditTab } from '@/lib/audit-tabs'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('AuditRules')
  return { title: t('metaTitle', { host }) }
}

export default async function AuditSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { host } = await params
  const tab = parseAuditTab((await searchParams).tab)
  const { domain } = await requireDomain(host)
  const t = await getTranslations('AuditRules')
  const db = await getDb()

  const [config, latest] = await Promise.all([
    db.audit.config(domain.id),
    db.crawls.latestWithResults(domain.id, 'full'),
  ])
  const state = auditResultsState(latest, config)
  const languagesDeclared = config.languages.prefixes.length > 0 || config.languages.unprefixed

  // What each rule decided in the last analysis, which knows only the rules it was made with.
  const counts = latest ? await db.crawls.auditRuleCounts(latest.id) : new Map<string, number>()
  const known = new Set(latest?.auditSnapshot?.rules.map((rule) => rule.id))
  const affected = new Map(
    config.rules.map((rule) => [rule.id, known.has(rule.id) ? (counts.get(rule.id) ?? 0) : null]),
  )

  return (
    <>
      <AuditResultsNotice host={domain.host} state={state} />
      {!latest && (
        <Alert>
          <AlertDescription>{t('status.noCrawl')}</AlertDescription>
        </Alert>
      )}
      <AuditTabs host={domain.host} active={tab}>
        {tab === 'rules' && (
          <RulesTab
            host={domain.host}
            rules={config.rules}
            affected={affected}
            languagesDeclared={languagesDeclared}
          />
        )}
        {tab === 'languages' && (
          <LanguagesTab host={domain.host} languages={config.languages} rules={config.rules} />
        )}
        {tab === 'thresholds' && (
          <ThresholdsTab host={domain.host} thresholds={config.thresholds} />
        )}
        {tab === 'dismissed' && (
          <FindingStatesList host={domain.host} rows={config.findingStates} />
        )}
      </AuditTabs>
    </>
  )
}
