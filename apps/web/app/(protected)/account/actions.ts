'use server'

import { ALERT_KINDS, alertLocaleOf } from '@seotools/core/alerts'
import { APIError } from 'better-auth/api'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getLocale, getTranslations } from 'next-intl/server'
import { getAuth } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/password'
import { requireSession, requireViewer } from '@/lib/session'
import { visibleCompanies } from '@/lib/workspace'

export interface PasswordState {
  error?: string
  done?: boolean
}

/** Changes one's own password, knowing the current one, and signs out the other devices. */
export async function changePasswordAction(
  _previous: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  await requireSession()
  const t = await getTranslations('Account.errors')
  const currentPassword = String(formData.get('current') ?? '')
  const newPassword = String(formData.get('next') ?? '')
  if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
    return { error: t('length', { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH }) }
  }
  try {
    const auth = await getAuth()
    await auth.api.changePassword({
      headers: await headers(),
      body: { currentPassword, newPassword, revokeOtherSessions: true },
    })
  } catch (error) {
    if (error instanceof APIError) return { error: t('wrongPassword') }
    throw error
  }
  return { done: true }
}

export interface AlertsState {
  saved?: boolean
  error?: string
}

/**
 * Saves which alerts one wants about each domain they can see, in the language they are using now.
 * Only the domains this person can see are read from the form: a field for any other is ignored, and
 * what is sent is checked again against access when the email is written.
 */
export async function saveAlertsAction(
  _previous: AlertsState,
  formData: FormData,
): Promise<AlertsState> {
  const viewer = await requireViewer()
  const domains = (await visibleCompanies(viewer))
    .flatMap((company) => company.domains)
    // Nothing is sent for an archived domain, and it keeps what its people had chosen.
    .filter((domain) => domain.archivedAt === null)
    .map((domain) => ({
      domainId: domain.id,
      kinds: ALERT_KINDS.filter((kind) => formData.get(`${domain.id}:${kind}`) === 'on'),
    }))
  try {
    await (
      await getDb()
    ).alerts.save({
      userId: viewer.session.user.id,
      locale: alertLocaleOf(await getLocale()),
      domains,
    })
  } catch {
    return { error: (await getTranslations('Account.alerts.errors'))('failed') }
  }
  revalidatePath('/account')
  return { saved: true }
}
