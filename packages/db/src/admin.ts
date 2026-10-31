import { randomUUID } from 'node:crypto'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import type { Database } from './types'

export interface AdminCredentials {
  email: string
  password: string
  name?: string
}

export type EnsureAdminResult = {
  action: 'created' | 'password-updated' | 'unchanged'
  removedOtherUsers: number
}

/**
 * Makes the database match the ADMIN_* environment variables. The env admin is the only
 * user that exists (sign-ups are disabled): it is created or has its password synced, and
 * any other user is removed so a changed ADMIN_EMAIL revokes the old account.
 */
export async function ensureAdmin(
  db: Database,
  creds: AdminCredentials,
): Promise<EnsureAdminResult> {
  const email = creds.email.trim().toLowerCase()
  const existing = await db.admin.findByEmail(email)

  let action: EnsureAdminResult['action'] = 'unchanged'
  if (!existing) {
    await db.admin.create({
      id: randomUUID(),
      email,
      name: creds.name ?? 'Admin',
      passwordHash: await hashPassword(creds.password),
    })
    action = 'created'
  } else if (
    !existing.passwordHash ||
    !(await verifyPassword({ hash: existing.passwordHash, password: creds.password }))
  ) {
    await db.admin.setPassword(existing.id, await hashPassword(creds.password))
    action = 'password-updated'
  }

  const removedOtherUsers = await db.admin.deleteAllExcept(email)
  return { action, removedOtherUsers }
}
