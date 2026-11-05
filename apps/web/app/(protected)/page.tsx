import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db'
import { requireSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/**
 * There is no home of its own: land on the first active domain (an archived one only if nothing else
 * is left), or on the companies if some exist without domains, or on the onboarding if none exists.
 */
export default async function HomePage() {
  await requireSession()
  const companies = await (await getDb()).companies.list()
  const domains = companies.flatMap((company) => company.domains)
  const first = domains.find((domain) => !domain.archivedAt) ?? domains[0]
  if (first) redirect(`/domains/${first.host}`)
  redirect(companies.length > 0 ? '/companies' : '/onboarding')
}
