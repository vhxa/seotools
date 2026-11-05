'use server'

import { JOB_TYPES, getMailConfig } from '@seotools/core'
import { claimPasswordEmail, isValidEmail, normalizeEmail } from '@seotools/db'
import { getLocale } from 'next-intl/server'
import { getDb } from '@/lib/db'
import { getSettings } from '@/lib/settings'

export interface ForgotState {
  sent?: boolean
}

/**
 * Asks for a password email. It is public, so it says the same thing whether or not the account
 * exists, can sign in, or email works, and it answers one request in a while per account. The link
 * is made by the worker when sending, so no job holds one.
 */
export async function requestPasswordEmailAction(
  _previous: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const email = normalizeEmail(String(formData.get('email') ?? ''))
  if (isValidEmail(email) && (await getMailConfig(await getSettings())) !== null) {
    const db = await getDb()
    const user = await claimPasswordEmail(db, { email })
    if (user) {
      await db.jobs.enqueue({
        type: JOB_TYPES.accessEmail,
        payload: {
          userId: user.id,
          kind: user.hasPassword ? 'reset' : 'invite',
          locale: (await getLocale()) === 'es' ? 'es' : 'en',
        },
      })
    }
  }
  return { sent: true }
}
