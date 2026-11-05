import { createFirstAdmin, inviteUser, issueUserToken, redeemUserToken } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAuth, type Auth } from './auth'

const env = {
  NODE_ENV: 'test' as const,
  LOG_LEVEL: 'silent' as const,
  DATABASE_URL: ':memory:',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  BETTER_AUTH_URL: 'http://localhost:3000',
  TRUSTED_ORIGINS: [],
}
const admin = { name: 'Admin', email: 'admin@example.com', password: 'a-long-admin-password' }

let db: Database
let auth: Auth
beforeEach(async () => {
  db = await createTestDatabase()
  await createFirstAdmin(db, admin)
  auth = createAuth(db, env)
})
afterEach(async () => {
  await db.close()
})

describe('admin auth (better-auth)', () => {
  it('signs in the registered admin and issues a session token', async () => {
    const res = await auth.api.signInEmail({
      body: { email: admin.email, password: admin.password },
    })
    expect(res.user.email).toBe(admin.email)
    expect(res.token).toBeTruthy()
  })

  it('rejects a wrong password and an unknown user', async () => {
    await expect(
      auth.api.signInEmail({ body: { email: admin.email, password: 'wrong-password' } }),
    ).rejects.toThrow()
    await expect(
      auth.api.signInEmail({ body: { email: 'nobody@example.com', password: admin.password } }),
    ).rejects.toThrow()
  })

  it('refuses a disabled account like a wrong password, and has it back when enabled', async () => {
    const second = await inviteUser(db, {
      name: 'Second',
      email: 'second@example.com',
      role: 'member',
      grants: [],
    })
    if (!second.ok) throw new Error(second.reason)
    const password = 'a-long-member-password'
    const signIn = () => auth.api.signInEmail({ body: { email: second.user.email, password } })

    // Invited, with no password yet: nothing to sign in with.
    await expect(signIn()).rejects.toThrow()
    await redeemUserToken(db, { token: second.token, password })
    expect((await signIn()).user.email).toBe(second.user.email)

    await db.users.setDisabled(second.user.id, true)
    await expect(signIn()).rejects.toMatchObject({
      body: { code: 'INVALID_EMAIL_OR_PASSWORD' },
    })
    await db.users.setDisabled(second.user.id, false)
    expect((await signIn()).token).toBeTruthy()
  })

  it('signs in with a password set through a link, and not with the old one', async () => {
    const found = await db.users.findByEmail(admin.email)
    const token = await issueUserToken(db, { userId: found!.id, kind: 'reset' })
    const { token: session } = await auth.api.signInEmail({
      body: { email: admin.email, password: admin.password },
    })
    expect(session).toBeTruthy()

    const password = 'the-new-long-password'
    expect(await redeemUserToken(db, { token, password })).toBe(true)
    expect(
      (await auth.api.signInEmail({ body: { email: admin.email, password } })).token,
    ).toBeTruthy()
    await expect(
      auth.api.signInEmail({ body: { email: admin.email, password: admin.password } }),
    ).rejects.toThrow()
  })

  it('has public sign-up disabled', async () => {
    await expect(
      auth.api.signUpEmail({
        body: { email: 'attacker@example.com', password: 'another-long-password', name: 'x' },
      }),
    ).rejects.toThrow()
    expect(await db.admin.findByEmail('attacker@example.com')).toBeNull()
  })
})
