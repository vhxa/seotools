import { createHash, randomBytes } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { uniqueGrants, type AccessGrant, type UserRole } from '@seotools/core'
import type { Database, UserRecord, UserTokenKind } from './types'

export const MAX_USER_NAME_LENGTH = 100
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** How long a link works: an invitation has to wait for someone to read it, a recovery does not. */
export const USER_TOKEN_TTL_MS: Record<UserTokenKind, number> = {
  invite: 7 * 24 * 60 * 60_000,
  reset: 60 * 60_000,
}

/** A recovery link an administrator hands over: long enough to reach someone with no email. */
export const ADMIN_RECOVERY_TTL_MS = 24 * 60 * 60_000

/** One password email in this long per account, however often it is asked for. */
export const RESET_REQUEST_INTERVAL_MS = 2 * 60_000

export const normalizeEmail = (email: string) => email.trim().toLowerCase()
export const isValidEmail = (email: string) => EMAIL.test(email) && email.length <= 254

/** What is kept of a token. It has no use without the token, which only its link holds. */
export const hashUserToken = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex')

/** Issues a link to set a password and returns its token, which is not stored and cannot be asked for again. */
export async function issueUserToken(
  db: Database,
  input: { userId: string; kind: UserTokenKind; ttlMs?: number; now?: Date },
): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const now = input.now ?? new Date()
  await db.users.addToken({
    tokenHash: hashUserToken(token),
    userId: input.userId,
    kind: input.kind,
    expiresAt: new Date(now.getTime() + (input.ttlMs ?? USER_TOKEN_TTL_MS[input.kind])),
  })
  return token
}

/** Sets the password a link is for. `false`: the link does not work (any more). */
export async function redeemUserToken(
  db: Database,
  input: { token: string; password: string; now?: Date },
): Promise<boolean> {
  return db.users.redeemToken({
    tokenHash: hashUserToken(input.token),
    passwordHash: await hashPassword(input.password),
    now: input.now ?? new Date(),
  })
}

export type InviteUserResult =
  | { ok: true; user: UserRecord; token: string }
  | { ok: false; reason: 'invalid-name' | 'invalid-email' | 'email-taken' | 'invalid-access' }

/** Creates an account with what it was given, and the link for its owner to set a password. */
export async function inviteUser(
  db: Database,
  input: { name: string; email: string; role: UserRole; grants: readonly AccessGrant[] },
): Promise<InviteUserResult> {
  const name = input.name.trim()
  const email = normalizeEmail(input.email)
  if (!name || name.length > MAX_USER_NAME_LENGTH) return { ok: false, reason: 'invalid-name' }
  if (!isValidEmail(email)) return { ok: false, reason: 'invalid-email' }
  if (await db.users.findByEmail(email)) return { ok: false, reason: 'email-taken' }
  let user: UserRecord
  try {
    user = await db.users.create({ email, name, role: input.role })
  } catch (error) {
    if (await db.users.findByEmail(email)) return { ok: false, reason: 'email-taken' }
    throw error
  }
  if (!(await db.users.setGrants(user.id, uniqueGrants(input.grants)))) {
    return { ok: false, reason: 'invalid-access' }
  }
  return { ok: true, user, token: await issueUserToken(db, { userId: user.id, kind: 'invite' }) }
}

/**
 * Whether a password email should go out for this address, and marks that it did. Anyone can ask,
 * so this answers `null` for an address with no account, a disabled one, or one asked for too
 * recently, and the caller says the same thing either way.
 */
export async function claimPasswordEmail(
  db: Database,
  input: { email: string; now?: Date },
): Promise<UserRecord | null> {
  const now = input.now ?? new Date()
  const user = await db.users.findByEmail(normalizeEmail(input.email))
  if (!user || user.disabledAt) return null
  const last = user.resetRequestedAt?.getTime()
  if (last !== undefined && now.getTime() - last < RESET_REQUEST_INTERVAL_MS) return null
  await db.users.markResetRequested(user.id, now)
  return user
}

/**
 * Gets someone back in when nothing in the app can: makes the account an active administrator and
 * issues a recovery link. Only for the command line of the installation, whose operator can already
 * do anything to the database. It does not delete anyone, nor open registration.
 */
export async function recoverAdminAccess(
  db: Database,
  input: { email: string; now?: Date },
): Promise<{ token: string; user: UserRecord } | null> {
  const user = await db.users.findByEmail(normalizeEmail(input.email))
  if (!user) return null
  await db.users.setDisabled(user.id, false)
  await db.users.setRole(user.id, 'admin')
  const token = await issueUserToken(db, {
    userId: user.id,
    kind: 'reset',
    ttlMs: ADMIN_RECOVERY_TTL_MS,
    ...(input.now ? { now: input.now } : {}),
  })
  return { token, user }
}
