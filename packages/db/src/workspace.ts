import { normalizeDomain } from '@seotools/core'
import type { Company, Database, Domain } from './types'

export const MAX_COMPANY_NAME_LENGTH = 100

/** Trims and collapses inner whitespace. `null` when the name is empty or too long. */
export function normalizeCompanyName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, ' ')
  return name.length > 0 && name.length <= MAX_COMPANY_NAME_LENGTH ? name : null
}

export type CreateCompanyResult =
  | { ok: true; company: Company; domain: Domain }
  | { ok: false; reason: 'invalid-name' | 'invalid-domain' | 'domain-taken' }

export type AddDomainResult =
  | { ok: true; domain: Domain }
  | { ok: false; reason: 'invalid-domain' | 'domain-taken' | 'company-not-found' }

/**
 * Creates a company together with its first domain. `domain` is whatever the user typed; it is
 * stored normalized (`https://www.Example.com/` → `example.com`). A company never exists without
 * a domain, so it always shows up in the domain selector.
 */
export async function createCompany(
  db: Database,
  input: { name: string; domain: string },
): Promise<CreateCompanyResult> {
  const name = normalizeCompanyName(input.name)
  if (!name) return { ok: false, reason: 'invalid-name' }
  const host = normalizeDomain(input.domain)
  if (!host) return { ok: false, reason: 'invalid-domain' }
  if (await db.domains.findByHost(host)) return { ok: false, reason: 'domain-taken' }

  try {
    return { ok: true, ...(await db.companies.create({ name, host })) }
  } catch (error) {
    // Lost the race against another request registering the same domain.
    if (await db.domains.findByHost(host)) return { ok: false, reason: 'domain-taken' }
    throw error
  }
}

/** Adds a domain (as typed by the user, normalized before storing) to an existing company. */
export async function addDomain(
  db: Database,
  input: { companyId: string; domain: string },
): Promise<AddDomainResult> {
  const host = normalizeDomain(input.domain)
  if (!host) return { ok: false, reason: 'invalid-domain' }
  if (!(await db.companies.get(input.companyId))) return { ok: false, reason: 'company-not-found' }
  if (await db.domains.findByHost(host)) return { ok: false, reason: 'domain-taken' }

  try {
    return { ok: true, domain: await db.domains.add({ companyId: input.companyId, host }) }
  } catch (error) {
    if (await db.domains.findByHost(host)) return { ok: false, reason: 'domain-taken' }
    throw error
  }
}
