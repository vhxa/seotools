import { hashPassword } from 'better-auth/crypto'
import type { Database } from './types'

/**
 * The first admin always gets this id. Two setup requests that race past the "no users yet"
 * check then collide on the primary key, so the database guarantees only one of them wins
 * on every dialect without needing locks.
 */
const FIRST_ADMIN_ID = 'first-admin'

export interface FirstAdminInput {
  email: string
  password: string
  name: string
}

/** True while no user exists yet, i.e. the app is waiting for its first admin to register. */
export async function needsSetup(db: Database): Promise<boolean> {
  return !(await db.admin.exists())
}

/**
 * Registers the first admin. Returns `false`, without touching anything, when a user already
 * exists: setup is only available once, so this can't be used to add accounts afterwards.
 */
export async function createFirstAdmin(db: Database, input: FirstAdminInput): Promise<boolean> {
  if (!(await needsSetup(db))) return false

  try {
    await db.admin.create({
      id: FIRST_ADMIN_ID,
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
    })
    return true
  } catch (error) {
    // Lost the race against a concurrent setup request: the other one created the admin.
    if (!(await needsSetup(db))) return false
    throw error
  }
}
