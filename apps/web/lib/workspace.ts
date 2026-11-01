import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getDb } from './db'
import { requireSession } from './session'

/** Whether at least one domain is being tracked, i.e. the onboarding has been completed. */
export async function hasDomains(): Promise<boolean> {
  const companies = await (await getDb()).companies.list()
  return companies.some((company) => company.domains.length > 0)
}

const findDomain = cache(async (host: string) => (await getDb()).domains.findByHost(host))

/**
 * Entry point of every page and server action that works on a single domain: validates the
 * session and resolves the `[host]` route segment, or renders a 404 when it is not tracked.
 *
 * Domain-scoped data must hang off the returned `domain.id`. Today every signed-in user can see
 * every domain; when per-company/per-domain permissions arrive, this is the one place that
 * checks them.
 */
export async function requireDomain(host: string) {
  const session = await requireSession()
  const found = await findDomain(host)
  if (!found) notFound()
  const { company, ...domain } = found
  return { session, company, domain }
}
