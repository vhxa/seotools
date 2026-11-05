/**
 * Who may do what. An instance has administrators, who may do everything everywhere, and members,
 * who only have what they were given: a role on a company, which covers all its domains, present and
 * future, or on a domain. The most specific grant wins: a role on a domain replaces the one on its
 * company for that domain, in either direction. Nothing is implicit: without a grant a member does
 * not know the domain exists.
 *
 * Pure on purpose (no Node imports): client components import it through `@seotools/core/access`.
 */

export const USER_ROLES = ['admin', 'member'] as const
export type UserRole = (typeof USER_ROLES)[number]

/** What a grant gives. `editor` works on results and settings, `viewer` reads and exports them. */
export const ACCESS_ROLES = ['editor', 'viewer'] as const
export type AccessRole = (typeof ACCESS_ROLES)[number]

/** A member's role on a company or on a domain: always exactly one of the two. */
export type AccessGrant =
  | { role: AccessRole; companyId: string; domainId: null }
  | { role: AccessRole; companyId: null; domainId: string }

/** What someone can do on one domain. */
export type DomainRole = 'admin' | AccessRole

export interface AccessSubject {
  role: UserRole
  grants: readonly AccessGrant[]
}

/** What someone can do on a domain. `null`: nothing, and the domain does not exist for them. */
export function domainRoleOf(
  subject: AccessSubject,
  domain: { id: string; companyId: string },
): DomainRole | null {
  if (subject.role === 'admin') return 'admin'
  const own = subject.grants.find((grant) => grant.domainId === domain.id)
  if (own) return own.role
  return subject.grants.find((grant) => grant.companyId === domain.companyId)?.role ?? null
}

/** Works on results and settings, as opposed to reading and exporting them. */
export const canEditDomain = (role: DomainRole | null) => role === 'admin' || role === 'editor'

/** The grants of a form, without repeats: the last one given for a target is the one that stands. */
export function uniqueGrants(grants: readonly AccessGrant[]): AccessGrant[] {
  const byTarget = new Map<string, AccessGrant>()
  for (const grant of grants) {
    byTarget.set(grant.domainId ? `d:${grant.domainId}` : `c:${grant.companyId}`, grant)
  }
  return [...byTarget.values()]
}

/**
 * Who gains and who loses a domain when it moves to another company. Grants on the domain travel
 * with it, so they change nothing; grants on the two companies decide the rest. Administrators see
 * everything, so they are never in either list.
 */
export function accessAfterMove<T extends { id: string; role: UserRole; grants: AccessGrant[] }>(
  users: readonly T[],
  move: { domainId: string; from: string; to: string },
): { gain: T[]; lose: T[] } {
  const gain: T[] = []
  const lose: T[] = []
  for (const user of users) {
    if (user.role === 'admin') continue
    const before = domainRoleOf(user, { id: move.domainId, companyId: move.from })
    const after = domainRoleOf(user, { id: move.domainId, companyId: move.to })
    if (before === null && after !== null) gain.push(user)
    if (before !== null && after === null) lose.push(user)
  }
  return { gain, lose }
}
