'use server'

import { normalizeDomain } from '@seotools/core'
import { addDomain, createCompany, MAX_COMPANY_NAME_LENGTH } from '@seotools/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getDb } from '@/lib/db'
import { requireSession } from '@/lib/session'

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
  // Any signed-in user may add companies for now; restrict by role once roles exist.
  await requireSession()
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
  await requireSession()
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
