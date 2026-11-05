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

export type RenameCompanyResult =
  { ok: true; company: Company } | { ok: false; reason: 'invalid-name' | 'company-not-found' }

/** Renames a company. Names are normalized like when it was created. */
export async function renameCompany(
  db: Database,
  input: { id: string; name: string },
): Promise<RenameCompanyResult> {
  const name = normalizeCompanyName(input.name)
  if (!name) return { ok: false, reason: 'invalid-name' }
  const company = await db.companies.rename(input.id, name)
  return company ? { ok: true, company } : { ok: false, reason: 'company-not-found' }
}

export type MoveDomainResult =
  | { ok: true; domain: Domain }
  | { ok: false; reason: 'domain-not-found' | 'company-not-found' | 'same-company' }

/**
 * Moves a domain to another company. The domain keeps its id, so every result, rule and schedule
 * stays with it: only the company it is listed under changes.
 */
export async function moveDomain(
  db: Database,
  input: { domainId: string; companyId: string },
): Promise<MoveDomainResult> {
  const domain = await db.domains.get(input.domainId)
  if (!domain) return { ok: false, reason: 'domain-not-found' }
  if (domain.companyId === input.companyId) return { ok: false, reason: 'same-company' }
  const moved = await db.domains.move({ id: domain.id, companyId: input.companyId })
  return moved ? { ok: true, domain: moved } : { ok: false, reason: 'company-not-found' }
}

export type DeleteResult =
  { ok: true } | { ok: false; reason: 'not-found' | 'confirmation-mismatch' }

/**
 * Deletes a domain and everything stored for it. `confirm` is what the person typed and must be
 * the host itself (ignoring case and surrounding spaces); it is checked here against the stored
 * host, never against anything the client sent.
 */
export async function deleteDomain(
  db: Database,
  input: { domainId: string; confirm: string },
): Promise<DeleteResult> {
  const domain = await db.domains.get(input.domainId)
  if (!domain) return { ok: false, reason: 'not-found' }
  if (input.confirm.trim().toLowerCase() !== domain.host) {
    return { ok: false, reason: 'confirmation-mismatch' }
  }
  return (await db.domains.delete(domain.id)) ? { ok: true } : { ok: false, reason: 'not-found' }
}

/**
 * Deletes a company with its domains and everything stored for them. `confirm` must be the name of
 * the company (spaces normalized like names are, case sensitive), checked against the stored one.
 */
export async function deleteCompany(
  db: Database,
  input: { id: string; confirm: string },
): Promise<DeleteResult> {
  const company = await db.companies.get(input.id)
  if (!company) return { ok: false, reason: 'not-found' }
  if (normalizeCompanyName(input.confirm) !== company.name) {
    return { ok: false, reason: 'confirmation-mismatch' }
  }
  return (await db.companies.delete(company.id)) ? { ok: true } : { ok: false, reason: 'not-found' }
}
