'use server'

import { redeemUserToken } from '@seotools/db'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getDb } from '@/lib/db'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/password'

export interface SetPasswordState {
  error?: string
}

/** Sets a password with a link. The token is the authorization: there is no session here. */
export async function setPasswordAction(
  _previous: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const t = await getTranslations('SetPassword.errors')
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { error: t('length', { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH }) }
  }
  if (password !== String(formData.get('confirm') ?? '')) return { error: t('mismatch') }
  if (!(await redeemUserToken(await getDb(), { token, password }))) {
    return { error: t('expired') }
  }
  redirect('/login?password=set')
}
