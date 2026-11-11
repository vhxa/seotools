import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { DomainRow } from '@/components/portfolio/domain-row'
import { getDb } from '@/lib/db'
import { summarizeDomain } from '@/lib/portfolio'
import { requireViewer } from '@/lib/session'
import { visibleCompanies } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('Portfolio')
  return { title: t('metaTitle') }
}

/**
 * The home. Someone who can see one domain (or none) has no portfolio to look at: they land on the
 * first active domain they can see (an archived one only if nothing else is left). With none, an
 * administrator goes to the companies, or to the onboarding if none exists, and anyone else is told
 * to ask for access. Two or more domains are shown together, by company, with how each stands.
 */
export default async function HomePage() {
  const viewer = await requireViewer()
  const companies = await visibleCompanies(viewer)
  const domains = companies.flatMap((company) => company.domains)
  if (domains.length < 2) {
    const first = domains.find((domain) => !domain.archivedAt) ?? domains[0]
    if (first) redirect(`/domains/${first.host}`)
    if (viewer.role !== 'admin') redirect('/no-access')
    redirect(companies.length > 0 ? '/system/companies' : '/onboarding')
  }

  const t = await getTranslations('Portfolio')
  const db = await getDb()
  // Two queries for every domain, however many: only what `visibleCompanies` returned is shown.
  const [portfolio, favicons] = await Promise.all([db.crawls.portfolio(), db.favicons.versions()])
  const sections = companies.map((company) => ({
    id: company.id,
    name: company.name,
    active: company.domains.filter((domain) => !domain.archivedAt),
    archived: company.domains.filter((domain) => domain.archivedAt),
  }))
  const archived = sections.filter((section) => section.archived.length > 0)

  return (
    <main className="grid gap-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {sections
        .filter((section) => section.active.length > 0)
        .map((section) => (
          <section
            key={section.id}
            aria-labelledby={`company-${section.id}`}
            className="grid gap-2"
          >
            <h2
              id={`company-${section.id}`}
              className="flex items-baseline gap-2 text-lg font-medium"
            >
              {section.name}
              <span className="text-sm font-normal text-muted-foreground">
                {t('domainsCount', { count: section.active.length })}
              </span>
            </h2>
            <ul className="divide-y rounded-lg border">
              {section.active.map((domain) => (
                <DomainRow
                  key={domain.id}
                  host={domain.host}
                  faviconVersion={favicons.get(domain.id) ?? null}
                  summary={summarizeDomain(portfolio.get(domain.id))}
                />
              ))}
            </ul>
          </section>
        ))}

      {archived.length > 0 && (
        <details className="grid gap-3 rounded-lg border px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {t('archived')}
          </summary>
          <p className="text-sm text-muted-foreground">{t('archivedHelp')}</p>
          {archived.map((section) => (
            <div key={section.id} className="grid gap-1">
              <h3 className="text-sm font-medium">{section.name}</h3>
              <ul className="divide-y rounded-lg border">
                {section.archived.map((domain) => (
                  <DomainRow
                    key={domain.id}
                    host={domain.host}
                    faviconVersion={favicons.get(domain.id) ?? null}
                    summary={summarizeDomain(portfolio.get(domain.id))}
                    compact
                  />
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
    </main>
  )
}
