import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { DomainPortfolio } from '@/components/portfolio/domain-portfolio'
import { getDb } from '@/lib/db'
import { requireViewer } from '@/lib/session'
import { visibleCompanies } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('Portfolio')
  return { title: t('metaTitle') }
}

export default async function HomePage() {
  const viewer = await requireViewer()
  const companies = await visibleCompanies(viewer)
  const domains = companies.flatMap((company) => company.domains)
  const favouriteDomainId = await (
    await getDb()
  ).userPreferences.favouriteDomainId(viewer.session.user.id)
  const favourite = domains.find((domain) => domain.id === favouriteDomainId)
  if (favourite) redirect(`/domains/${favourite.host}`)
  if (domains.length < 2) {
    const first = domains.find((domain) => !domain.archivedAt) ?? domains[0]
    if (first) redirect(`/domains/${first.host}`)
    if (viewer.role !== 'admin') redirect('/no-access')
    redirect(companies.length > 0 ? '/system/companies' : '/onboarding')
  }

  return <DomainPortfolio companies={companies} favouriteDomainId={favouriteDomainId} />
}
