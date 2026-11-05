import { canEditDomain, domainRoleOf } from '@seotools/core/access'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { cache } from 'react'
import { getDb } from './db'
import { requireViewer, type Viewer } from './session'

/** Whether at least one domain is being tracked, i.e. the onboarding has been completed. */
export async function hasDomains(): Promise<boolean> {
  const companies = await (await getDb()).companies.list()
  return companies.some((company) => company.domains.length > 0)
}

const findDomain = cache(async (host: string) => (await getDb()).domains.findByHost(host))

/**
 * Entry point of every page and server action that works on a single domain: validates the
 * session and resolves the `[host]` route segment, or renders a 404 when it is not tracked or the
 * person has no access to it, which look the same. This is the one place that checks it.
 *
 * It lets someone read the domain. What changes anything starts with `requireDomainEditor`.
 * Domain-scoped data must hang off the returned `domain.id`.
 */
export async function requireDomain(host: string) {
  const viewer = await requireViewer()
  const found = await findDomain(host)
  if (!found) notFound()
  const { company, ...domain } = found
  const role = domainRoleOf(viewer, domain)
  if (!role) notFound()
  return { session: viewer.session, company, domain, role, canEdit: canEditDomain(role) }
}

/** `requireDomain` for what changes something or spends requests: not for those who only read. */
export async function requireDomainEditor(host: string) {
  const found = await requireDomain(host)
  if (!found.canEdit) notFound()
  return found
}

/** The companies someone can see, each with only the domains they can see. */
export async function visibleCompanies(viewer: Viewer) {
  const companies = await (await getDb()).companies.list()
  if (viewer.role === 'admin') return companies
  return companies
    .map((company) => ({
      ...company,
      domains: company.domains.filter((domain) => domainRoleOf(viewer, domain) !== null),
    }))
    .filter((company) => company.domains.length > 0)
}

/**
 * What an action of a domain answers when the domain is archived. Its data is readable and nothing
 * can change or start: the repositories refuse (`DomainArchivedError`), and actions say so up
 * front instead of failing. The pages already show a notice and disable what they can.
 */
export async function archivedMessage(): Promise<string> {
  return (await getTranslations('Archive'))('refused')
}
