import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db'
import { requireSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

/** There is no home of its own: land on the first domain, or on the onboarding if none exists. */
export default async function HomePage() {
  await requireSession()
  const companies = await (await getDb()).companies.list()
  const first = companies.flatMap((company) => company.domains)[0]
  redirect(first ? `/domains/${first.host}` : '/onboarding')
}
