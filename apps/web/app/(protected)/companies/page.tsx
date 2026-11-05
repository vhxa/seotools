import { accessAfterMove } from '@seotools/core/access'
import { PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { CompanyActions } from '@/components/companies/company-actions'
import { DomainActions } from '@/components/companies/domain-actions'
import { sumUsage, type UsageCounts } from '@/components/companies/usage-list'
import { DomainIcon } from '@/components/domain-icon'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import { requireAdmin } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('Companies')
  return { title: t('metaTitle') }
}

const NO_USAGE: UsageCounts = {
  crawls: 0,
  urls: 0,
  rules: 0,
  rechecks: 0,
  schedules: 0,
  priorityUrls: 0,
  crawlFiles: 0,
}

/** Where companies and their domains are managed: instance-wide, so only administrators. */
export default async function CompaniesPage() {
  await requireAdmin()
  const t = await getTranslations('Companies')
  const db = await getDb()
  const [companies, usage, icons, users, grants] = await Promise.all([
    db.companies.list(),
    db.domains.usage(),
    db.favicons.versions(),
    db.users.list(),
    db.users.allGrants(),
  ])
  const members = users.map((user) => ({ ...user, grants: grants.get(user.id) ?? [] }))
  const moveAccessOf = (domainId: string, from: string) =>
    Object.fromEntries(
      companies
        .filter((other) => other.id !== from)
        .map((other) => {
          const { gain, lose } = accessAfterMove(members, { domainId, from, to: other.id })
          return [
            other.id,
            { gain: gain.map(({ name }) => name), lose: lose.map(({ name }) => name) },
          ]
        }),
    )

  return (
    <main className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Link href="/companies/new" className={buttonVariants({ variant: 'outline' })}>
          <PlusIcon />
          {t('addCompany')}
        </Link>
      </div>

      {companies.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}

      {companies.map((company) => {
        const usageOf = (id: string) => usage.get(id) ?? NO_USAGE
        return (
          <Card key={company.id} className="gap-0 py-0">
            <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
              <div className="grid gap-0.5">
                <h2 className="font-medium">{company.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {company.domains.length === 0
                    ? t('noDomains')
                    : t('domainCount', { count: company.domains.length })}
                </p>
              </div>
              <CompanyActions
                company={{ id: company.id, name: company.name }}
                hosts={company.domains.map((domain) => domain.host)}
                usage={sumUsage(company.domains.map((domain) => usageOf(domain.id)))}
              />
            </div>
            {company.domains.length > 0 && (
              <ul className="divide-y">
                {company.domains.map((domain) => (
                  <li key={domain.id} className="flex items-center justify-between gap-4 px-4 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <DomainIcon
                        host={domain.host}
                        version={icons.get(domain.id) ?? null}
                        size="sm"
                      />
                      <Link
                        href={`/domains/${domain.host}`}
                        className="truncate text-sm hover:underline"
                      >
                        {domain.host}
                      </Link>
                      {domain.archivedAt && <Badge variant="secondary">{t('archivedBadge')}</Badge>}
                    </div>
                    <DomainActions
                      domain={{
                        id: domain.id,
                        host: domain.host,
                        archived: domain.archivedAt !== null,
                      }}
                      company={{ id: company.id, name: company.name }}
                      companies={companies.map(({ id, name }) => ({ id, name }))}
                      moveAccess={moveAccessOf(domain.id, company.id)}
                      usage={usageOf(domain.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )
      })}
    </main>
  )
}
