import { redirect } from 'next/navigation'
import { requireViewer } from '@/lib/session'
import { visibleCompanies } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

/**
 * There is no home of its own: land on the first active domain the person can see (an archived one
 * only if nothing else is left). With none, an administrator goes to the companies, or to the
 * onboarding if none exists, and anyone else is told to ask for access.
 */
export default async function HomePage() {
  const viewer = await requireViewer()
  const companies = await visibleCompanies(viewer)
  const domains = companies.flatMap((company) => company.domains)
  const first = domains.find((domain) => !domain.archivedAt) ?? domains[0]
  if (first) redirect(`/domains/${first.host}`)
  if (viewer.role !== 'admin') redirect('/no-access')
  redirect(companies.length > 0 ? '/companies' : '/onboarding')
}
