'use server'

import { createFirstAdmin } from '@seotools/db'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getAuth } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/password'

export interface SetupState {
  error?: string
  /** Echoed back so a failed submit doesn't wipe what the user typed (never the password). */
  values?: { name: string; email: string }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** First-run registration. Only works while the database has no users. */
export async function createAdmin(_previous: SetupState, formData: FormData): Promise<SetupState> {
  const t = await getTranslations('Setup.errors')
  const field = (key: string) => String(formData.get(key) ?? '')
  const name = field('name').trim()
  const email = field('email').trim().toLowerCase()
  const password = field('password')
  const values = { name, email }

  if (!name) return { error: t('nameRequired'), values }
  if (!EMAIL.test(email)) return { error: t('invalidEmail'), values }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return {
      error: t('passwordLength', { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_LENGTH }),
      values,
    }
  }
  if (password !== field('confirmPassword')) return { error: t('passwordMismatch'), values }

  const created = await createFirstAdmin(await getDb(), { name, email, password })
  // Someone else finished the setup first: nothing to do here but log in.
  if (!created) redirect('/login')

  let signedIn = true
  try {
    const auth = await getAuth()
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() })
  } catch {
    signedIn = false // the account exists; the login page takes it from here
  }
  // Signed in: the next step is choosing the first company and domain.
  redirect(signedIn ? '/onboarding' : '/login')
}
