'use server'

import { normalizeDomain } from '@seotools/core'
import {
  addDomain,
  createCompany,
  deleteCompany,
  deleteDomain,
  MAX_COMPANY_NAME_LENGTH,
  moveDomain,
  renameCompany,
} from '@seotools/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getDb } from '@/lib/db'
import { requireAdmin } from '@/lib/session'

export interface CompanyFormState {
  error?: string
  /** Echoed back so a failed submit doesn't wipe what the user typed. */
  values?: { company: string; domain: string }
}

export interface AddDomainFormState {
  error?: string
  values?: { companyId: string; domain: string }
}

const field = (formData: FormData, key: string) => String(formData.get(key) ?? '')
/** The domain as it will be stored, for messages; falls back to what was typed. */
const shown = (typed: string) => normalizeDomain(typed) ?? typed.trim()

/** Creates a company with its first domain, then opens that domain. Used by the onboarding too. */
export async function createCompanyAction(
  _previous: CompanyFormState,
  formData: FormData,
): Promise<CompanyFormState> {
  await requireAdmin()
  const t = await getTranslations('CompanyFields.errors')
  const values = { company: field(formData, 'company'), domain: field(formData, 'domain') }

  const result = await createCompany(await getDb(), { name: values.company, domain: values.domain })
  if (!result.ok) {
    switch (result.reason) {
      case 'invalid-name':
        return { error: t('invalidName', { max: MAX_COMPANY_NAME_LENGTH }), values }
      case 'invalid-domain':
        return { error: t('invalidDomain'), values }
      case 'domain-taken':
        return { error: t('domainTaken', { host: shown(values.domain) }), values }
    }
  }

  // The domain switcher lives in a layout: make it pick up the new company.
  revalidatePath('/', 'layout')
  redirect(`/domains/${result.domain.host}`)
}

/** Adds a domain to an existing company, then opens it. */
export async function addDomainAction(
  _previous: AddDomainFormState,
  formData: FormData,
): Promise<AddDomainFormState> {
  await requireAdmin()
  const t = await getTranslations('CompanyFields.errors')
  const values = { companyId: field(formData, 'companyId'), domain: field(formData, 'domain') }

  const result = await addDomain(await getDb(), values)
  if (!result.ok) {
    switch (result.reason) {
      case 'invalid-domain':
        return { error: t('invalidDomain'), values }
      case 'domain-taken':
        return { error: t('domainTaken', { host: shown(values.domain) }), values }
      case 'company-not-found':
        return { error: t('companyNotFound'), values }
    }
  }

  revalidatePath('/', 'layout')
  redirect(`/domains/${result.domain.host}`)
}

/** What a dialog of the companies page gets back: an error to show, or `done` to close itself. */
export interface ManageState {
  error?: string
  done?: boolean
}

/** Every route that lists companies or domains: the switcher lives in the root layout. */
function revalidateWorkspace() {
  revalidatePath('/', 'layout')
}

/**
 * Everything below is administration of the whole instance, not of one domain: each action
 * authorises itself with `requireAdmin()`, checks what the client sent, and only then touches the
 * database. Ids come from the client, so a missing one is an error, never trusted.
 */

export async function renameCompanyAction(
  _previous: ManageState,
  formData: FormData,
): Promise<ManageState> {
  await requireAdmin()
  const t = await getTranslations('Companies.errors')
  const result = await renameCompany(await getDb(), {
    id: field(formData, 'companyId'),
    name: field(formData, 'name'),
  })
  if (!result.ok) {
    return {
      error:
        result.reason === 'invalid-name'
          ? t('invalidName', { max: MAX_COMPANY_NAME_LENGTH })
          : t('companyNotFound'),
    }
  }
  revalidateWorkspace()
  return { done: true }
}

/** Archives a domain: its data stays, and nothing automatic runs or changes for it any more. */
export async function archiveDomainAction(
  _previous: ManageState,
  formData: FormData,
): Promise<ManageState> {
  await requireAdmin()
  const t = await getTranslations('Companies.errors')
  const archived = await (await getDb()).domains.archive(field(formData, 'domainId'))
  if (!archived) return { error: t('domainNotFound') }
  revalidateWorkspace()
  return { done: true }
}

export async function unarchiveDomainAction(domainId: string): Promise<ManageState> {
  await requireAdmin()
  const t = await getTranslations('Companies.errors')
  if (typeof domainId !== 'string') return { error: t('invalidRequest') }
  const restored = await (await getDb()).domains.unarchive(domainId)
  if (!restored) return { error: t('domainNotFound') }
  revalidateWorkspace()
  return { done: true }
}

export async function moveDomainAction(
  _previous: ManageState,
  formData: FormData,
): Promise<ManageState> {
  await requireAdmin()
  const t = await getTranslations('Companies.errors')
  const result = await moveDomain(await getDb(), {
    domainId: field(formData, 'domainId'),
    companyId: field(formData, 'companyId'),
  })
  if (!result.ok) {
    switch (result.reason) {
      case 'domain-not-found':
        return { error: t('domainNotFound') }
      case 'company-not-found':
        return { error: t('companyNotFound') }
      case 'same-company':
        return { error: t('sameCompany') }
    }
  }
  revalidateWorkspace()
  return { done: true }
}

/** Deletes a domain for good. The typed host is checked against the stored one, not the client's. */
export async function deleteDomainAction(
  _previous: ManageState,
  formData: FormData,
): Promise<ManageState> {
  await requireAdmin()
  const t = await getTranslations('Companies.errors')
  const result = await deleteDomain(await getDb(), {
    domainId: field(formData, 'domainId'),
    confirm: field(formData, 'confirm'),
  })
  if (!result.ok) {
    return { error: result.reason === 'not-found' ? t('domainNotFound') : t('confirmMismatch') }
  }
  revalidateWorkspace()
  return { done: true }
}

/** Deletes a company with its domains and everything stored for them. */
export async function deleteCompanyAction(
  _previous: ManageState,
  formData: FormData,
): Promise<ManageState> {
  await requireAdmin()
  const t = await getTranslations('Companies.errors')
  const result = await deleteCompany(await getDb(), {
    id: field(formData, 'companyId'),
    confirm: field(formData, 'confirm'),
  })
  if (!result.ok) {
    return { error: result.reason === 'not-found' ? t('companyNotFound') : t('confirmMismatch') }
  }
  revalidateWorkspace()
  return { done: true }
}
