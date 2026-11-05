'use server'

import { JOB_TYPES, getMailConfig, setPasswordLink } from '@seotools/core'
import { ADMIN_RECOVERY_TTL_MS, inviteUser, issueUserToken } from '@seotools/db'
import { revalidatePath } from 'next/cache'
import { getLocale, getTranslations } from 'next-intl/server'
import { getDb } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { requireAdmin } from '@/lib/session'
import { getSettings } from '@/lib/settings'
import { parseGrants, parseUserRole } from '@/lib/user-forms'

export interface UserActionState {
  error?: string
  done?: boolean
  /** A link to hand over. It is shown once: only its hash is kept. */
  link?: string
  /** The same link is also on its way by email. */
  emailed?: boolean
}

const field = (formData: FormData, key: string) => String(formData.get(key) ?? '')
const REVALIDATE = '/system/users'
const emailLocale = async () => ((await getLocale()) === 'es' ? 'es' : 'en')

/** Creates an account with what it was given, and a link for its owner to set a password. */
export async function inviteUserAction(
  _previous: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  await requireAdmin()
  const t = await getTranslations('Users.errors')
  const role = parseUserRole(field(formData, 'role'))
  const grants = parseGrants(formData.get('grants'))
  if (!role || !grants) return { error: t('invalidRequest') }

  const db = await getDb()
  const result = await inviteUser(db, {
    name: field(formData, 'name'),
    email: field(formData, 'email'),
    role,
    grants: role === 'admin' ? [] : grants,
  })
  if (!result.ok) {
    switch (result.reason) {
      case 'invalid-name':
        return { error: t('invalidName') }
      case 'invalid-email':
        return { error: t('invalidEmail') }
      case 'email-taken':
        return { error: t('emailTaken') }
      case 'invalid-access':
        return { error: t('invalidAccess') }
    }
  }

  const emailed = (await getMailConfig(await getSettings())) !== null
  if (emailed) {
    await db.jobs.enqueue({
      type: JOB_TYPES.accessEmail,
      payload: { userId: result.user.id, kind: 'invite', locale: await emailLocale() },
    })
  }
  revalidatePath(REVALIDATE)
  return { link: setPasswordLink(getEnv().BETTER_AUTH_URL, result.token), emailed }
}

/** Sets what an account can do. Refuses to leave nobody who can administer the instance. */
export async function updateUserAccessAction(
  _previous: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  await requireAdmin()
  const t = await getTranslations('Users.errors')
  const userId = field(formData, 'userId')
  const role = parseUserRole(field(formData, 'role'))
  const grants = parseGrants(formData.get('grants'))
  if (!role || !grants) return { error: t('invalidRequest') }

  const db = await getDb()
  // The access first: it is the part that can be refused for what it names, and an account that
  // stops being an administrator must find its access already there.
  if (!(await db.users.setGrants(userId, role === 'admin' ? [] : grants))) {
    return { error: t('invalidAccess') }
  }
  const changed = await db.users.setRole(userId, role)
  if (changed === 'last-admin') return { error: t('lastAdmin') }
  if (changed === 'not-found') return { error: t('userNotFound') }
  revalidatePath(REVALIDATE)
  return { done: true }
}

/** Disabling signs the account out at once. Refuses to leave nobody who can administer. */
export async function setUserDisabledAction(
  userId: string,
  disabled: boolean,
): Promise<UserActionState> {
  await requireAdmin()
  const t = await getTranslations('Users.errors')
  if (typeof userId !== 'string' || typeof disabled !== 'boolean') {
    return { error: t('invalidRequest') }
  }
  const changed = await (await getDb()).users.setDisabled(userId, disabled)
  if (changed === 'last-admin') return { error: t('lastAdmin') }
  if (changed === 'not-found') return { error: t('userNotFound') }
  revalidatePath(REVALIDATE)
  return { done: true }
}

/**
 * A link to hand over when email is not an option: to accept an invitation, or to recover an account.
 * It does not change the password until it is used, so nothing is lost if it is never opened.
 */
export async function createAccessLinkAction(userId: string): Promise<UserActionState> {
  await requireAdmin()
  const t = await getTranslations('Users.errors')
  if (typeof userId !== 'string') return { error: t('invalidRequest') }
  const db = await getDb()
  const user = await db.users.get(userId)
  if (!user) return { error: t('userNotFound') }
  if (user.disabledAt) return { error: t('userDisabled') }
  const token = await issueUserToken(db, {
    userId,
    ...(user.hasPassword
      ? { kind: 'reset' as const, ttlMs: ADMIN_RECOVERY_TTL_MS }
      : { kind: 'invite' as const }),
  })
  return { link: setPasswordLink(getEnv().BETTER_AUTH_URL, token) }
}
