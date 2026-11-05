import {
  ACCESS_ROLES,
  USER_ROLES,
  uniqueGrants,
  type AccessGrant,
  type AccessRole,
  type UserRole,
} from '@seotools/core/access'

/** What an access row of a form holds: `company:<id>` or `domain:<id>`, and a role. */
export interface GrantRow {
  target: string
  role: AccessRole
}

export const grantTarget = (grant: AccessGrant) =>
  grant.domainId ? `domain:${grant.domainId}` : `company:${grant.companyId}`

export const parseUserRole = (value: unknown): UserRole | null =>
  USER_ROLES.find((role) => role === value) ?? null

/**
 * The access rows a form sent, as grants. Whatever comes from the client is checked: `null` when any
 * of it is not a grant, rather than saving part of what was asked.
 */
export function parseGrants(value: unknown): AccessGrant[] | null {
  let rows: unknown
  try {
    rows = JSON.parse(typeof value === 'string' ? value : '[]')
  } catch {
    return null
  }
  if (!Array.isArray(rows)) return null
  const grants: AccessGrant[] = []
  for (const row of rows as unknown[]) {
    if (typeof row !== 'object' || row === null) return null
    const { target, role: rawRole } = row as { target?: unknown; role?: unknown }
    const role = ACCESS_ROLES.find((option) => option === rawRole)
    if (!role || typeof target !== 'string') return null
    const [kind, ...rest] = target.split(':')
    const id = rest.join(':')
    if (!id) return null
    if (kind === 'company') grants.push({ role, companyId: id, domainId: null })
    else if (kind === 'domain') grants.push({ role, companyId: null, domainId: id })
    else return null
  }
  return uniqueGrants(grants)
}
