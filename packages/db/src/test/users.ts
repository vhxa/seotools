import type { AccessGrant } from '@seotools/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { createFirstAdmin } from '../admin'
import type { Database } from '../types'
import {
  claimPasswordEmail,
  hashUserToken,
  inviteUser,
  issueUserToken,
  recoverAdminAccess,
  redeemUserToken,
} from '../users'
import { createCompany } from '../workspace'

/**
 * Accounts, what they were given and how they get in, on every dialect. Password checks live in the
 * web app, with better-auth (`apps/web/lib/auth.test.ts`).
 */
export function describeUsers(getDb: () => Database) {
  describe('users', () => {
    let db: Database
    beforeEach(() => {
      db = getDb()
    })

    const admin = async (email = 'admin@acme.com') => {
      await createFirstAdmin(db, { email, name: 'Admin', password: 'a-long-admin-password' })
      return (await db.users.findByEmail(email))!
    }
    /** An account that has accepted its invitation. */
    const signedUp = async (email: string, role: 'admin' | 'member' = 'member') => {
      const invited = await inviteUser(db, { name: email, email, role, grants: [] })
      if (!invited.ok) throw new Error(invited.reason)
      await redeemUserToken(db, { token: invited.token, password: 'another-long-password' })
      return invited.user
    }
    const site = async (host = 'acme.com') => {
      const created = await createCompany(db, { name: host, domain: host })
      if (!created.ok) throw new Error('setup failed')
      return created
    }

    it('makes the first account an administrator, and anyone else nothing by themselves', async () => {
      expect((await admin()).role).toBe('admin')
      const invited = await inviteUser(db, {
        name: ' Ana ',
        email: ' ANA@acme.com ',
        role: 'member',
        grants: [],
      })
      expect(invited).toMatchObject({
        ok: true,
        user: { name: 'Ana', email: 'ana@acme.com', role: 'member', hasPassword: false },
      })
      if (invited.ok) expect(await db.users.grantsOf(invited.user.id)).toEqual([])
    })

    it('refuses what is not an account it can create', async () => {
      const base = { name: 'A', email: 'a@acme.com', role: 'member' as const, grants: [] }
      await admin('a@acme.com')
      expect(await inviteUser(db, base)).toEqual({ ok: false, reason: 'email-taken' })
      expect(await inviteUser(db, { ...base, email: 'A@ACME.com' })).toEqual({
        ok: false,
        reason: 'email-taken',
      })
      expect(await inviteUser(db, { ...base, email: 'nope' })).toEqual({
        ok: false,
        reason: 'invalid-email',
      })
      expect(await inviteUser(db, { ...base, email: 'b@acme.com', name: ' ' })).toEqual({
        ok: false,
        reason: 'invalid-name',
      })
    })

    it('never leaves the instance without an administrator who can sign in', async () => {
      const first = await admin()
      expect(await db.users.setRole(first.id, 'member')).toBe('last-admin')
      expect(await db.users.setDisabled(first.id, true)).toBe('last-admin')
      expect((await db.users.get(first.id))?.role).toBe('admin')

      // An administrator who has not accepted their invitation cannot sign in: it does not count.
      const pending = await inviteUser(db, {
        name: 'P',
        email: 'p@acme.com',
        role: 'admin',
        grants: [],
      })
      if (!pending.ok) throw new Error(pending.reason)
      expect(await db.users.setRole(first.id, 'member')).toBe('last-admin')

      // The first account is like any other once there is another: its role can go.
      const second = await signedUp('second@acme.com', 'admin')
      expect(await db.users.setRole(first.id, 'member')).toBe('ok')
      expect((await db.users.get(first.id))?.role).toBe('member')
      expect(await db.users.setDisabled(second.id, true)).toBe('last-admin')
      expect(await db.users.setRole(first.id, 'admin')).toBe('ok')
      expect(await db.users.setDisabled(second.id, true)).toBe('ok')
      expect(await db.users.setDisabled('nobody', true)).toBe('not-found')
      expect(await db.users.setRole('nobody', 'admin')).toBe('not-found')
    })

    it('does not let two changes at once take away the last two administrators', async () => {
      const first = await admin()
      const second = await signedUp('second@acme.com', 'admin')
      const answers = await Promise.all([
        db.users.setRole(first.id, 'member'),
        db.users.setRole(second.id, 'member'),
      ])
      expect([...answers].sort()).toEqual(['last-admin', 'ok'])
      const roles = (await db.users.list()).map(({ role }) => role)
      expect(roles.filter((role) => role === 'admin')).toHaveLength(1)
    })

    it('replaces what a member was given, whole', async () => {
      const { company, domain } = await site()
      const member = await signedUp('m@acme.com')
      const grants: AccessGrant[] = [
        { role: 'viewer', companyId: company.id, domainId: null },
        { role: 'editor', companyId: null, domainId: domain.id },
      ]
      expect(await db.users.setGrants(member.id, grants)).toBe(true)
      expect(await db.users.grantsOf(member.id)).toEqual(expect.arrayContaining(grants))
      expect((await db.users.allGrants()).get(member.id)).toHaveLength(2)

      expect(
        await db.users.setGrants(member.id, [
          { role: 'editor', companyId: company.id, domainId: null },
        ]),
      ).toBe(true)
      expect(await db.users.grantsOf(member.id)).toEqual([
        { role: 'editor', companyId: company.id, domainId: null },
      ])

      // What does not exist changes nothing.
      expect(
        await db.users.setGrants(member.id, [
          { role: 'viewer', companyId: 'missing', domainId: null },
        ]),
      ).toBe(false)
      expect(await db.users.grantsOf(member.id)).toHaveLength(1)
      expect(await db.users.setGrants('nobody', [])).toBe(false)
    })

    it('loses a grant with the company or the domain it is about', async () => {
      const { company, domain } = await site()
      const member = await signedUp('m@acme.com')
      await db.users.setGrants(member.id, [
        { role: 'viewer', companyId: null, domainId: domain.id },
        { role: 'viewer', companyId: company.id, domainId: null },
      ])
      await db.domains.delete(domain.id)
      expect(await db.users.grantsOf(member.id)).toEqual([
        { role: 'viewer', companyId: company.id, domainId: null },
      ])
      await db.companies.delete(company.id)
      expect(await db.users.grantsOf(member.id)).toEqual([])
    })

    it('keeps only the hash of a link, which works once, and only until it expires', async () => {
      const first = await admin()
      const now = new Date('2026-11-05T10:00:00Z')
      const token = await issueUserToken(db, { userId: first.id, kind: 'reset', now })
      expect(token).not.toBe(hashUserToken(token))

      const seen = await db.users.findToken(hashUserToken(token), now)
      expect(seen).toMatchObject({ kind: 'reset', user: { id: first.id } })
      expect(await db.users.findToken(token, now)).toBeNull()

      const later = new Date(now.getTime() + 2 * 60 * 60_000)
      expect(await db.users.findToken(hashUserToken(token), later)).toBeNull()
      expect(await redeemUserToken(db, { token, password: 'new-long-password', now: later })).toBe(
        false,
      )

      expect(await redeemUserToken(db, { token, password: 'new-long-password', now })).toBe(true)
      expect(await redeemUserToken(db, { token, password: 'third-long-password', now })).toBe(false)
      const before = (await db.admin.findByEmail(first.email))?.passwordHash
      expect(before).toBeTruthy()
    })

    it('uses all the links of an account with one, and only one of two at once wins', async () => {
      const first = await admin()
      const one = await issueUserToken(db, { userId: first.id, kind: 'reset' })
      const other = await issueUserToken(db, { userId: first.id, kind: 'invite' })
      expect(await redeemUserToken(db, { token: one, password: 'new-long-password' })).toBe(true)
      expect(await db.users.findToken(hashUserToken(other), new Date())).toBeNull()

      const a = await issueUserToken(db, { userId: first.id, kind: 'reset' })
      const hash = hashUserToken(a)
      const now = new Date()
      const answers = await Promise.all([
        db.users.redeemToken({ tokenHash: hash, passwordHash: 'x', now }),
        db.users.redeemToken({ tokenHash: hash, passwordHash: 'y', now }),
      ])
      expect(answers.filter(Boolean)).toHaveLength(1)
    })

    it('gives an invited account its password through the link', async () => {
      await admin()
      const invited = await inviteUser(db, {
        name: 'Ana',
        email: 'ana@acme.com',
        role: 'member',
        grants: [],
      })
      if (!invited.ok) throw new Error(invited.reason)
      expect((await db.admin.findByEmail('ana@acme.com'))?.passwordHash).toBeNull()
      expect(await redeemUserToken(db, { token: invited.token, password: 'a-long-password' })).toBe(
        true,
      )
      expect((await db.admin.findByEmail('ana@acme.com'))?.passwordHash).toBeTruthy()
      expect((await db.users.get(invited.user.id))?.hasPassword).toBe(true)
    })

    it('removes the links of a disabled account, and gives it none that works', async () => {
      await admin()
      const member = await signedUp('m@acme.com')
      const token = await issueUserToken(db, { userId: member.id, kind: 'reset' })
      expect(await db.users.setDisabled(member.id, true)).toBe('ok')
      expect((await db.users.get(member.id))?.disabledAt).toBeInstanceOf(Date)
      expect(await redeemUserToken(db, { token, password: 'a-long-password' })).toBe(false)

      const again = await issueUserToken(db, { userId: member.id, kind: 'reset' })
      expect(await db.users.findToken(hashUserToken(again), new Date())).toBeNull()
      expect(await redeemUserToken(db, { token: again, password: 'a-long-password' })).toBe(false)

      expect(await db.users.setDisabled(member.id, false)).toBe('ok')
      expect((await db.users.get(member.id))?.disabledAt).toBeNull()
    })

    it('answers a password email for an account once in a while, and for nothing else', async () => {
      const first = await admin()
      const now = new Date('2026-11-05T10:00:00Z')
      expect(await claimPasswordEmail(db, { email: 'nobody@acme.com', now })).toBeNull()
      expect(await claimPasswordEmail(db, { email: 'ADMIN@acme.com', now })).toMatchObject({
        id: first.id,
      })
      expect(await claimPasswordEmail(db, { email: first.email, now })).toBeNull()
      const later = new Date(now.getTime() + 5 * 60_000)
      expect(await claimPasswordEmail(db, { email: first.email, now: later })).not.toBeNull()

      const member = await signedUp('m@acme.com')
      await db.users.setDisabled(member.id, true)
      expect(await claimPasswordEmail(db, { email: member.email, now })).toBeNull()
    })

    it('recovers access from the command line without deleting anyone', async () => {
      const first = await admin()
      const member = await signedUp('m@acme.com')
      await db.users.setDisabled(member.id, true)

      expect(await recoverAdminAccess(db, { email: 'nobody@acme.com' })).toBeNull()
      const recovered = await recoverAdminAccess(db, { email: 'M@acme.com' })
      expect(recovered?.user.id).toBe(member.id)
      expect(await db.users.get(member.id)).toMatchObject({ role: 'admin', disabledAt: null })
      expect(
        await redeemUserToken(db, { token: recovered!.token, password: 'a-long-password' }),
      ).toBe(true)
      expect(await db.users.list()).toHaveLength(2)
      expect((await db.users.get(first.id))?.role).toBe('admin')
    })
  })
}
