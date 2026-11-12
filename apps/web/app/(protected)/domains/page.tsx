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

export default async function DomainsPage() {
  const viewer = await requireViewer()
  const companies = await visibleCompanies(viewer)
  const domains = companies.flatMap((company) => company.domains)
  const favouriteDomainId = await (
    await getDb()
  ).userPreferences.favouriteDomainId(viewer.session.user.id)
  if (domains.length === 0) {
    if (viewer.role !== 'admin') redirect('/no-access')
    redirect(companies.length > 0 ? '/system/companies' : '/onboarding')
  }

  return <DomainPortfolio companies={companies} favouriteDomainId={favouriteDomainId} />
}
