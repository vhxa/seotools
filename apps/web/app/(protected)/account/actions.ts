'use server'

import { APIError } from 'better-auth/api'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { getAuth } from '@/lib/auth'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/password'
import { requireSession } from '@/lib/session'

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
